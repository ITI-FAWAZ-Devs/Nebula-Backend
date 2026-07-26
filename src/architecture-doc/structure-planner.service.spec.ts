import { Test, TestingModule } from '@nestjs/testing';
import { StructurePlannerService } from './structure-planner.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { GeminiService } from '../gemini/gemini.service';
import { PrismaService } from '../prisma/prisma.service';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

describe('StructurePlannerService', () => {
  let service: StructurePlannerService;
  let hybridRetriever: HybridRetrieverService;
  let gemini: GeminiService;
  let prisma: PrismaService;

  const mockHybridRetriever = {
    retrieve: jest.fn(),
  };

  const mockGemini = {
    generateContent: jest.fn(),
  };

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
    },
  };

  const mockContext: HybridRetrievalContext = {
    repositoryId: 'repo-123',
    files: [
      { filePath: 'src/auth.ts', description: 'Auth module', evidenceSources: ['semantic'], combinedScore: 100 },
      { filePath: 'src/user.ts', description: 'User module', evidenceSources: ['semantic'], combinedScore: 90 },
    ],
    relationships: [],
    moduleClusters: [],
    missingSeedPaths: [],
    sourceStatus: { semantic: 'available', graph: 'available' },
    noEvidence: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructurePlannerService,
        { provide: HybridRetrieverService, useValue: mockHybridRetriever },
        { provide: GeminiService, useValue: mockGemini },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StructurePlannerService>(StructurePlannerService);
    hybridRetriever = module.get<HybridRetrieverService>(HybridRetrieverService);
    gemini = module.get<GeminiService>(GeminiService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('plan', () => {
    const repositoryId = 'repo-123';

    it('should parse valid JSON plan', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          {
            key: 'auth-module',
            title: 'Authentication Module',
            purpose: 'Handles user authentication',
            retrievalTopic: 'authentication implementation',
          },
          {
            key: 'user-management',
            title: 'User Management',
            purpose: 'Manages user CRUD operations',
            retrievalTopic: 'user management',
          },
        ]),
      );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('auth-module');
      expect(result[1].key).toBe('user-management');
    });

    it('should reject duplicate keys (keep first)', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          {
            key: 'auth',
            title: 'First Auth',
            purpose: 'First',
            retrievalTopic: 'auth',
          },
          {
            key: 'auth',
            title: 'Duplicate Auth',
            purpose: 'Duplicate',
            retrievalTopic: 'auth',
          },
        ]),
      );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('First Auth');
    });

    it('should reject entries with empty/missing key', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          {
            key: '',
            title: 'Empty Key',
            purpose: 'Purpose',
            retrievalTopic: 'topic',
          },
          {
            title: 'Missing Key',
            purpose: 'Purpose',
            retrievalTopic: 'topic',
          },
          {
            key: 'valid',
            title: 'Valid',
            purpose: 'Purpose',
            retrievalTopic: 'topic',
          },
        ]),
      );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('valid');
    });

    it('should reject entries with empty title', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          {
            key: 'valid',
            title: '',
            purpose: 'Purpose',
            retrievalTopic: 'topic',
          },
        ]),
      );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(0);
    });

    it('should reject entries with empty retrievalTopic', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          {
            key: 'valid',
            title: 'Title',
            purpose: 'Purpose',
            retrievalTopic: '',
          },
        ]),
      );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(0);
    });

    it('should return empty array when broad retrieval has noEvidence', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue({
        ...mockContext,
        noEvidence: true,
        files: [],
      });

      const result = await service.plan(repositoryId);

      expect(result).toEqual([]);
      expect(mockGemini.generateContent).not.toHaveBeenCalled();
    });

    it('should produce different key sets for different repositories', async () => {
      const repo1Context: HybridRetrievalContext = {
        ...mockContext,
        repositoryId: 'repo-1',
        files: [
          { filePath: 'src/auth.ts', description: 'Auth module', evidenceSources: ['semantic'], combinedScore: 100 },
        ],
      };

      const repo2Context: HybridRetrievalContext = {
        ...mockContext,
        repositoryId: 'repo-2',
        files: [
          { filePath: 'src/payment.ts', description: 'Payment module', evidenceSources: ['semantic'], combinedScore: 100 },
          { filePath: 'src/billing.ts', description: 'Billing module', evidenceSources: ['semantic'], combinedScore: 90 },
        ],
      };

      mockPrisma.repository.findUnique.mockResolvedValue({
        id: 'repo-1',
        name: 'auth-repo',
        owner: 'owner1',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(repo1Context);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          { key: 'auth-system', title: 'Auth System', purpose: 'Auth', retrievalTopic: 'auth' },
        ]),
      );

      const result1 = await service.plan('repo-1');

      mockPrisma.repository.findUnique.mockResolvedValue({
        id: 'repo-2',
        name: 'payment-repo',
        owner: 'owner2',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(repo2Context);
      mockGemini.generateContent.mockResolvedValue(
        JSON.stringify([
          { key: 'payment-flow', title: 'Payment Flow', purpose: 'Payment', retrievalTopic: 'payment' },
          { key: 'billing-cycle', title: 'Billing Cycle', purpose: 'Billing', retrievalTopic: 'billing' },
        ]),
      );

      const result2 = await service.plan('repo-2');

      const keys1 = result1.map((s) => s.key);
      const keys2 = result2.map((s) => s.key);
      expect(keys1).not.toEqual(keys2);
    });

    it('should fail when repository does not exist', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);

      await expect(service.plan('nonexistent')).rejects.toThrow();
    });

    it('should fail when repository status is not READY', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'INDEXING',
        owner: { login: 'test-owner' },
      });

      await expect(service.plan(repositoryId)).rejects.toThrow();
    });

    it('should retry on malformed JSON', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent
        .mockResolvedValueOnce('This is not valid JSON')
        .mockResolvedValueOnce(
          JSON.stringify([
            { key: 'valid', title: 'Valid', purpose: 'Purpose', retrievalTopic: 'topic' },
          ]),
        );

      const result = await service.plan(repositoryId);

      expect(result).toHaveLength(1);
      expect(mockGemini.generateContent).toHaveBeenCalledTimes(2);
    });

    it('should fail after retry on persistent malformed JSON', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        owner: 'test-owner',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockGemini.generateContent.mockResolvedValue('Still not valid JSON');

      await expect(service.plan(repositoryId)).rejects.toThrow();
    });
  });
});
