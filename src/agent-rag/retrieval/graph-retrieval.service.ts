import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../../neo4j/neo4j.service';
import { RetrievalHit } from '../dto/retrieval-hit.dto';
import { HitEnricherService } from './hit-enricher.service';
import { ToolResultCache } from './tool-result-cache';

@Injectable()
export class GraphRetrievalService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly enricher: HitEnricherService,
    private readonly cache: ToolResultCache,
  ) {}

  async getDefinition(
    repositoryId: string,
    params: { nodeId?: string; name?: string; type?: string },
  ): Promise<RetrievalHit[]> {
    return this.cached(repositoryId, 'getDefinition', params, async () => {
      const node = await this.neo4j.getDefinition(repositoryId, params);
      if (!node) return [];
      return this.enricher.enrich(repositoryId, [
        this.enricher.mapGraphNode(node, 1),
      ]);
    });
  }

  async getCallers(
    repositoryId: string,
    nodeId: string,
  ): Promise<RetrievalHit[]> {
    return this.cached(repositoryId, 'getCallers', { nodeId }, async () => {
      const nodes = await this.neo4j.getCallers(repositoryId, nodeId);
      return this.enricher.enrich(
        repositoryId,
        nodes.map((n) => this.enricher.mapGraphNode(n)),
      );
    });
  }

  async getCallees(
    repositoryId: string,
    nodeId: string,
  ): Promise<RetrievalHit[]> {
    return this.cached(repositoryId, 'getCallees', { nodeId }, async () => {
      const nodes = await this.neo4j.getCallees(repositoryId, nodeId);
      return this.enricher.enrich(
        repositoryId,
        nodes.map((n) => this.enricher.mapGraphNode(n)),
      );
    });
  }

  async getImplementations(
    repositoryId: string,
    nodeId: string,
  ): Promise<RetrievalHit[]> {
    return this.cached(
      repositoryId,
      'getImplementations',
      { nodeId },
      async () => {
        const nodes = await this.neo4j.getImplementations(repositoryId, nodeId);
        return this.enricher.enrich(
          repositoryId,
          nodes.map((n) => this.enricher.mapGraphNode(n)),
        );
      },
    );
  }

  async getFileContext(
    repositoryId: string,
    filePath: string,
  ): Promise<RetrievalHit[]> {
    return this.cached(
      repositoryId,
      'getFileContext',
      { filePath },
      async () => {
        const nodes = await this.neo4j.getFileContext(repositoryId, filePath);
        return this.enricher.enrich(
          repositoryId,
          nodes.map((n) => this.enricher.mapGraphNode(n)),
        );
      },
    );
  }

  async getModuleOverview(
    repositoryId: string,
    filePath: string,
  ): Promise<RetrievalHit[]> {
    return this.cached(
      repositoryId,
      'getModuleOverview',
      { filePath },
      async () => {
        const nodes = await this.neo4j.getModuleOverview(
          repositoryId,
          filePath,
        );
        return this.enricher.enrich(
          repositoryId,
          nodes.map((n) => this.enricher.mapGraphNode(n)),
        );
      },
    );
  }

  private async cached(
    repositoryId: string,
    tool: string,
    args: Record<string, unknown>,
    loader: () => Promise<RetrievalHit[]>,
  ): Promise<RetrievalHit[]> {
    const hit = await this.cache.get(repositoryId, tool, args);
    if (hit) return hit;
    const result = await loader();
    await this.cache.set(repositoryId, tool, args, result);
    return result;
  }
}
