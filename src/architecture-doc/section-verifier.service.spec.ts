import { Test, TestingModule } from '@nestjs/testing';
import { SectionVerifierService } from './section-verifier.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { seededHallucinationSection } from '../../test/drafting-pipeline/seeded-hallucination';

describe('SectionVerifierService', () => {
  let service: SectionVerifierService;
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
        { provide: CodeContextLoaderService, useValue: mockCodeContextLoader },
      ],
    }).compile();

    service = module.get<SectionVerifierService>(SectionVerifierService);
    aiProvider = module.get<AiProviderService>(AiProviderService);

    jest.clearAllMocks();
    mockCodeContextLoader.enrich.mockImplementation((context) => context);
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
        '## Authentication Module\n\nHandles login.\n',
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

    it('should keep generated content as unverified when the response is not parseable JSON', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          'The section is verified. Relevant files: [README.md], [src/auth.ts], and [package.json].',
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('unverified');
      expect(result.contentMd).toBe(mockSection.contentMd + '\n');
      expect(result.verificationNotes).toContain(
        'failed to produce a valid response',
      );
    });

    it('should self-heal with a corrected response when the first response is malformed', async () => {
      mockAiProvider.generateContent
        .mockResolvedValueOnce(
          llmResult(
            'The section is verified. Relevant files: [README.md], [src/auth.ts], and [package.json].',
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

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('verified');
      expect(mockAiProvider.generateContent).toHaveBeenCalledTimes(2);
    });

    it('should keep generated content as unverified when the follow-up response is not parseable JSON', async () => {
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
            'Checked [src/jwt.ts] and [package.json]; cannot produce valid JSON.',
          ),
        )
        .mockResolvedValueOnce(
          llmResult(
            'Still cannot produce valid JSON. Only [src/jwt.ts] referenced.',
          ),
        );
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('unverified');
      expect(result.contentMd).toBe(mockSection.contentMd + '\n');
      expect(result.verificationNotes).toContain(
        'failed to produce a valid response',
      );
    });

    it('should sanitize a rewritten verified body', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody:
              '# Authentication Module\n\n```typescript\nexport const login = () => {};\n',
            notes: 'Removed unsupported claims.',
          }),
        ),
      );

      const result = await service.verify(
        mockSection,
        mockContext,
        repositoryId,
      );

      expect(result.verdict).toBe('verified');
      expect(result.contentMd).toContain('## Authentication Module');
      expect(result.contentMd).toContain('export const login = () => {};');
      const fences = result.contentMd.match(/^```/gm) ?? [];
      expect(fences).toHaveLength(2);
    });

    it('should embed code evidence in the primary verification prompt (US2)', async () => {
      const enrichedContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            ...mockContext.files[0],
            codeContent: 'export const authenticate = () => {};',
          },
        ],
      };
      mockCodeContextLoader.enrich.mockResolvedValue(enrichedContext);
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody: null,
            notes: null,
          }),
        ),
      );

      await service.verify(
        mockSection,
        mockContext,
        repositoryId,
        '/workspace/repo',
      );

      expect(mockCodeContextLoader.enrich).toHaveBeenCalledWith(
        mockContext,
        '/workspace/repo',
      );
      const prompt = mockAiProvider.generateContent.mock.calls[0][0];
      expect(prompt).toContain('Source code evidence');
      expect(prompt).toContain('export const authenticate = () => {};');
    });

    it('should embed code evidence in the follow-up verification prompt (US2)', async () => {
      const followUpContext: HybridRetrievalContext = {
        ...mockContext,
        files: [
          {
            filePath: 'src/jwt.ts',
            description: 'JWT module',
            evidenceSources: ['semantic'],
            combinedScore: 80,
            codeContent: 'export const signJwt = () => {};',
          },
        ],
      };
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
      mockHybridRetriever.retrieve.mockResolvedValue(followUpContext);
      mockCodeContextLoader.enrich.mockResolvedValue(followUpContext);

      await service.verify(
        mockSection,
        mockContext,
        repositoryId,
        '/workspace/repo',
      );

      expect(mockCodeContextLoader.enrich).toHaveBeenCalledTimes(2);
      expect(mockCodeContextLoader.enrich).toHaveBeenLastCalledWith(
        followUpContext,
        '/workspace/repo',
      );
      const followUpPrompt = mockAiProvider.generateContent.mock.calls[1][0];
      expect(followUpPrompt).toContain('Source code evidence');
      expect(followUpPrompt).toContain('export const signJwt = () => {};');
    });
  });
});
