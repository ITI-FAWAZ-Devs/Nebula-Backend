import { VectorRetrievalService } from './vector-retrieval.service';

describe('VectorRetrievalService', () => {
  const chroma = {
    queryCollection: jest.fn(),
  };
  const gemini = {
    embedString: jest.fn().mockResolvedValue([0.1, 0.2]),
  };

  const service = new VectorRetrievalService(chroma as any, gemini as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps chroma results to RetrievalHit with filters', async () => {
    chroma.queryCollection.mockResolvedValue({
      ids: [['repo:src/a.ts']],
      documents: [['Auth service description']],
      metadatas: [[{ filePath: 'src/a.ts', repositoryId: 'r1' }]],
      distances: [[0.25]],
    });

    const hits = await service.search('r1', 'auth', 5, {
      filePath: 'src/a.ts',
    });

    expect(gemini.embedString).toHaveBeenCalledWith('auth');
    expect(chroma.queryCollection).toHaveBeenCalledWith(
      'repo-r1',
      [0.1, 0.2],
      5,
      { repositoryId: 'r1', filePath: 'src/a.ts' },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      type: 'Chunk',
      filePath: 'src/a.ts',
      source: 'vector',
      content: 'Auth service description',
    });
    expect(hits[0].score).toBeGreaterThan(0);
  });
});
