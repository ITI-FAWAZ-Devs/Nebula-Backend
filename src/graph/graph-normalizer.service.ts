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
      const rawPath = node.path || node.source_file;
      const normalizedPath = rawPath ? rawPath.replace(/\\/g, '/') : undefined;
      const normalizedSourceFile = node.source_file
        ? node.source_file.replace(/\\/g, '/')
        : undefined;

      entities.push({
        id,
        type,
        name: this.cleanName(node.name || node.label || id),
        properties: {
          path: normalizedPath,
          sourceFile: normalizedSourceFile,
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

      const normalizedSourceFile = edge.source_file
        ? edge.source_file.replace(/\\/g, '/')
        : undefined;

      relationships.push({
        id: edge.id || uuidv4(),
        type,
        sourceId: edge.source,
        targetId: edge.target,
        properties: {
          confidence: edge.confidence,
          sourceFile: normalizedSourceFile,
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
    const sourceFile = (node.source_file || '').replace(/\\/g, '/');

    // File nodes: label looks like a filename / matches source_file basename
    if (
      FILE_EXTENSION.test(label) ||
      (sourceFile &&
        (label === sourceFile || label === sourceFile.split('/').pop()))
    ) {
      return 'File';
    }

    if (methodTargetIds.has(node.id) || /^\.\w+\(.*\)$/.test(label)) {
      return 'Method';
    }

    if (/\(\)$/.test(label) || /^\w+\(.*\)$/.test(label) || /^use[A-Z]/.test(label)) {
      return 'Function';
    }

    if (
      /enum/i.test(label) ||
      (label.endsWith('Enum') && /^[A-Z]/.test(label))
    ) {
      return 'Enum';
    }

    if (
      /interface/i.test(label) ||
      (label.startsWith('I') && /^I[A-Z]/.test(label) && !sourceFile.endsWith('tsx'))
    ) {
      return 'Interface';
    }

    if (
      /type/i.test(label) ||
      (label.endsWith('Type') && /^[A-Z]/.test(label)) ||
      label.endsWith('Props')
    ) {
      return 'TypeAlias';
    }

    if (
      (sourceFile.endsWith('.tsx') || sourceFile.endsWith('.jsx')) &&
      /^[A-Z][A-Za-z0-9_]*$/.test(label)
    ) {
      return 'Component';
    }

    if (
      label.endsWith('Service') ||
      label.endsWith('Provider') ||
      label.endsWith('Repository')
    ) {
      return 'Service';
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
      module: 'Module',
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
      enum: 'Enum',
      type: 'TypeAlias',
      typealias: 'TypeAlias',
      type_alias: 'TypeAlias',
      endpoint: 'Endpoint',
      route: 'Endpoint',
      service: 'Service',
      component: 'Component',
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
      exports: 'EXPORTS',
      export: 'EXPORTS',
      exported_from: 'EXPORTS',
      type_references: 'TYPE_REFERENCES',
      type_reference: 'TYPE_REFERENCES',
      types: 'TYPE_REFERENCES',
      injects: 'INJECTS',
      inject: 'INJECTS',
      routes_to: 'ROUTES_TO',
      route: 'ROUTES_TO',
      uses_hook: 'USES_HOOK',
      hook: 'USES_HOOK',
    };

    return aliases[normalized] || null;
  }
}
