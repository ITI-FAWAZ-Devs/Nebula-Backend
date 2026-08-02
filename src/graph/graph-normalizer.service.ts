import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  GraphifyResult,
  GraphifyNode,
  GraphifyEdge,
} from '../graphify/interfaces/graphify-result.interface';
import { Entity, EntityType } from './interfaces/entity.interface';
import {
  Relationship,
  RelationshipType,
} from './interfaces/relationship.interface';
import { NormalizedGraph } from './interfaces/normalized-graph.interface';

const FILE_EXTENSION =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|cs|php|rb|swift|c|cpp|h|hpp|vue|svelte)$/i;

@Injectable()
export class GraphNormalizerService {
  private readonly logger = new Logger(GraphNormalizerService.name);

  normalize(graphifyResult: GraphifyResult): NormalizedGraph {
    const nodes = graphifyResult.nodes || [];
    const edges = graphifyResult.edges || [];

    const methodTargetIds = new Set(
      edges
        .filter((e) => (e.relation || e.type || '').toLowerCase() === 'method')
        .map((e) => e.target),
    );

    const entities: Entity[] = [];
    const seenEntityIds = new Set<string>();

    for (const node of nodes) {
      const id = node.id || uuidv4();
      if (seenEntityIds.has(id)) continue;
      seenEntityIds.add(id);

      const type = this.inferEntityType(node, methodTargetIds);
      entities.push({
        id,
        type,
        name: this.cleanName(node.name || node.label || id),
        properties: {
          path: node.path || node.source_file,
          sourceFile: node.source_file,
          sourceLocation: node.source_location,
          fileType: node.file_type,
          ...node.metadata,
          ...node.properties,
        },
      });
    }

    const relationships: Relationship[] = [];
    for (const edge of edges) {
      const type = this.mapRelationshipType(
        edge.relation || edge.type || edge.label,
      );
      if (!type) continue;
      if (!edge.source || !edge.target) continue;

      relationships.push({
        id: edge.id || uuidv4(),
        type,
        sourceId: edge.source,
        targetId: edge.target,
        properties: {
          confidence: edge.confidence,
          sourceFile: edge.source_file,
          ...edge.properties,
        },
      });
    }

    this.logger.log(
      `Normalized ${entities.length} entities, ${relationships.length} relationships`,
    );

    return { entities, relationships };
  }

  private inferEntityType(
    node: GraphifyNode,
    methodTargetIds: Set<string>,
  ): EntityType {
    if (node.type) {
      const mapped = this.mapEntityType(node.type);
      if (mapped) return mapped;
    }

    const label = (node.label || node.name || '').trim();
    const sourceFile = node.source_file || '';

    // File nodes: label looks like a filename / matches source_file basename
    if (
      FILE_EXTENSION.test(label) ||
      (sourceFile &&
        (label === sourceFile || label === sourceFile.split(/[/\\]/).pop()))
    ) {
      return 'File';
    }

    if (methodTargetIds.has(node.id) || /^\.\w+\(.*\)$/.test(label)) {
      return 'Method';
    }

    if (/\(\)$/.test(label) || /^\w+\(.*\)$/.test(label)) {
      return 'Function';
    }

    if (
      /interface/i.test(label) ||
      (label.startsWith('I') && /^I[A-Z]/.test(label))
    ) {
      return 'Interface';
    }

    // PascalCase symbols default to Class
    if (/^[A-Z][A-Za-z0-9_]*$/.test(label)) {
      return 'Class';
    }

    return 'Function';
  }

  private cleanName(name: string): string {
    return name.replace(/^\./, '').replace(/\(\)$/, '').trim() || name;
  }

  private mapEntityType(raw?: string): EntityType | null {
    if (!raw) return null;
    const normalized = raw.trim();
    const aliases: Record<string, EntityType> = {
      repository: 'Repository',
      directory: 'Directory',
      dir: 'Directory',
      folder: 'Directory',
      file: 'File',
      class: 'Class',
      cls: 'Class',
      interface: 'Interface',
      iface: 'Interface',
      method: 'Method',
      meth: 'Method',
      function: 'Function',
      fn: 'Function',
      func: 'Function',
    };
    return aliases[normalized.toLowerCase()] || null;
  }

  private mapRelationshipType(raw?: string): RelationshipType | null {
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase().replace(/[\s-]/g, '_');

    const aliases: Record<string, RelationshipType> = {
      contains: 'CONTAINS',
      contain: 'CONTAINS',
      defines: 'CONTAINS',
      method: 'HAS_METHOD',
      has_method: 'HAS_METHOD',
      hasmethod: 'HAS_METHOD',
      imports: 'IMPORTS',
      import: 'IMPORTS',
      imports_from: 'IMPORTS',
      calls: 'CALLS',
      call: 'CALLS',
      calls_to: 'CALLS',
      extends: 'EXTENDS',
      extend: 'EXTENDS',
      inherits: 'EXTENDS',
      implements: 'IMPLEMENTS',
      implement: 'IMPLEMENTS',
      depends_on: 'DEPENDS_ON',
      depend: 'DEPENDS_ON',
      depends: 'DEPENDS_ON',
      dependency: 'DEPENDS_ON',
      uses: 'DEPENDS_ON',
      uses_component: 'DEPENDS_ON',
      binds_method: 'DEPENDS_ON',
    };

    return aliases[normalized] || null;
  }
}
