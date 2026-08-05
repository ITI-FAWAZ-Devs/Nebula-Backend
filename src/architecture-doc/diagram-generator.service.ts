import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import {
  FileRelationship,
  ModuleCluster,
  RetrievedFile,
} from './dto/hybrid-retrieval-context.dto';
import {
  DraftSection,
  ArchitectureDiagram,
} from './dto/architecture-draft.dto';
import { buildDiagramGenerationPrompt } from './templates/diagram-generation.prompt';

type DiagramSourceFile = Pick<RetrievedFile, 'filePath'>;

/**
 * Phase 2 internal drafting pipeline component.
 * Implements architecture diagram generation as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class DiagramGeneratorService {
  private readonly logger = new Logger(DiagramGeneratorService.name);

  constructor(private readonly aiProvider: AiProviderService) {}

  /**
   * Generates a Mermaid dependency diagram for the given evidence. Falls back
   * to a deterministic diagram built from the evidence when the LLM output is
   * missing or malformed, so a graph is produced whenever any evidence exists.
   */
  async generate(
    relationships: FileRelationship[],
    clusters: ModuleCluster[],
    sections: DraftSection[],
    focus?: string,
    files: DiagramSourceFile[] = [],
  ): Promise<ArchitectureDiagram | null> {
    if (
      relationships.length === 0 &&
      clusters.length === 0 &&
      files.length === 0
    ) {
      return null;
    }

    try {
      const prompt = buildDiagramGenerationPrompt(
        relationships,
        clusters,
        sections,
        focus,
      );
      const response = (
        await this.aiProvider.generateContent(prompt, { tier: 'strong' })
      ).text;

      const mermaidSource = this.extractMermaidSource(response);
      if (mermaidSource) {
        const modules = this.extractModules(mermaidSource, clusters, files);
        const validatedModules = this.validateModules(modules, clusters, files);

        return {
          mermaidSource,
          modules: validatedModules,
          verdict: validatedModules.length > 0 ? 'verified' : 'unverified',
          verificationNotes:
            validatedModules.length === 0
              ? 'No evidenced modules found in diagram'
              : null,
        };
      }

      this.logger.warn(
        'LLM produced no valid Mermaid output, falling back to a deterministic diagram',
      );
    } catch (error) {
      this.logger.warn(
        `LLM diagram generation failed, falling back to a deterministic diagram: ${(error as Error).message}`,
      );
    }

    return this.buildFallbackDiagram(relationships, clusters, files);
  }

  /**
   * Extracts the first `flowchart`/`graph` block from the LLM response,
   * tolerating markdown fences and lead-in prose.
   */
  private extractMermaidSource(text: string): string | null {
    const withoutOuterFence = this.stripMermaidFences(text);
    const lines = withoutOuterFence.split('\n');
    const startIndex = lines.findIndex((line) =>
      /^(flowchart|graph)\s/.test(line.trim()),
    );
    if (startIndex === -1) {
      return null;
    }
    const source = lines.slice(startIndex).join('\n').trim();
    return source.length > 0 ? source : null;
  }

  private stripMermaidFences(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private buildFallbackDiagram(
    relationships: FileRelationship[],
    clusters: ModuleCluster[],
    files: DiagramSourceFile[],
  ): ArchitectureDiagram | null {
    const lines: string[] = ['flowchart TD'];
    const modules = new Set<string>();
    const seenEdges = new Set<string>();

    const addNode = (label: string) => {
      modules.add(label);
      lines.push(`    ${this.nodeId(label)}["${this.escapeLabel(label)}"]`);
    };

    if (relationships.length > 0) {
      for (const rel of relationships) {
        const from = this.moduleLabelFor(rel.fromFilePath, clusters);
        const to = this.moduleLabelFor(rel.toFilePath, clusters);
        const edgeKey = `${from}->${to}`;
        if (seenEdges.has(edgeKey)) {
          continue;
        }
        seenEdges.add(edgeKey);
        modules.add(from);
        modules.add(to);
        lines.push(
          `    ${this.nodeId(from)}["${this.escapeLabel(from)}"] --> ${this.nodeId(to)}["${this.escapeLabel(to)}"]`,
        );
      }
    } else if (clusters.length > 0) {
      for (const cluster of clusters) {
        addNode(cluster.name);
      }
    } else {
      const moduleSet = new Set<string>();
      for (const file of files) {
        const label = this.moduleLabelFor(file.filePath, clusters);
        if (label) {
          moduleSet.add(label);
        }
      }
      for (const module of moduleSet) {
        addNode(module);
      }
    }

    if (modules.size === 0) {
      return null;
    }

    return {
      mermaidSource: lines.join('\n'),
      modules: Array.from(modules),
      verdict: 'verified',
      verificationNotes: null,
    };
  }

  private extractModules(
    mermaid: string,
    clusters: ModuleCluster[],
    files: DiagramSourceFile[],
  ): string[] {
    const modules = new Set<string>();

    for (const cluster of clusters) {
      if (mermaid.includes(cluster.name)) {
        modules.add(cluster.name);
      }
    }

    for (const file of files) {
      const label = this.moduleLabelFor(file.filePath, clusters);
      if (label && mermaid.includes(label)) {
        modules.add(label);
      }
    }

    return Array.from(modules);
  }

  private validateModules(
    modules: string[],
    clusters: ModuleCluster[],
    files: DiagramSourceFile[],
  ): string[] {
    const evidenceModules = new Set<string>();

    for (const cluster of clusters) {
      evidenceModules.add(cluster.name);
    }
    for (const file of files) {
      const label = this.moduleLabelFor(file.filePath, clusters);
      if (label) {
        evidenceModules.add(label);
      }
    }

    return modules.filter((m) => evidenceModules.has(m));
  }

  /**
   * Resolves a file path to a module node label: the cluster name when the
   * file belongs to a cluster, otherwise the top-level directory (falling back
   * to the full path for root-level files).
   */
  private moduleLabelFor(filePath: string, clusters: ModuleCluster[]): string {
    const cluster = clusters.find((c) => c.filePaths.includes(filePath));
    if (cluster) {
      return cluster.name;
    }
    const segments = filePath.split('/').filter((s) => s.length > 0);
    return segments.length > 1 ? segments[0] : filePath;
  }

  private nodeId(label: string): string {
    const base = label.replace(/[^A-Za-z0-9_]/g, '_') || 'node';
    return /^[0-9]/.test(base) ? `n${base}` : base;
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '&quot;');
  }
}
