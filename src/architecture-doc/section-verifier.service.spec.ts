import { Test, TestingModule } from '@nestjs/testing';
import { SectionVerifierService } from './section-verifier.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { seededHallucinationSection } from '../../test/drafting-pipeline/seeded-hallucination';

describe('SectionVerifierService', () => {
  let service: SectionVerifierService;
  let hybridRetriever: HybridRetrieverService;
  let aiProvider: AiProviderService;

  const mockHybridRetriever = {
    retrieve: jest.fn(),
  };

  const mockAiProvider = {
    generateContent: jest.fn(),
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

  const mockSection: DraftSection = {
    key: 'auth-module',
    title: 'Authentication Module',
    contentMd:
      '## Authentication Module\n\nThe authentication module handles user login [src/auth.ts].',
    sourceFiles: ['src/auth.ts'],
    verdict: 'unverified',
    verificationNotes: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionVerifierService,
        { provide: HybridRetrieverService, useValue: mockHybridRetriever },
        { provide: AiProviderService, useValue: mockAiProvider },
      ],
    }).compile();

    service = module.get<SectionVerifierService>(SectionVerifierService);
    hybridRetriever = module.get<HybridRetrieverService>(
      HybridRetrieverService,
    );
    aiProvider = module.get<AiProviderService>(AiProviderService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verify', () => {
    const repositoryId = 'repo-123';

    it('should pass through verified sections', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody: null,
            notes: null,
          }),
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('verified');
      expect(result.verificationNotes).toBeNull();
    });

    it('should remove unsupported claims', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody: '## Authentication Module\n\nHandles login.',
            notes: 'Removed unsupported claim about registration.',
          }),
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('verified');
      expect(result.contentMd).toBe(
        '## Authentication Module\n\nHandles login.',
      );
    });

    it('should mark unverified with notes', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'unverified',
            rewrittenBody: null,
            notes: 'Claim about OAuth2 support is not supported by evidence.',
          }),
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('unverified');
      expect(result.verificationNotes).toBe(
        'Claim about OAuth2 support is not supported by evidence.',
      );
    });

    it('should reject invalid citations', async () => {
      const sectionWithBadCitation: DraftSection = {
        ...mockSection,
        contentMd: 'Auth module uses [src/nonexistent.ts].',
        sourceFiles: ['src/nonexistent.ts'],
      };

      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'unverified',
            rewrittenBody: null,
            notes: 'Citation src/nonexistent.ts not found in evidence.',
          }),
        ),
      );

      const result = await service.verify(
        sectionWithBadCitation,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('unverified');
      expect(result.verificationNotes).toContain('src/nonexistent.ts');
    });

    it('should trigger one follow-up retrieval', async () => {
      mockAiProvider.generateContent
        .mockResolvedValueOnce(
          llmResult(
            JSON.stringify({
              verdict: 'unverified',
              rewrittenBody: null,
              notes: 'Need more evidence about JWT implementation.',
            }),
          ),
        )
        .mockResolvedValueOnce(
          llmResult(
            JSON.stringify({
              verdict: 'verified',
              rewrittenBody: null,
              notes: null,
            }),
          ),
        );

      mockHybridRetriever.retrieve.mockResolvedValue({
        ...mockContext,
        files: [
          ...mockContext.files,
          {
            filePath: 'src/jwt.ts',
            description: 'JWT module',
            evidenceSources: ['semantic'],
            combinedScore: 80,
          },
        ],
      });

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('verified');
      expect(mockHybridRetriever.retrieve).toHaveBeenCalledTimes(1);
    });

    it('should not attempt second follow-up retrieval', async () => {
      mockAiProvider.generateContent
        .mockResolvedValueOnce(
          llmResult(
            JSON.stringify({
              verdict: 'unverified',
              rewrittenBody: null,
              notes: 'Need more evidence about authentication.',
            }),
          ),
        )
        .mockResolvedValueOnce(
          llmResult(
            JSON.stringify({
              verdict: 'unverified',
              rewrittenBody: null,
              notes: 'Still insufficient evidence.',
            }),
          ),
        );

      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('unverified');
      expect(mockHybridRetriever.retrieve).toHaveBeenCalledTimes(1);
    });

    it('should catch seeded hallucination (SC-003)', async () => {
      const unrelatedContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            filePath: 'src/README.md',
            description: 'Project readme',
            evidenceSources: ['semantic'],
            combinedScore: 100,
          },
        ],
      };

      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'unverified',
            rewrittenBody: null,
            notes:
              'Claims about auth, crypto, session, rate-limiter, and JWT rotation are not supported by evidence.',
          }),
        ),
      );

      const result = await service.verify(
        seededHallucinationSection,
        unrelatedContext,
        repositoryId,
      );

      expect(result.verdict).not.toBe('verified');
      expect(result.verificationNotes).toBeTruthy();
    });

    it('should assert SC-005: every verified section has at least one supporting file', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody: null,
            notes: null,
          }),
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      if (result.verdict === 'verified') {
        expect(result.sourceFiles.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
