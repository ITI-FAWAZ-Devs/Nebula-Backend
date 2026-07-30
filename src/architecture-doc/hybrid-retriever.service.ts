import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';
import { ChromaService } from '../chroma/chroma.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import {
  HybridRetrievalQuery,
  HybridRetrievalOptions,
  HybridRetrievalContext,
  RetrievedFile,
  FileRelationship,
  SourceStatusValue,
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_BOUNDS,
} from './dto/hybrid-retrieval-context.dto';

interface ChromaRecord {
  filePath: string;
  description?: string;
  distance: number;
  modulePath?: string;
  graphNodeId?: string;
  moduleGraphNodeId?: string;
}

/**
 * Phase 1 internal retrieval boundary.
 * Implements fused semantic + graph retrieval as specified in
 * `specs/002-hybrid-retrieval/contracts/hybrid-retrieval.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class HybridRetrieverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly chroma: ChromaService,
    private readonly neo4j: Neo4jService,
  ) {}

  async retrieve(
    repositoryId: string,
    query: HybridRetrievalQuery,
    options?: HybridRetrievalOptions,
  ): Promise<HybridRetrievalContext> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundException(`Repository ${repositoryId} not found`);
    }

    const topic = query.topic?.trim() || '';
    const seedPaths = query.filePaths?.filter((p) => p.trim().length > 0) || [];

    if (!topic && seedPaths.length === 0) {
      throw new Error('At least one of topic or filePaths is required');
    }

    const semanticLimit = clampOption(
      options?.semanticLimit,
      HYBRID_RETRIEVAL_DEFAULTS.semanticLimit,
      HYBRID_RETRIEVAL_BOUNDS.semanticLimit.min,
      HYBRID_RETRIEVAL_BOUNDS.semanticLimit.max,
    );
    const maxHops = clampOption(
      options?.maxHops,
      HYBRID_RETRIEVAL_DEFAULTS.maxHops,
      HYBRID_RETRIEVAL_BOUNDS.maxHops.min,
      HYBRID_RETRIEVAL_BOUNDS.maxHops.max,
    );
    const maxFiles = clampOption(
      options?.maxFiles,
      HYBRID_RETRIEVAL_DEFAULTS.maxFiles,
      HYBRID_RETRIEVAL_BOUNDS.maxFiles.min,
      HYBRID_RETRIEVAL_BOUNDS.maxFiles.max,
    );

    let semanticStatus: SourceStatusValue = 'available';
    let graphStatus: SourceStatusValue = 'available';
    let semanticRecords: ChromaRecord[] = [];
    let graphEdges: FileRelationship[] = [];
    let graphClusters: Array<{ name: string; filePaths: string[] }> = [];
    let graphNodesByPath = new Map<string, { minHop: number }>();

    if (topic) {
      try {
        const embedding = await this.gemini.embedString(topic);
        const chromaResult = await this.chroma.queryCollection(
          `repo-${repositoryId}`,
          embedding,
          semanticLimit,
        );
        semanticRecords = this.parseSemanticResults(
          chromaResult,
          repositoryId,
        );
        semanticStatus = semanticRecords.length > 0 ? 'available' : 'empty';
      } catch {
        semanticStatus = 'unavailable';
        semanticRecords = [];
      }
    } else {
      semanticStatus = 'empty';
    }

    const allSeedPaths = [
      ...new Set([
        ...semanticRecords.map((r) => r.filePath),
        ...seedPaths,
      ]),
    ];

    if (allSeedPaths.length > 0) {
      try {
        const neighborhood = await this.neo4j.getFileNeighborhood(
          repositoryId,
          allSeedPaths,
          maxHops,
        );
        graphEdges = neighborhood.edges
          .filter((e) => e.fromFilePath.length > 0 && e.toFilePath.length > 0)
          .map((e) => ({
          fromFilePath: e.fromFilePath,
          toFilePath: e.toFilePath,
          type: e.type,
          hopDistance: e.hopDistance,
          edgeId: e.id,
        }));
        graphClusters = neighborhood.clusters;
        const nodeMinHops = new Map<string, number>();
        for (const e of neighborhood.edges) {
          const hop = e.hopDistance;
          if (!nodeMinHops.has(e.fromFilePath) || (nodeMinHops.get(e.fromFilePath) ?? Infinity) > hop) {
            nodeMinHops.set(e.fromFilePath, hop);
          }
          if (!nodeMinHops.has(e.toFilePath) || (nodeMinHops.get(e.toFilePath) ?? Infinity) > hop) {
            nodeMinHops.set(e.toFilePath, hop);
          }
        }
        graphNodesByPath = new Map(
          neighborhood.nodes
            .filter((n) => n.filePath.length > 0)
            .map((n) => [
            n.filePath,
            { minHop: nodeMinHops.get(n.filePath) ?? 0 },
          ]),
        );
        graphStatus = neighborhood.nodes.length > 0 ? 'available' : 'empty';
      } catch {
        graphStatus = 'unavailable';
      }
    } else {
      graphStatus = 'empty';
    }

    if (semanticStatus === 'unavailable' && graphStatus === 'unavailable') {
      throw new Error('Both semantic and graph sources are unavailable');
    }

    const files = this.mergeFiles(
      semanticRecords,
      graphNodesByPath,
      seedPaths,
      maxFiles,
    );

    const missingSeedPaths = seedPaths.filter(
      (sp) => !files.some((f) => f.filePath === sp),
    );

    const bothAvailable =
      semanticStatus !== 'unavailable' && graphStatus !== 'unavailable';
    const noEvidence =
      bothAvailable &&
      semanticRecords.length === 0 &&
      graphNodesByPath.size === 0;

    return {
      repositoryId,
      files,
      relationships: this.deduplicateEdges(graphEdges),
      moduleClusters: graphClusters,
      missingSeedPaths,
      sourceStatus: { semantic: semanticStatus, graph: graphStatus },
      noEvidence,
    };
  }

  private parseSemanticResults(
    result: any,
    repositoryId: string,
  ): ChromaRecord[] {
    if (!result || !result.ids || result.ids.length === 0) return [];

    const ids = result.ids[0] || [];
    const distances = result.distances?.[0] || [];
    const metadatas = result.metadatas?.[0] || [];

    const records: ChromaRecord[] = [];

    for (let i = 0; i < ids.length; i++) {
      const meta = metadatas[i] || {};
      const rawPath = meta.filePath as string | undefined;
      if (!rawPath) continue;

      if (meta.repositoryId && meta.repositoryId !== repositoryId) continue;

      const filePath = canonicalizePath(rawPath);

      records.push({
        filePath,
        description: (meta.description as string) || undefined,
        distance: distances[i] as number,
        modulePath: (meta.modulePath as string) || undefined,
        graphNodeId: (meta.graphNodeId as string) || undefined,
        moduleGraphNodeId: (meta.moduleGraphNodeId as string) || undefined,
      });
    }

    const seen = new Set<string>();
    return records.filter((r) => {
      if (seen.has(r.filePath)) return false;
      seen.add(r.filePath);
      return true;
    });
  }

  private mergeFiles(
    semanticRecords: ChromaRecord[],
    graphNodesByPath: Map<string, { minHop: number }>,
    seedPaths: string[],
    maxFiles: number,
  ): RetrievedFile[] {
    const fileMap = new Map<string, RetrievedFile>();

    for (let rank = 0; rank < semanticRecords.length; rank++) {
      const rec = semanticRecords[rank];
      const canonicalPath = canonicalizePath(rec.filePath);
      const existing = fileMap.get(canonicalPath);
      if (existing) {
        if (!existing.evidenceSources.includes('semantic')) {
          existing.evidenceSources.push('semantic');
        }
        continue;
      }
      fileMap.set(canonicalPath, {
        filePath: canonicalPath,
        description: rec.description,
        semanticDistance: rec.distance,
        semanticRank: rank,
        evidenceSources: ['semantic'],
        combinedScore: this.computeScore(rank, true, false, 0),
        modulePath: rec.modulePath,
        graphNodeId: rec.graphNodeId,
        moduleGraphNodeId: rec.moduleGraphNodeId,
      });
    }

    for (const [graphPath, nodeInfo] of graphNodesByPath) {
      const canonicalPath = canonicalizePath(graphPath);
      const existing = fileMap.get(canonicalPath);
      const graphHop = nodeInfo.minHop;
      if (existing) {
        existing.evidenceSources.push('graph');
        existing.graphHop = graphHop;
        existing.combinedScore = this.computeScore(
          existing.semanticRank ?? Infinity,
          true,
          true,
          graphHop,
        );
      } else {
        fileMap.set(canonicalPath, {
          filePath: canonicalPath,
          graphHop,
          evidenceSources: ['graph'],
          combinedScore: this.computeScore(Infinity, false, true, graphHop),
        });
      }
    }

    for (const sp of seedPaths) {
      const canonicalPath = canonicalizePath(sp);
      if (!fileMap.has(canonicalPath)) {
        fileMap.set(canonicalPath, {
          filePath: canonicalPath,
          evidenceSources: [],
          combinedScore: this.computeScore(Infinity, false, false, 0),
        });
      }
    }

    const sorted = [...fileMap.values()].sort((a, b) => {
      const scoreDiff = b.combinedScore - a.combinedScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.filePath.localeCompare(b.filePath);
    });

    return sorted.slice(0, maxFiles);
  }

  private computeScore(
    semanticRank: number,
    hasSemantic: boolean,
    hasGraph: boolean,
    graphHop: number = 0,
  ): number {
    const baseScore = semanticRank === Infinity ? 1000 : 1000 - semanticRank * 10;
    const graphBoost = hasGraph ? (graphHop === 1 ? 10 : graphHop === 2 ? 5 : 5) : 0;
    const bothSignalBoost = hasSemantic && hasGraph ? 3 : 0;
    return baseScore + graphBoost + bothSignalBoost;
  }

  private deduplicateEdges(edges: FileRelationship[]): FileRelationship[] {
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = `${e.edgeId}|${e.fromFilePath}|${e.toFilePath}|${e.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function canonicalizePath(raw: string): string {
  let path = raw.replace(/\\/g, '/');
  while (path.includes('//')) {
    path = path.replace('//', '/');
  }
  const prefixes = ['./', '../'];
  for (const prefix of prefixes) {
    while (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
    }
  }
  return path;
}

function clampOption(
  value: number | undefined | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const v = value ?? defaultValue;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
