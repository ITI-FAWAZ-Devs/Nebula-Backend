import { GraphRetrievalService } from './graph-retrieval.service';

describe('GraphRetrievalService', () => {
  const neo4j = {
    getDefinition: jest.fn(),
    getCallers: jest.fn(),
    getCallees: jest.fn(),
    getImplementations: jest.fn(),
    getFileContext: jest.fn(),
    getModuleOverview: jest.fn(),
  };
  const enricher = {
    mapGraphNode: jest.fn((n) => ({
      nodeId: n.id,
      type: n.labels[0],
      filePath: n.filePath,
      lineRange: null,
      content: `${n.labels[0]} ${n.name}`,
      score: 0.5,
      source: 'graph',
    })),
    enrich: jest.fn(async (_repo: string, hits: unknown[]) => hits),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const service = new GraphRetrievalService(
    neo4j as any,
    enricher as any,
    cache as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('getCallers maps and enriches nodes', async () => {
    neo4j.getCallers.mockResolvedValue([
      {
        id: 'm1',
        labels: ['Method'],
        name: 'caller',
        filePath: 'a.ts',
        sourceLocation: 'L10',
        properties: {},
      },
    ]);

    const hits = await service.getCallers('repo', 'target');
    expect(neo4j.getCallers).toHaveBeenCalledWith('repo', 'target');
    expect(enricher.enrich).toHaveBeenCalled();
    expect(hits[0].nodeId).toBe('m1');
    expect(cache.set).toHaveBeenCalled();
  });

  it('returns cached hits when present', async () => {
    cache.get.mockResolvedValueOnce([
      {
        nodeId: 'cached',
        type: 'Method',
        filePath: 'x.ts',
        lineRange: null,
        content: 'cached',
        score: 1,
        source: 'graph',
      },
    ]);
    const hits = await service.getCallees('repo', 'n1');
    expect(hits[0].nodeId).toBe('cached');
    expect(neo4j.getCallees).not.toHaveBeenCalled();
  });
});
