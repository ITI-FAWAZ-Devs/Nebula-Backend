import { Test, TestingModule } from '@nestjs/testing';
import { ExecutorService } from './executor.service';
import { VectorRetrievalService } from '../retrieval/vector-retrieval.service';
import { GraphRetrievalService } from '../retrieval/graph-retrieval.service';
import { HybridRetrievalService } from '../retrieval/hybrid-retrieval.service';
import { TavilySearchService } from '../retrieval/tavily-search.service';

describe('ExecutorService', () => {
  let service: ExecutorService;
  let vectorMock: { search: jest.Mock };
  let graphMock: Record<string, jest.Mock>;
  let hybridMock: { retrieve: jest.Mock };
  let tavilyMock: { search: jest.Mock };

  beforeEach(async () => {
    vectorMock = { search: jest.fn().mockResolvedValue([]) };
    graphMock = {
      getDefinition: jest.fn().mockResolvedValue([]),
      getCallers: jest.fn().mockResolvedValue([]),
      getCallees: jest.fn().mockResolvedValue([]),
      getImplementations: jest.fn().mockResolvedValue([]),
      getFileContext: jest.fn().mockResolvedValue([]),
      getModuleOverview: jest.fn().mockResolvedValue([]),
    };
    hybridMock = { retrieve: jest.fn().mockResolvedValue([]) };
    tavilyMock = { search: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutorService,
        { provide: VectorRetrievalService, useValue: vectorMock },
        { provide: GraphRetrievalService, useValue: graphMock },
        { provide: HybridRetrievalService, useValue: hybridMock },
        { provide: TavilySearchService, useValue: tavilyMock },
      ],
    }).compile();

    service = module.get(ExecutorService);
  });

  it('dispatches web_search to Tavily and does not treat results as retrieval hits', async () => {
    tavilyMock.search.mockResolvedValue([
      {
        title: 'Docs',
        url: 'https://example.com',
        snippet: 'public docs',
        score: 0.8,
      },
    ]);

    const result = await service.execute('repo-1', [
      {
        name: 'web_search',
        args: { query: 'electron multi-process', maxResults: 3 },
      },
    ]);

    expect(tavilyMock.search).toHaveBeenCalledWith('electron multi-process', 3);
    expect(result.hits).toEqual([]);
    expect(result.toolsUsed).toEqual(['web_search']);
    expect(result.webResults).toHaveLength(1);
    expect(result.webResults[0].url).toBe('https://example.com');
  });

  it('dispatches hybrid_search independently of web results', async () => {
    hybridMock.retrieve.mockResolvedValue([
      {
        nodeId: 'n1',
        type: 'Chunk',
        filePath: 'src/main.ts',
        lineRange: null,
        content: 'boot',
        score: 0.9,
        source: 'vector',
      },
    ]);

    const result = await service.execute('repo-1', [
      { name: 'hybrid_search', args: { query: 'boot', k: 8 } },
    ]);

    expect(hybridMock.retrieve).toHaveBeenCalledWith('repo-1', 'boot', 8);
    expect(result.hits).toHaveLength(1);
    expect(result.webResults).toEqual([]);
  });
});
