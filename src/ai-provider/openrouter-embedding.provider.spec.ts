import { ConfigService } from '@nestjs/config';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

describe('OpenRouterEmbeddingProvider', () => {
  const apiKey = 'or_test-key';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number | undefined> = {
        'aiProvider.openrouterApiKey': apiKey,
        'aiProvider.openrouterEmbeddingModel':
          'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        'aiProvider.openrouterEmbeddingDimensions': 0,
      };
      return values[key];
    }),
  };

  const buildProvider = (): OpenRouterEmbeddingProvider =>
    new OpenRouterEmbeddingProvider(
      mockConfigService as unknown as ConfigService,
    );

  const embedResponse = (
    embeddings: number[][],
    indexOrder?: number[],
  ): Response =>
    new Response(
      JSON.stringify({
        data: embeddings.map((embedding, i) => ({
          embedding,
          index: indexOrder ? indexOrder[i] : i,
        })),
        model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        usage: { total_tokens: 10 },
      }),
      { status: 200 },
    );

  const errorResponse = (status: number): Response =>
    new Response(JSON.stringify({ error: { message: 'boom' } }), { status });

  const createFetchMock = () =>
    jest.fn<Promise<Response>, [url: string, init: RequestInit]>();

  afterEach(() => {
    jest.restoreAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | undefined> = {
        'aiProvider.openrouterApiKey': apiKey,
        'aiProvider.openrouterEmbeddingModel':
          'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        'aiProvider.openrouterEmbeddingDimensions': 0,
      };
      return values[key];
    });
  });

  it('should send all texts in a single batched request and parse data[].embedding', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      embedResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany(['a', 'b']);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer or_test-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      input: ['a', 'b'],
    });
    expect(body.input_type).toBeUndefined();
  });

  it('should sort embeddings by their index field', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      embedResponse([[0.1], [0.2], [0.3]], [2, 0, 1]),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany(['a', 'b', 'c']);

    expect(result).toEqual([[0.2], [0.3], [0.1]]);
  });

  it('should derive dimensions from the first response when not configured', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(embedResponse([[0.1, 0.2, 0.3, 0.4]]));
    global.fetch = fetchMock;
    const provider = buildProvider();

    expect(provider.dimensions).toBe(0);
    await provider.embedMany(['a']);

    expect(provider.dimensions).toBe(4);
  });

  it('should honor a configured dimension before any call', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | undefined> = {
        'aiProvider.openrouterApiKey': apiKey,
        'aiProvider.openrouterEmbeddingModel':
          'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        'aiProvider.openrouterEmbeddingDimensions': 2048,
      };
      return values[key];
    });
    const provider = buildProvider();

    expect(provider.dimensions).toBe(2048);
  });

  it('should attach the HTTP status to non-OK responses', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(errorResponse(429));
    global.fetch = fetchMock;
    const provider = buildProvider();

    let caught: (Error & { status?: number }) | undefined;
    try {
      await provider.embedMany(['a']);
      throw new Error('expected embedMany to reject');
    } catch (e) {
      caught = e as Error & { status?: number };
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.status).toBe(429);
    expect(caught?.message).toContain('status 429');
  });

  it('should reject a response with the wrong number of embeddings', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(embedResponse([[0.1]]));
    global.fetch = fetchMock;
    const provider = buildProvider();

    await expect(provider.embedMany(['a', 'b'])).rejects.toThrow(
      'expected 2 embeddings',
    );
  });

  it('should return an empty array for an empty batch without calling fetch', async () => {
    const fetchMock = createFetchMock();
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should throw a config error when the API key is missing', async () => {
    mockConfigService.get.mockReturnValue(undefined);
    const provider = buildProvider();

    await expect(provider.embedMany(['a'])).rejects.toThrow(
      'OPENROUTER_API_KEY',
    );
  });
});
