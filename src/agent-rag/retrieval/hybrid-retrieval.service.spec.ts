import { HybridRetrievalService } from './hybrid-retrieval.service';

describe('HybridRetrievalService', () => {
  const vector = {
    search: jest.fn(),
  };
  const graph = {
    getFileContext: jest.fn(),
    getModuleOverview: jest.fn(),
  };
  const reranker = {
    rerank: jest.fn(async (_q: string, hits: unknown[]) => hits),
  };
  const enricher = {
    enrich: jest.fn(async (_repo: string, hits: unknown[]) => hits),
  };

  const service = new HybridRetrievalService(
    vector as any,
    graph as any,
    reranker as any,
    enricher as any,
  );

  it('expands vector hits via graph tools then reranks', async () => {
    vector.search.mockResolvedValue([
      {
        nodeId: 'c1',
        type: 'Chunk',
        filePath: 'src/a.ts',
        lineRange: null,
        content: 'desc',
        score: 0.8,
        source: 'vector',
      },
    ]);
    graph.getFileContext.mockResolvedValue([
      {
        nodeId: 'g1',
        type: 'Class',
        filePath: 'src/a.ts',
        lineRange: '1',
        content: 'Class A',
        score: 0.5,
        source: 'graph',
      },
    ]);
    graph.getModuleOverview.mockResolvedValue([]);

    const hits = await service.retrieve('repo', 'how does auth work', 5);
    expect(vector.search).toHaveBeenCalled();
    expect(graph.getFileContext).toHaveBeenCalledWith('repo', 'src/a.ts');
    expect(graph.getModuleOverview).toHaveBeenCalledWith('repo', 'src/a.ts');
    expect(reranker.rerank).toHaveBeenCalled();
    expect(hits.map((h) => h.nodeId).sort()).toEqual(['c1', 'g1']);
  });
});
