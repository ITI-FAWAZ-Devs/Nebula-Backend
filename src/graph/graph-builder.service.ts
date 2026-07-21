import { Injectable, Logger } from '@nestjs/common';
import { NormalizedGraph } from './interfaces/normalized-graph.interface';
import {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
} from './interfaces/knowledge-graph.interface';

@Injectable()
export class GraphBuilderService {
  private readonly logger = new Logger(GraphBuilderService.name);

  build(normalized: NormalizedGraph, repositoryId: string): KnowledgeGraph {
    const nodes: GraphNode[] = normalized.entities.map((entity) => ({
      id: entity.id,
      labels: [entity.type],
      properties: {
        id: entity.id,
        name: entity.name,
        repositoryId,
        ...(entity.properties || {}),
      },
    }));

    // Ensure a Repository root node exists for this repo
    const hasRepoNode = nodes.some((n) => n.labels.includes('Repository'));
    if (!hasRepoNode) {
      nodes.unshift({
        id: `repo:${repositoryId}`,
        labels: ['Repository'],
        properties: {
          id: `repo:${repositoryId}`,
          name: repositoryId,
          repositoryId,
        },
      });
    }

    const relationships: GraphRelationship[] = normalized.relationships.map(
      (rel) => ({
        id: rel.id,
        type: rel.type,
        startNodeId: rel.sourceId,
        endNodeId: rel.targetId,
        properties: {
          id: rel.id,
          repositoryId,
          ...(rel.properties || {}),
        },
      }),
    );

    this.logger.log(
      `Built knowledge graph: ${nodes.length} nodes, ${relationships.length} relationships`,
    );

    return {
      repositoryId,
      nodes,
      relationships,
    };
  }
}
