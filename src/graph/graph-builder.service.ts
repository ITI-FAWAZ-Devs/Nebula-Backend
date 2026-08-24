import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { NormalizedGraph } from './interfaces/normalized-graph.interface';
import {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
} from './interfaces/knowledge-graph.interface';

const ROOT_MODULE_DIR = '.';

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
    const repoNode = nodes.find((n) => n.labels.includes('Repository'));
    const repositoryRootId =
      repoNode?.id ?? `repo:${repositoryId}`;
    if (!repoNode) {
      nodes.unshift({
        id: repositoryRootId,
        labels: ['Repository'],
        properties: {
          id: repositoryRootId,
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

    // Synthesize the module hierarchy:
    //   (Repository)-[:HAS_MODULE]->(Module)-[:CONTAINS]->(File)
    // Modules are derived from each file's parent directory so every file is
    // reachable from the repository root even when the extractor emits no
    // structural edges of its own.
    const existingNodeIds = new Set(nodes.map((n) => n.id));
    const usedRelIds = new Set<string>();
    const modulesByDir = new Map<string, GraphNode>();

    for (const node of nodes) {
      if (!node.labels.includes('File')) continue;
      const filePath = this.fileProperty(node);
      if (!filePath) continue;

      const dir = this.moduleDirOf(filePath);
      let moduleNode = modulesByDir.get(dir);
      if (!moduleNode) {
        moduleNode = this.createModuleNode(dir, repositoryId, existingNodeIds);
        modulesByDir.set(dir, moduleNode);

        const hasModuleId = this.uniqueId(
          `has-module:${dir}`,
          usedRelIds,
        );
        relationships.push({
          id: hasModuleId,
          type: 'HAS_MODULE',
          startNodeId: repositoryRootId,
          endNodeId: moduleNode.id,
          properties: {
            id: hasModuleId,
            repositoryId,
          },
        });
      }

      const containsId = this.uniqueId(
        `module-contains:${dir}:${node.id}`,
        usedRelIds,
      );
      relationships.push({
        id: containsId,
        type: 'CONTAINS',
        startNodeId: moduleNode.id,
        endNodeId: node.id,
        properties: {
          id: containsId,
          repositoryId,
        },
      });
    }

    nodes.push(...modulesByDir.values());

    this.logger.log(
      `Built knowledge graph: ${nodes.length} nodes, ${relationships.length} relationships (${modulesByDir.size} modules)`,
    );

    return {
      repositoryId,
      nodes,
      relationships,
    };
  }

  private createModuleNode(
    dir: string,
    repositoryId: string,
    existingIds: Set<string>,
  ): GraphNode {
    let id = `module:${dir}`;
    while (existingIds.has(id)) {
      id = `${id}_`;
    }
    existingIds.add(id);

    return {
      id,
      labels: ['Module'],
      properties: {
        id,
        name: dir === ROOT_MODULE_DIR ? '(root)' : path.posix.basename(dir),
        path: dir === ROOT_MODULE_DIR ? '(root)' : dir,
        repositoryId,
      },
    };
  }

  private moduleDirOf(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    return path.posix.dirname(normalized) || ROOT_MODULE_DIR;
  }

  private fileProperty(node: GraphNode): string | null {
    const candidate = (node.properties.path ?? node.properties.sourceFile) as
      | string
      | undefined;
    return typeof candidate === 'string' && candidate.trim().length > 0
      ? candidate.trim()
      : null;
  }

  private uniqueId(base: string, usedIds: Set<string>): string {
    let id = base;
    while (usedIds.has(id)) {
      id = `${id}_`;
    }
    usedIds.add(id);
    return id;
  }
}
