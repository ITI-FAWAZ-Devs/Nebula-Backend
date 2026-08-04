import { Test, TestingModule } from '@nestjs/testing';
import { SectionGeneratorService } from './section-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { SectionPlan, DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

describe('SectionGeneratorService', () => {
  let service: SectionGeneratorService;
  let aiProvider: AiProviderService;

  const mockHybridRetriever = {
    retrieve: jest.fn(),
  };

  const mockAiProvider = {
    generateContent: jest.fn(),
  };

  const mockCodeContextLoader = {
    enrich: jest.fn(),
  };

  const llmResult = (text: string) => ({
    text,
    provider: 'bedrock',
    model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    tier: 'strong' as const,
    latencyMs: 1,
    fallbackOccurred: false,
  });

  const mockContext: HybridRetrievalContext = {
    repositoryId: 'repo-123',
    files: [
      {
        filePath: 'src/auth.ts',
        description: 'Auth module',
        evidenceSources: ['semantic'],
        combinedScore: 100,
      },
      {
        filePath: 'src/user.ts',
        description: 'User module',
        evidenceSources: ['semantic'],
        combinedScore: 90,
      },
    ],
    relationships: [],
    moduleClusters: [],
    missingSeedPaths: [],
    sourceStatus: { semantic: 'available', graph: 'available' },
    noEvidence: false,
  };

  const mockPlan: SectionPlan = {
    key: 'auth-module',
    title: 'Authentication Module',
    purpose: 'Handles user authentication',
    retrievalTopic: 'authentication implementation',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionGeneratorService,
        { provide: HybridRetrieverService, useValue: mockHybridRetriever },
        { provide: AiProviderService, useValue: mockAiProvider },
        { provide: CodeContextLoaderService, useValue: mockCodeContextLoader },
      ],
    }).compile();

    service = module.get<SectionGeneratorService>(SectionGeneratorService);
    aiProvider = module.get<AiProviderService>(AiProviderService);

    jest.clearAllMocks();
    mockCodeContextLoader.enrich.mockImplementation((context) => context);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    const repositoryId = 'repo-123';

    it('should generate content with inline citations', async () => {
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `## Authentication Module

The authentication module handles user login [src/auth.ts] and user registration [src/user.ts].`,
        ),
      );

      const result = await service.generate(repositoryId, mockPlan);

      expect(result.key).toBe('auth-module');
      expect(result.title).toBe('Authentication Module');
      expect(result.contentMd).toContain('[src/auth.ts]');
      expect(result.contentMd).toContain('[src/user.ts]');
      expect(result.verdict).toBe('unverified');
    });

    it('should populate sourceFiles only from evidence paths', async () => {
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `## Authentication Module

The authentication module handles user login [src/auth.ts] and user registration [src/user.ts].`,
        ),
      );

      const result = await service.generate(repositoryId, mockPlan);

      expect(result.sourceFiles).toContain('src/auth.ts');
      expect(result.sourceFiles).toContain('src/user.ts');
      expect(result.sourceFiles).toHaveLength(2);
    });

    it('should exclude citation paths absent from context', async () => {
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `## Authentication Module

The authentication module handles user login [src/auth.ts] and uses a library [src/external-lib.ts].`,
        ),
      );

      const result = await service.generate(repositoryId, mockPlan);

      expect(result.sourceFiles).toContain('src/auth.ts');
      expect(result.sourceFiles).not.toContain('src/external-lib.ts');
    });

    it('should handle empty focused context', async () => {
      const emptyContext: HybridRetrievalContext = {
        ...mockContext,
        files: [],
        noEvidence: true,
      };
      mockHybridRetriever.retrieve.mockResolvedValue(emptyContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('## Authentication Module\n\nNo evidence available.'),
      );

      const result = await service.generate(repositoryId, mockPlan);

      expect(result.key).toBe('auth-module');
      expect(result.verdict).toBe('unverified');
      expect(result.sourceFiles).toHaveLength(0);
    });

    it('should use provided context when given', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('## Authentication Module\n\nHandles auth [src/auth.ts].'),
      );

      const result = await service.generate(
        repositoryId,
        mockPlan,
        mockContext,
      );

      expect(mockHybridRetriever.retrieve).not.toHaveBeenCalled();
      expect(result.sourceFiles).toContain('src/auth.ts');
    });

    it('should fail when retrieval fails', async () => {
      mockHybridRetriever.retrieve.mockRejectedValue(
        new Error('Retrieval failed'),
      );

      await expect(service.generate(repositoryId, mockPlan)).rejects.toThrow(
        'Retrieval failed',
      );
    });

    it('should embed loaded codeContent in the prompt (US1)', async () => {
      const enrichedContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            ...mockContext.files[0],
            codeContent: 'export const login = () => {};',
          },
        ],
      };
      mockCodeContextLoader.enrich.mockResolvedValue(enrichedContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('## Authentication Module\n\nHandles auth [src/auth.ts].'),
      );

      await service.generate(
        repositoryId,
        mockPlan,
        mockContext,
        '/workspace/repo',
      );

      expect(mockCodeContextLoader.enrich).toHaveBeenCalledWith(
        mockContext,
        '/workspace/repo',
      );
      const prompt = mockAiProvider.generateContent.mock.calls[0][0];
      expect(prompt).toContain('Source code evidence');
      expect(prompt).toContain('export const login = () => {};');
      expect(prompt).toContain('src/auth.ts');
    });

    it('should render [code unavailable] markers for files with a load error (US1)', async () => {
      const erroredContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            ...mockContext.files[0],
            codeLoadError: 'EISDIR: illegal operation on a directory',
          },
        ],
      };
      mockCodeContextLoader.enrich.mockResolvedValue(erroredContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('## Authentication Module\n\nHandles auth [src/auth.ts].'),
      );

      await service.generate(
        repositoryId,
        mockPlan,
        mockContext,
        '/workspace/repo',
      );

      const prompt = mockAiProvider.generateContent.mock.calls[0][0];
      expect(prompt).toContain(
        '[code unavailable: EISDIR: illegal operation on a directory]',
      );
      expect(prompt).toContain('src/auth.ts: Auth module');
    });

    it('should instruct the LLM to embed verbatim code snippets (US5)', async () => {
      const enrichedContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            ...mockContext.files[0],
            codeContent: 'export const login = () => {};',
          },
        ],
      };
      mockCodeContextLoader.enrich.mockResolvedValue(enrichedContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          '# Authentication Module\n\nHandles auth [src/auth.ts].\n\n```typescript\nexport const login = () => {};\n```',
        ),
      );

      const result = await service.generate(
        repositoryId,
        mockPlan,
        mockContext,
        '/workspace/repo',
      );

      const prompt = mockAiProvider.generateContent.mock.calls[0][0];
      expect(prompt).toContain('verbatim code snippets');
      expect(prompt).toContain('[code unavailable]');
      expect(result.contentMd).toContain('```typescript');
      expect(result.contentMd).toContain('export const login = () => {};');
      expect(result.contentMd).toContain('[src/auth.ts]');
      expect(result.contentMd.startsWith('## Authentication Module')).toBe(
        true,
      );
    });
  });
});
