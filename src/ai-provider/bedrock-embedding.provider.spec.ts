import { ConfigService } from '@nestjs/config';
import { BedrockGatewayEmbeddingProvider } from './bedrock-embedding.provider';

describe('BedrockGatewayEmbeddingProvider', () => {
  const baseUrl = 'http://gateway.test/api/v1/';
  const apiKey = 'sbg_test-key';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number | string[]> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockEmbeddingModels': ['us.cohere.embed-v4:0'],
        'aiProvider.bedrockEmbeddingDimensions': 1024,
      };
      return values[key];
    }),
  };

  const buildProvider = (): BedrockGatewayEmbeddingProvider =>
    new BedrockGatewayEmbeddingProvider(
      mockConfigService as unknown as ConfigService,
    );

  const embedResponse = (
    embeddings: number[][],
    field: 'embeddings' | 'data',
  ): Response => {
    const body =
      field === 'embeddings'
        ? { embeddings }
        : { data: embeddings.map((embedding) => ({ embedding })) };
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const errorResponse = (status: number): Response =>
    new Response(JSON.stringify({ error: { message: 'boom' } }), { status });

  const createFetchMock = () =>
    jest.fn<Promise<Response>, [url: string, init: RequestInit]>();

  afterEach(() => {
    jest.restoreAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | string[]> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockEmbeddingModels': ['us.cohere.embed-v4:0'],
        'aiProvider.bedrockEmbeddingDimensions': 1024,
      };
      return values[key];
    });
  });

  it('should probe to resolve the model, then embed the actual text', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(() =>
      Promise.resolve(embedResponse([[0.1, 0.2, 0.3]], 'embeddings')),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedString('hello', 'search_query');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [probeUrl, probeInit] = fetchMock.mock.calls[0];
    expect(probeUrl).toBe('http://gateway.test/api/v1/student/embed');
    expect(JSON.parse(probeInit.body as string)).toEqual({
      model_id: 'us.cohere.embed-v4:0',
      texts: ['probe'],
      input_type: 'search_document',
    });

    const [, embedInit] = fetchMock.mock.calls[1];
    expect(embedInit.headers).toMatchObject({
      Authorization: 'Bearer sbg_test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(embedInit.body as string)).toEqual({
      model_id: 'us.cohere.embed-v4:0',
      texts: ['hello'],
      input_type: 'search_query',
    });
  });

  it('should resolve only once and reuse the pinned model', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(() =>
      Promise.resolve(embedResponse([[0.1]], 'embeddings')),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    await provider.embedMany(['a'], 'search_document');
    await provider.embedMany(['b'], 'search_document');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(provider.model).toBe('us.cohere.embed-v4:0');
    expect(provider.dimensions).toBe(1);
  });

  it('should parse the data[].embedding response variant', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(() =>
      Promise.resolve(embedResponse([[0.5, 0.6]], 'data')),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany(['text'], 'search_document');

    expect(result).toEqual([[0.5, 0.6]]);
  });

  it('should split a multi-text batch into one request per text', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(() =>
      Promise.resolve(embedResponse([[0.1]], 'embeddings')),
    );
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany(['a', 'b', 'c'], 'search_document');

    expect(result).toEqual([[0.1], [0.1], [0.1]]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      const { texts } = JSON.parse(init.body as string) as {
        texts: unknown[];
      };
      expect(texts).toHaveLength(1);
    }
  });

  it('should return an empty array for an empty batch without probing', async () => {
    const fetchMock = createFetchMock();
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany([], 'search_document');

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should attach the HTTP status to a failed embed after resolution', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(embedResponse([[0.1, 0.2]], 'embeddings'))
      .mockResolvedValueOnce(errorResponse(502));
    global.fetch = fetchMock;
    const provider = buildProvider();

    let caught: (Error & { status?: number }) | undefined;
    try {
      await provider.embedMany(['text'], 'search_document');
      throw new Error('expected embedMany to reject');
    } catch (e) {
      caught = e as Error & { status?: number };
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.status).toBe(502);
    expect(caught?.message).toContain('status 502');
  });

  it('should try the candidates in order and pin the first that works', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | string[]> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockEmbeddingModels': ['model-a', 'model-b', 'model-c'],
        'aiProvider.bedrockEmbeddingDimensions': 1024,
      };
      return values[key];
    });
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(errorResponse(502))
      .mockResolvedValueOnce(errorResponse(403))
      .mockResolvedValueOnce(embedResponse([[0.1, 0.2]], 'embeddings'))
      .mockResolvedValueOnce(embedResponse([[0.3, 0.4]], 'embeddings'));
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.embedMany(['hello'], 'search_query');

    expect(result).toEqual([[0.3, 0.4]]);
    expect(provider.model).toBe('model-c');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [probeA] = fetchMock.mock.calls[0];
    const [probeB] = fetchMock.mock.calls[1];
    const [, probeCInit] = fetchMock.mock.calls[2];
    const [, embedInit] = fetchMock.mock.calls[3];
    expect(probeA).toBe('http://gateway.test/api/v1/student/embed');
    expect(probeB).toBe('http://gateway.test/api/v1/student/embed');
    const probeCBody = JSON.parse(probeCInit.body as string) as {
      model_id: string;
    };
    expect(probeCBody.model_id).toBe('model-c');
    expect(JSON.parse(embedInit.body as string)).toEqual({
      model_id: 'model-c',
      texts: ['hello'],
      input_type: 'search_query',
    });
  });

  it('should throw a transient aggregate error when every candidate fails', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(errorResponse(503));
    global.fetch = fetchMock;
    const provider = buildProvider();

    let caught: (Error & { name?: string }) | undefined;
    try {
      await provider.embedMany(['text'], 'search_document');
      throw new Error('expected embedMany to reject');
    } catch (e) {
      caught = e as Error & { name?: string };
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.name).toBe('ServiceUnavailableException');
    expect(caught?.message).toContain('No Bedrock embedding model resolved');
    expect(caught?.message).toContain('us.cohere.embed-v4:0');
  });
});
