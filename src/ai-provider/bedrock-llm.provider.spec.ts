import { ConfigService } from '@nestjs/config';
import {
  BedrockGatewayLlmProvider,
  RETRY_ATTEMPTS,
} from './bedrock-llm.provider';

describe('BedrockGatewayLlmProvider', () => {
  const baseUrl = 'http://gateway.test/api/v1/';
  const apiKey = 'sbg_test-key';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number | string[] | undefined> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockLlmModel': 'openai.gpt-oss-120b-1:0',
        'aiProvider.bedrockLlmModelStrong': 'anthropic.claude-sonnet-4-6',
        'aiProvider.bedrockMaxTokens': 16384,
      };
      return values[key];
    }),
  };

  const buildProvider = (): BedrockGatewayLlmProvider =>
    new BedrockGatewayLlmProvider(
      mockConfigService as unknown as ConfigService,
    );

  const chatResponse = (outputText: string): Response =>
    new Response(
      JSON.stringify({
        request_id: 'req-1',
        model_id: 'openai.gpt-oss-120b-1:0',
        region: 'us-east-1',
        output_text: outputText,
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          total_tokens: 7,
          stop_reason: 'end_turn',
        },
        status: 'active',
      }),
      { status: 200 },
    );

  const errorResponse = (status: number): Response =>
    new Response(JSON.stringify({ error: { message: 'boom' } }), { status });

  const networkError = (message = 'fetch failed'): Error =>
    Object.assign(new TypeError(message), {
      cause: new Error('connect ECONNREFUSED 10.0.0.1:443'),
    });

  const createFetchMock = () =>
    jest.fn<Promise<Response>, [url: string, init: RequestInit]>();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should send model_id, messages and max_tokens and return output_text', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(chatResponse('pong'));
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.generateContent('Reply with pong');

    expect(result).toEqual({
      text: 'pong',
      model: 'openai.gpt-oss-120b-1:0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway.test/api/v1/student/chat');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sbg_test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model_id: 'openai.gpt-oss-120b-1:0',
      messages: [{ role: 'user', content: 'Reply with pong' }],
      max_tokens: 16384,
    });
  });

  it('should use the strong model for the strong tier', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(chatResponse('pong'));
    global.fetch = fetchMock;
    const provider = buildProvider();

    await provider.generateContent('prompt', { tier: 'strong' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string) as { model_id: string };
    expect(body.model_id).toBe('anthropic.claude-sonnet-4-6');
  });

  it('should attach the HTTP status to non-OK responses', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(errorResponse(502));
    global.fetch = fetchMock;
    const provider = buildProvider();

    let caught: (Error & { status?: number }) | undefined;
    try {
      await provider.generateContent('prompt');
      throw new Error('expected generateContent to reject');
    } catch (e) {
      caught = e as Error & { status?: number };
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.status).toBe(502);
    expect(caught?.message).toContain('status 502');
  });

  it('should not retry on HTTP error responses', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(errorResponse(502));
    global.fetch = fetchMock;
    const provider = buildProvider();

    await expect(provider.generateContent('prompt')).rejects.toThrow(
      'status 502',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should retry network errors up to RETRY_ATTEMPTS times then throw with detail', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockRejectedValue(networkError());
    global.fetch = fetchMock;
    const provider = buildProvider();

    await expect(provider.generateContent('prompt')).rejects.toThrow(
      `after ${RETRY_ATTEMPTS} attempts`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
  });

  it('should succeed on a later attempt after transient network errors', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(chatResponse('pong'));
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.generateContent('prompt');

    expect(result.text).toBe('pong');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('should throw a config error when the gateway is not configured', async () => {
    mockConfigService.get.mockReturnValue(undefined);
    const provider = buildProvider();

    await expect(provider.generateContent('prompt')).rejects.toThrow(
      'Bedrock gateway is not configured',
    );
  });

  it('should try models in order and succeed on the second model', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | string[]> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockLlmModels': [
          'model-alpha',
          'model-beta',
          'model-gamma',
        ],
        'aiProvider.bedrockMaxTokens': 16384,
      };
      return values[key];
    });
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(errorResponse(502))
      .mockResolvedValueOnce(chatResponse('from-beta'));
    global.fetch = fetchMock;
    const provider = buildProvider();

    const result = await provider.generateContent('prompt');

    expect(result).toEqual({ text: 'from-beta', model: 'model-beta' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const modelIds = fetchMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse(init.body as string) as { model_id: string }).model_id,
    );
    expect(modelIds).toEqual(['model-alpha', 'model-beta']);
  });

  it('should try every model and throw the last error when all fail', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | number | string[]> = {
        'aiProvider.sbgApiKey': apiKey,
        'aiProvider.bedrockGatewayBaseUrl': baseUrl,
        'aiProvider.bedrockLlmModels': ['model-alpha', 'model-beta'],
        'aiProvider.bedrockMaxTokens': 16384,
      };
      return values[key];
    });
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(502));
    global.fetch = fetchMock;
    const provider = buildProvider();

    let caught: (Error & { status?: number }) | undefined;
    try {
      await provider.generateContent('prompt');
      throw new Error('expected generateContent to reject');
    } catch (e) {
      caught = e as Error & { status?: number };
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const modelIds = fetchMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse(init.body as string) as { model_id: string }).model_id,
    );
    expect(modelIds).toEqual(['model-alpha', 'model-beta']);
  });
});
