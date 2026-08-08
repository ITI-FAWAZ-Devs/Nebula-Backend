import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProviderService } from './ai-provider.service';
import { BedrockGatewayLlmProvider } from './bedrock-llm.provider';
import { BedrockGatewayEmbeddingProvider } from './bedrock-embedding.provider';
import { GeminiLlmProvider } from './gemini-llm.provider';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

describe('AiProviderService', () => {
  let service: AiProviderService;
  let providerOrder: string | undefined;
  let llmOrderOverride: string | undefined;
  let embeddingOrderOverride: string | undefined;
  let openrouterKey: string | undefined;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockBedrockLlm = {
    name: 'bedrock',
    generateContent: jest.fn(),
  };

  const mockGeminiLlm = {
    name: 'gemini',
    generateContent: jest.fn(),
  };

  const mockBedrockEmbedding = {
    name: 'bedrock',
    model: 'bedrock-embed-model',
    dimensions: 1024,
    embedString: jest.fn(),
    embedMany: jest.fn(),
  };

  const mockOpenRouterEmbedding = {
    name: 'openrouter',
    model: 'openrouter-embed-model',
    dimensions: 0,
    embedString: jest.fn(),
    embedMany: jest.fn(),
  };

  const mockGeminiEmbedding = {
    name: 'gemini',
    model: 'gemini-embed-model',
    dimensions: 768,
    embedString: jest.fn(),
    embedMany: jest.fn(),
  };

  const transientError = () =>
    Object.assign(new Error('upstream unavailable'), {
      name: 'ServiceUnavailableException',
    });

  const buildService = async (): Promise<AiProviderService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProviderService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: BedrockGatewayLlmProvider, useValue: mockBedrockLlm },
        {
          provide: BedrockGatewayEmbeddingProvider,
          useValue: mockBedrockEmbedding,
        },
        {
          provide: OpenRouterEmbeddingProvider,
          useValue: mockOpenRouterEmbedding,
        },
        { provide: GeminiLlmProvider, useValue: mockGeminiLlm },
        { provide: GeminiEmbeddingProvider, useValue: mockGeminiEmbedding },
      ],
    }).compile();

    return module.get<AiProviderService>(AiProviderService);
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    providerOrder = undefined;
    llmOrderOverride = undefined;
    embeddingOrderOverride = undefined;
    openrouterKey = undefined;
    mockConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, string | undefined> = {
        'aiProvider.providerOrder': providerOrder,
        'aiProvider.llmProviderOrder': llmOrderOverride,
        'aiProvider.embeddingProviderOrder': embeddingOrderOverride,
        'aiProvider.openrouterApiKey': openrouterKey,
      };
      return values[key];
    });

    service = await buildService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateContent', () => {
    it('should prefer gemini by default and tag the result', async () => {
      mockGeminiLlm.generateContent.mockResolvedValue({
        text: 'gemini answer',
        model: 'gemini-model',
      });

      const result = await service.generateContent('prompt');

      expect(mockGeminiLlm.generateContent).toHaveBeenCalledWith('prompt', {
        tier: 'standard',
      });
      expect(mockBedrockLlm.generateContent).not.toHaveBeenCalled();
      expect(result.text).toBe('gemini answer');
      expect(result.provider).toBe('gemini');
      expect(result.tier).toBe('standard');
      expect(result.fallbackOccurred).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should forward the strong tier', async () => {
      mockGeminiLlm.generateContent.mockResolvedValue({
        text: 'strong answer',
        model: 'gemini-model',
      });

      const result = await service.generateContent('prompt', {
        tier: 'strong',
      });

      expect(mockGeminiLlm.generateContent).toHaveBeenCalledWith('prompt', {
        tier: 'strong',
      });
      expect(result.tier).toBe('strong');
    });

    it('should throw immediately on primary provider failure without falling back', async () => {
      mockGeminiLlm.generateContent.mockRejectedValue(transientError());

      await expect(service.generateContent('prompt')).rejects.toThrow(
        'upstream unavailable',
      );
      expect(mockBedrockLlm.generateContent).not.toHaveBeenCalled();
    });

    it('should throw when the order resolves to no LLM providers', async () => {
      providerOrder = 'unknown-provider';
      service = await buildService();

      await expect(service.generateContent('prompt')).rejects.toThrow(
        'No LLM providers are configured',
      );
    });

    it('should serve bedrock first when AI_PROVIDER_ORDER=bedrock', async () => {
      providerOrder = 'bedrock';
      service = await buildService();
      mockBedrockLlm.generateContent.mockResolvedValue({
        text: 'bedrock first',
        model: 'bedrock-model',
      });

      const result = await service.generateContent('prompt');

      expect(result.provider).toBe('bedrock');
      expect(result.fallbackOccurred).toBe(false);
      expect(mockGeminiLlm.generateContent).not.toHaveBeenCalled();
    });
  });

  describe('embedMany', () => {
    it('should embed via gemini by default', async () => {
      mockGeminiEmbedding.embedMany.mockResolvedValue([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);

      const result = await service.embedMany(['a', 'b']);

      expect(mockGeminiEmbedding.embedMany).toHaveBeenCalledWith(
        ['a', 'b'],
        'search_document',
        expect.anything(),
      );
      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-embed-model');
      expect(result.dimensions).toBe(768);
      expect(result.embeddings).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      expect(result.fallbackOccurred).toBe(false);
    });

    it('should forward the search_query input type', async () => {
      mockGeminiEmbedding.embedMany.mockResolvedValue([[0.9, 0.8]]);

      const result = await service.embedMany(['q'], 'search_query');

      expect(mockGeminiEmbedding.embedMany).toHaveBeenCalledWith(
        ['q'],
        'search_query',
        expect.anything(),
      );
      expect(result.dimensions).toBe(768);
    });

    it('should throw immediately when embedding fails without falling back', async () => {
      mockGeminiEmbedding.embedMany.mockRejectedValue(transientError());

      await expect(service.embedMany(['a'])).rejects.toThrow('upstream unavailable');
      expect(mockBedrockEmbedding.embedMany).not.toHaveBeenCalled();
    });

    it('should serve openrouter first when EMBEDDING_PROVIDER_ORDER puts it first', async () => {
      openrouterKey = 'or-key';
      embeddingOrderOverride = 'openrouter,gemini';
      service = await buildService();
      mockOpenRouterEmbedding.embedMany.mockResolvedValue([[0.7, 0.8]]);

      const result = await service.embedMany(['a']);

      expect(result.provider).toBe('openrouter');
      expect(result.fallbackOccurred).toBe(false);
      expect(mockBedrockEmbedding.embedMany).not.toHaveBeenCalled();
    });

    it('should return an empty batch without calling providers', async () => {
      const result = await service.embedMany([]);

      expect(result.embeddings).toEqual([]);
      expect(mockBedrockEmbedding.embedMany).not.toHaveBeenCalled();
      expect(mockGeminiEmbedding.embedMany).not.toHaveBeenCalled();
    });
  });

  describe('embedString', () => {
    it('should return a single embedding result using search_query', async () => {
      mockGeminiEmbedding.embedMany.mockResolvedValue([[0.1, 0.2]]);

      const result = await service.embedString('hello');

      expect(mockGeminiEmbedding.embedMany).toHaveBeenCalledWith(
        ['hello'],
        'search_query',
        expect.anything(),
      );
      expect(result.embedding).toEqual([0.1, 0.2]);
      expect(result.provider).toBe('gemini');
      expect(result.dimensions).toBe(768);
    });
  });

  describe('describeFile / answerQuestion', () => {
    it('should delegate to generateContent with the default tier', async () => {
      mockGeminiLlm.generateContent.mockResolvedValue({
        text: 'described',
        model: 'gemini-model',
      });

      const result = await service.describeFile('src/a.ts', 'content');

      expect(mockGeminiLlm.generateContent).toHaveBeenCalled();
      expect(result.text).toBe('described');
      expect(result.provider).toBe('gemini');
    });

    it('should answer grounded questions', async () => {
      mockGeminiLlm.generateContent.mockResolvedValue({
        text: 'answer',
        model: 'gemini-model',
      });

      const result = await service.answerQuestion('q', 'ctx');

      expect(result.text).toBe('answer');
    });
  });
});
