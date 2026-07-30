import { Injectable, Logger } from '@nestjs/common';
import { NormalizedGraph } from './interfaces/normalized-graph.interface';
import {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
} from './interfaces/knowledge-graph.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GraphBuilderService {
  private readonly logger = new Logger(GraphBuilderService.name);

  build(normalized: NormalizedGraph, repositoryId: string): KnowledgeGraph {
    const nodes: GraphNode[] = normalized.entities
      .filter((e) => e.type !== 'Module')
      .map((entity) => ({
        id: entity.id,
        labels: [entity.type],
        properties: {
          id: entity.id,
          name: entity.name,
          repositoryId,
          ...(entity.properties || {}),
        },
      }));

    const repoNodeId = `repo:${repositoryId}`;

    // Ensure a Repository root node exists for this repo
    const hasRepoNode = nodes.some((n) => n.labels.includes('Repository'));
    if (!hasRepoNode) {
      nodes.unshift({
        id: repoNodeId,
        labels: ['Repository'],
        properties: {
          id: repoNodeId,
          name: repositoryId,
          repositoryId,
        },
      });
    }

    const relationships: GraphRelationship[] = normalized.relationships.map((rel) => ({
      id: rel.id,
      type: rel.type,
      startNodeId: rel.sourceId,
      endNodeId: rel.targetId,
      properties: {
        id: rel.id,
        repositoryId,
        ...(rel.properties || {}),
      },
    }));

    // Build module hierarchy from file paths
    const fileEntities = normalized.entities.filter(
      (e) => e.type === 'File',
    );
    const existingModuleNames = new Set(
      normalized.entities
        .filter((e) => e.type === 'Module')
        .map((e) => e.name),
    );

    const moduleMap = this.buildModuleHierarchy(
      fileEntities,
      repositoryId,
      existingModuleNames,
      repoNodeId,
    );

    // Add constructed module nodes
    for (const moduleNode of moduleMap.values()) {
      nodes.push(moduleNode);
    }

    // Add module relationships
    for (const modRel of moduleMap.values()) {
      if (modRel.properties.parentId) {
        relationships.push({
          id: uuidv4(),
          type: 'CONTAINS',
          startNodeId: modRel.properties.parentId as string,
          endNodeId: modRel.id,
          properties: {
            id: uuidv4(),
            repositoryId,
          },
        });
      }
    }

    // Connect File nodes to their parent module
    for (const fileEntity of fileEntities) {
      const filePath = (fileEntity.properties?.path ||
        fileEntity.properties?.sourceFile) as string | undefined;
      if (!filePath) continue;

      const moduleId = this.findModuleIdForPath(filePath, moduleMap);
      if (moduleId) {
        relationships.push({
          id: uuidv4(),
          type: 'CONTAINS',
          startNodeId: moduleId,
          endNodeId: fileEntity.id,
          properties: {
            id: uuidv4(),
            repositoryId,
          },
        });
      }
    }

    this.logger.log(
      `Built knowledge graph: ${nodes.length} nodes, ${relationships.length} relationships (${moduleMap.size} modules)`,
    );

    return {
      repositoryId,
      nodes,
      relationships,
    };
  }

  private buildModuleHierarchy(
    fileEntities: NormalizedGraph['entities'],
    repositoryId: string,
    existingModuleNames: Set<string>,
    repoNodeId: string,
  ): Map<string, GraphNode> {
    const moduleMap = new Map<string, GraphNode>();
    const allDirParts = new Set<string>();

    // Collect all directory paths from files
    for (const file of fileEntities) {
      const filePath = (file.properties?.path ||
        file.properties?.sourceFile) as string | undefined;
      if (!filePath) continue;

      const parts = filePath.split('/');
      if (parts.length <= 1) continue;

      // Build all intermediate directory paths
      let accumulated = '';
      for (let i = 0; i < parts.length - 1; i++) {
        accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i];
        allDirParts.add(accumulated);
      }
    }

    // Sort by depth (parent before children)
    const sortedDirs = [...allDirParts].sort((a, b) =>
      a.split('/').length - b.split('/').length,
    );

    for (const dirPath of sortedDirs) {
      const dirName = dirPath.split('/').pop() || dirPath;
      const nodeId = `module:${repositoryId}:${dirPath}`;

      // Skip if graphify already provided this module
      if (existingModuleNames.has(dirName) || existingModuleNames.has(dirPath)) {
        continue;
      }

      // Determine parent module or repo
      const parts = dirPath.split('/');
      let parentId: string | null = null;
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parentNode = moduleMap.get(parentPath);
        parentId = parentNode?.id || null;
      }
      if (!parentId) {
        parentId = repoNodeId;
      }

      const node: GraphNode = {
        id: nodeId,
        labels: ['Module'],
        properties: {
          id: nodeId,
          name: dirName,
          path: dirPath,
          repositoryId,
          parentId,
        },
      };
      moduleMap.set(dirPath, node);
    }

    return moduleMap;
  }

  private findModuleIdForPath(
    filePath: string,
    moduleMap: Map<string, GraphNode>,
  ): string | null {
    const parts = filePath.split('/');
    if (parts.length <= 1) return null;

    // Get the immediate parent directory
    const parentDir = parts.slice(0, -1).join('/');
    const moduleNode = moduleMap.get(parentDir);
    return moduleNode?.id || null;
  }
}
