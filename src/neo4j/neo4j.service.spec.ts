import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from './neo4j.service';
import neo4j from 'neo4j-driver';

describe('Neo4jService', () => {
  let service: Neo4jService;

  const mockSession = {
    run: jest.fn().mockResolvedValue({ records: [] }),
    close: jest.fn().mockResolvedValue(undefined),
    beginTransaction: jest.fn(),
  };

  const mockTx = {
    run: jest.fn().mockResolvedValue({ records: [] }),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const mockDriver = {
    session: jest.fn().mockReturnValue(mockSession),
    close: jest.fn(),
    verifyConnectivity: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string | undefined> = {
        'neo4j.uri': 'bolt://localhost:7687',
        'neo4j.username': 'neo4j',
        'neo4j.password': 'password',
        'neo4j.database': 'neo4j',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Neo4jService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    })
      .overrideProvider(Neo4jService)
      .useFactory({
        factory: () => {
          const svc = new Neo4jService(
            mockConfigService as unknown as ConfigService,
          );
          (svc as any).driver = mockDriver;
          return svc;
        },
      })
      .compile();

    service = module.get<Neo4jService>(Neo4jService);
    jest.clearAllMocks();
    mockSession.run.mockResolvedValue({ records: [] });
    mockSession.close.mockResolvedValue(undefined);
    mockSession.beginTransaction.mockReturnValue(mockTx);
    mockTx.run.mockResolvedValue({ records: [] });
  });

  // ── getFileNeighborhood ──────────────────────────────────────────────────────

  describe('getFileNeighborhood', () => {
    const repositoryId = 'repo-123';
    const seedPaths = ['src/main.ts', 'src/utils/helper.ts'];
    const maxHops = 1;

    it('passes repositoryId, seedPaths and integer maxHops', async () => {
      await service.getFileNeighborhood(repositoryId, seedPaths, maxHops);

      const [cypher, params] = mockSession.run.mock.calls[0];
      expect(params.repositoryId).toBe(repositoryId);
      expect(params.seedPaths).toEqual(seedPaths);
      expect(params.maxHops).toBeDefined();
    });

    it('Cypher contains keys() and WHERE for correct property lookup', async () => {
      await service.getFileNeighborhood(repositoryId, seedPaths, maxHops);

      const cypher: string = mockSession.run.mock.calls[0][0];
      expect(cypher).toContain('keys(start)');
      expect(cypher).toContain('WHERE key IN keys(start)');
    });

    it('closes session after success', async () => {
      await service.getFileNeighborhood(repositoryId, seedPaths, maxHops);
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('closes session on error', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('Query failed'));
      await expect(
        service.getFileNeighborhood(repositoryId, seedPaths, maxHops),
      ).rejects.toThrow('Query failed');
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns empty result when no records found', async () => {
      const result = await service.getFileNeighborhood(
        repositoryId,
        seedPaths,
        maxHops,
      );
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.clusters).toEqual([]);
    });
  });

  // ── label / rel-type validation ──────────────────────────────────────────────

  describe('saveGraph — label and relationship validation', () => {
    const baseGraph = {
      repositoryId: 'repo-xyz',
      nodes:
        [] as import('../graph/interfaces/knowledge-graph.interface').GraphNode[],
      relationships:
        [] as import('../graph/interfaces/knowledge-graph.interface').GraphRelationship[],
    };

    beforeEach(() => {
      mockSession.beginTransaction.mockReturnValue(mockTx);
    });

    it('maps unknown node label to "Function" and logs warning', async () => {
      const graph = {
        ...baseGraph,
        nodes: [
          {
            id: 'n1',
            labels: ['SomeUnknownType'],
            properties: { repositoryId: 'repo-xyz' },
          },
        ],
      };

      await service.saveGraph(graph);

      const mergeCall = mockTx.run.mock.calls.find(([cypher]: [string]) =>
        cypher.includes('MERGE'),
      );
      expect(mergeCall?.[0]).toContain(':Function');
    });

    it('skips relationships with unknown types', async () => {
      const graph = {
        ...baseGraph,
        relationships: [
          {
            id: 'r1',
            type: 'UNKNOWN_REL',
            startNodeId: 'n1',
            endNodeId: 'n2',
            properties: { repositoryId: 'repo-xyz' },
          },
        ],
      };

      await service.saveGraph(graph);

      // No MERGE should have been called for relationships
      const mergeRelCall = mockTx.run.mock.calls.find(
        ([cypher]: [string]) =>
          cypher.includes('MERGE (a)-[r:') && cypher.includes('UNKNOWN_REL'),
      );
      expect(mergeRelCall).toBeUndefined();
    });

    it('includes repositoryId in MERGE predicate for node isolation', async () => {
      const graph = {
        ...baseGraph,
        nodes: [
          {
            id: 'n2',
            labels: ['File'],
            properties: { repositoryId: 'repo-xyz' },
          },
        ],
      };

      await service.saveGraph(graph);

      const mergeCall = mockTx.run.mock.calls.find(([cypher]: [string]) =>
        cypher.includes(':File'),
      );
      expect(mergeCall?.[0]).toContain('repositoryId: $repositoryId');
    });

    it('commits on success', async () => {
      await service.saveGraph(baseGraph);
      expect(mockTx.commit).toHaveBeenCalledTimes(1);
      expect(mockTx.rollback).not.toHaveBeenCalled();
    });

    it('rolls back and rethrows on error', async () => {
      mockTx.run.mockRejectedValueOnce(new Error('write failed'));

      await expect(service.saveGraph(baseGraph)).rejects.toThrow(
        'write failed',
      );
      expect(mockTx.rollback).toHaveBeenCalledTimes(1);
    });
  });

  // ── Graph Analytics ──────────────────────────────────────────────────────────

  describe('Graph Analytics Queries', () => {
    const repositoryId = 'repo-test';

    it('getCircularDependencies runs parameterized Cypher and formats output', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (field: string) =>
              field === 'cycle'
                ? ['src/a.ts', 'src/b.ts', 'src/a.ts']
                : neo4j.int(2),
          },
        ],
      });

      const res = await service.getCircularDependencies(repositoryId, 5);
      expect(res).toHaveLength(1);
      expect(res[0].cycleLength).toBe(2);
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('getImpactAnalysis queries transitive upstream dependents', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (field: string) =>
              field === 'dependentFile'
                ? 'src/controller.ts'
                : field === 'depth'
                  ? neo4j.int(1)
                  : ['IMPORTS'],
          },
        ],
      });

      const res = await service.getImpactAnalysis(repositoryId, 'src/service.ts');
      expect(res).toHaveLength(1);
      expect(res[0].dependentFile).toBe('src/controller.ts');
      expect(res[0].depth).toBe(1);
    });

    it('getArchitectureGraph returns nodes and edges', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (field: string) =>
              field === 'nodes'
                ? [{ id: 'n1', name: 'File1', labels: ['File'], properties: {} }]
                : [{ id: 'e1', source: 'n1', target: 'n2', type: 'IMPORTS', properties: {} }],
          },
        ],
      });

      const res = await service.getArchitectureGraph(repositoryId);
      expect(res.nodes).toHaveLength(1);
      expect(res.edges).toHaveLength(1);
    });
  });
});
