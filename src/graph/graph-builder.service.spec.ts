import { GraphBuilderService } from './graph-builder.service';
import { NormalizedGraph } from './interfaces/normalized-graph.interface';
import { Entity } from './interfaces/entity.interface';
import { Relationship } from './interfaces/relationship.interface';

describe('GraphBuilderService', () => {
  let service: GraphBuilderService;

  const fileEntity = (
    id: string,
    name: string,
    pathProp: string | undefined,
  ): Entity => ({
    id,
    type: 'File',
    name,
    properties: pathProp === undefined ? {} : { path: pathProp },
  });

  beforeEach(() => {
    service = new GraphBuilderService();
  });

  it('creates a Repository root node when the normalized graph has none', () => {
    const normalized: NormalizedGraph = {
      entities: [fileEntity('f1', 'a.ts', 'src/a.ts')],
      relationships: [],
    };

    const graph = service.build(normalized, 'repo-1');

    const repoNodes = graph.nodes.filter((n) =>
      n.labels.includes('Repository'),
    );
    expect(repoNodes).toHaveLength(1);
    expect(repoNodes[0].id).toBe('repo:repo-1');
    expect(repoNodes[0].properties.repositoryId).toBe('repo-1');
  });

  it('reuses an existing Repository node id when one is present', () => {
    const normalized: NormalizedGraph = {
      entities: [
        { id: 'repo-x', type: 'Repository', name: 'my-repo' },
        fileEntity('f1', 'a.ts', 'src/a.ts'),
      ],
      relationships: [],
    };

    const graph = service.build(normalized, 'repo-1');

    const repoNodes = graph.nodes.filter((n) =>
      n.labels.includes('Repository'),
    );
    expect(repoNodes).toHaveLength(1);
    expect(repoNodes[0].id).toBe('repo-x');
  });

  it('creates one Module per unique parent directory connected to the repository via HAS_MODULE', () => {
    const normalized: NormalizedGraph = {
      entities: [
        fileEntity('f1', 'a.ts', 'src/auth/login.ts'),
        fileEntity('f2', 'b.ts', 'src/auth/session.ts'),
        fileEntity('f3', 'c.ts', 'src/graph/edges.ts'),
        fileEntity('f4', 'd.ts', 'README.md'),
      ],
      relationships: [],
    };

    const graph = service.build(normalized, 'repo-1');

    const moduleNodes = graph.nodes.filter((n) => n.labels.includes('Module'));
    const modulePaths = moduleNodes
      .map((m) => m.properties.path as string)
      .sort();

    expect(moduleNodes).toHaveLength(3);
    expect(modulePaths).toEqual(['(root)', 'src/auth', 'src/graph']);
    expect(
      moduleNodes.every((m) => m.properties.repositoryId === 'repo-1'),
    ).toBe(true);

    const hasModuleRels = graph.relationships.filter(
      (r) => r.type === 'HAS_MODULE',
    );
    expect(hasModuleRels).toHaveLength(3);

    const repoId = 'repo:repo-1';
    for (const rel of hasModuleRels) {
      expect(rel.startNodeId).toBe(repoId);
      expect(rel.endNodeId).toMatch(/^module:/);
    }

    const hasModuleTargets = new Set(hasModuleRels.map((r) => r.endNodeId));
    for (const m of moduleNodes) {
      expect(hasModuleTargets.has(m.id)).toBe(true);
    }
  });

  it('connects each file to its module via CONTAINS', () => {
    const normalized: NormalizedGraph = {
      entities: [
        fileEntity('f1', 'login.ts', 'src/auth/login.ts'),
        fileEntity('f2', 'session.ts', 'src/auth/session.ts'),
        fileEntity('f3', 'edges.ts', 'src/graph/edges.ts'),
      ],
      relationships: [],
    };

    const graph = service.build(normalized, 'repo-1');

    const containsRels = graph.relationships.filter(
      (r) => r.type === 'CONTAINS' && r.startNodeId.startsWith('module:'),
    );

    expect(containsRels).toHaveLength(3);

    const authModuleId = 'module:src/auth';
    const authFiles = containsRels
      .filter((r) => r.startNodeId === authModuleId)
      .map((r) => r.endNodeId)
      .sort();

    expect(authFiles).toEqual(['f1', 'f2']);

    const graphModuleFiles = containsRels
      .filter((r) => r.startNodeId === 'module:src/graph')
      .map((r) => r.endNodeId);
    expect(graphModuleFiles).toEqual(['f3']);
  });

  it('skips files without a usable path property when deriving modules', () => {
    const normalized: NormalizedGraph = {
      entities: [fileEntity('f1', 'orphan.ts', undefined)],
      relationships: [],
    };

    const graph = service.build(normalized, 'repo-1');

    const moduleNodes = graph.nodes.filter((n) => n.labels.includes('Module'));
    const moduleRels = graph.relationships.filter(
      (r) => r.type === 'HAS_MODULE' || r.type === 'CONTAINS',
    );

    expect(moduleNodes).toHaveLength(0);
    expect(moduleRels).toHaveLength(0);
    // The file node itself is still persisted
    expect(graph.nodes.some((n) => n.id === 'f1')).toBe(true);
  });

  it('preserves original normalized relationships alongside synthesized ones', () => {
    const originalRel: Relationship = {
      id: 'e1',
      type: 'IMPORTS',
      sourceId: 'f1',
      targetId: 'f2',
      properties: { confidence: 'high' },
    };
    const normalized: NormalizedGraph = {
      entities: [
        fileEntity('f1', 'a.ts', 'src/a.ts'),
        fileEntity('f2', 'b.ts', 'src/b.ts'),
      ],
      relationships: [originalRel],
    };

    const graph = service.build(normalized, 'repo-1');

    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        id: 'e1',
        type: 'IMPORTS',
        startNodeId: 'f1',
        endNodeId: 'f2',
      }),
    );
  });

  it('calculates topological metrics (inDegree, outDegree, instability, isOrphan) on nodes', () => {
    const normalized: NormalizedGraph = {
      entities: [
        fileEntity('f1', 'a.ts', 'src/a.ts'),
        fileEntity('f2', 'b.ts', 'src/b.ts'),
        fileEntity('f3', 'c.ts', 'src/c.ts'),
      ],
      relationships: [
        {
          id: 'r1',
          type: 'IMPORTS',
          sourceId: 'f1',
          targetId: 'f2',
        },
        {
          id: 'r2',
          type: 'IMPORTS',
          sourceId: 'f3',
          targetId: 'f2',
        },
      ],
    };

    const graph = service.build(normalized, 'repo-1');
    const f2Node = graph.nodes.find((n) => n.id === 'f2');
    expect(f2Node).toBeDefined();
    // f2 has incoming CONTAINS from module plus 2 IMPORTS = inDegree 3
    expect(f2Node?.properties.inDegree).toBeGreaterThanOrEqual(2);
    expect(f2Node?.properties.outDegree).toBe(0);
    expect(f2Node?.properties.isOrphan).toBe(false);
  });
});
