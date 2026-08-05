import { Test, TestingModule } from '@nestjs/testing';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { PrismaService } from '../prisma/prisma.service';
import { SectionPlan, DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

describe('DraftingOrchestratorService', () => {
  let service: DraftingOrchestratorService;
  let structurePlanner: StructurePlannerService;
  let sectionGenerator: SectionGeneratorService;
  let sectionVerifier: SectionVerifierService;
  let diagramGenerator: DiagramGeneratorService;
  let hybridRetriever: HybridRetrieverService;
  let prisma: PrismaService;

  const mockStructurePlanner = {
    plan: jest.fn(),
  };

  const mockSectionGenerator = {
    generate: jest.fn(),
  };

  const mockSectionVerifier = {
    verify: jest.fn(),
  };

  const mockDiagramGenerator = {
    generate: jest.fn(),
  };

  const mockHybridRetriever = {
    retrieve: jest.fn(),
  };

  const mockCodeContextLoader = {
    ensureClone: jest.fn(),
  };

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
    },
  };

  const mockContext: HybridRetrievalContext = {
    repositoryId: 'repo-123',
    files: [
      {
        filePath: 'src/auth.ts',
        description: 'Auth module',
        evidenceSources: ['semantic'],
        combinedScore: 100,
      },
    ],
    relationships: [],
    moduleClusters: [],
    missingSeedPaths: [],
    sourceStatus: { semantic: 'available', graph: 'available' },
    noEvidence: false,
  };

  const mockPlan: SectionPlan[] = [
    {
      key: 'auth-module',
      title: 'Authentication Module',
      purpose: 'Handles user authentication',
      retrievalTopic: 'authentication implementation',
    },
  ];

  const mockSection: DraftSection = {
    key: 'auth-module',
    title: 'Authentication Module',
    contentMd: '## Auth Module\n\nHandles auth [src/auth.ts].',
    sourceFiles: ['src/auth.ts'],
    verdict: 'verified',
    verificationNotes: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DraftingOrchestratorService,
        { provide: StructurePlannerService, useValue: mockStructurePlanner },
        { provide: SectionGeneratorService, useValue: mockSectionGenerator },
        { provide: SectionVerifierService, useValue: mockSectionVerifier },
        { provide: DiagramGeneratorService, useValue: mockDiagramGenerator },
        { provide: HybridRetrieverService, useValue: mockHybridRetriever },
        { provide: CodeContextLoaderService, useValue: mockCodeContextLoader },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DraftingOrchestratorService>(
      DraftingOrchestratorService,
    );
    structurePlanner = module.get<StructurePlannerService>(
      StructurePlannerService,
    );
    sectionGenerator = module.get<SectionGeneratorService>(
      SectionGeneratorService,
    );
    sectionVerifier = module.get<SectionVerifierService>(
      SectionVerifierService,
    );
    diagramGenerator = module.get<DiagramGeneratorService>(
      DiagramGeneratorService,
    );
    hybridRetriever = module.get<HybridRetrieverService>(
      HybridRetrieverService,
    );
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    mockCodeContextLoader.ensureClone.mockResolvedValue(
      '/workspace/draft-repo-123',
    );
    mockDiagramGenerator.generate.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('draft', () => {
    const repositoryId = 'repo-123';

    it('should complete full pipeline successfully', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);
      mockDiagramGenerator.generate.mockResolvedValue({
        mermaidSource: 'flowchart TD\n    A --> B',
        modules: ['Auth Module'],
        verdict: 'verified',
        verificationNotes: null,
      });

      const result = await service.draft({ repositoryId, userId: 'user-1' });

      expect(result.repositoryId).toBe(repositoryId);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].diagramMermaid).toContain('flowchart');
      expect(result.sections[1]).toMatchObject({
        key: 'dependency-graph',
        title: 'Dependency Graph',
        verdict: 'verified',
        diagramMermaid: 'flowchart TD\n    A --> B',
      });
      expect(result.sections[1].contentMd).toContain('```mermaid');
      expect(result.diagram).not.toBeNull();
    });

    it('should generate a per-section diagram scoped to the section context', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);
      mockDiagramGenerator.generate.mockResolvedValue({
        mermaidSource: 'flowchart TD\n    A --> B',
        modules: ['Auth Module'],
        verdict: 'verified',
        verificationNotes: null,
      });

      await service.draft({ repositoryId, userId: 'user-1' });

      const generateCalls = mockDiagramGenerator.generate.mock.calls;
      expect(generateCalls).toHaveLength(2);
      expect(generateCalls[0][3]).toBe('Authentication Module');
      expect(generateCalls[1][3]).toBeUndefined();
    });

    it('should return empty draft when planning produces no sections', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue([]);

      const result = await service.draft({ repositoryId, userId: 'user-1' });

      expect(result.sections).toHaveLength(0);
      expect(result.diagram).toBeNull();
    });

    it('should mark sections as removed when generation fails', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockRejectedValue(
        new Error('Generation failed'),
      );

      const result = await service.draft({ repositoryId, userId: 'user-1' });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].verdict).toBe('removed');
    });

    it('should retain generated content as unverified when verification fails', async () => {
      const generated: DraftSection = {
        ...mockSection,
        verdict: 'unverified',
        verificationNotes: null,
      };
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(generated);
      mockSectionVerifier.verify.mockRejectedValue(
        new Error('Verification failed'),
      );

      const result = await service.draft({ repositoryId, userId: 'user-1' });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].verdict).toBe('unverified');
      expect(result.sections[0].contentMd).toBe(generated.contentMd);
      expect(result.sections[0].verificationNotes).toContain(
        'Verification failed',
      );
    });

    it('should retain sections when diagram fails', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);
      mockDiagramGenerator.generate.mockRejectedValue(
        new Error('Diagram failed'),
      );

      const result = await service.draft({ repositoryId, userId: 'user-1' });

      expect(result.sections).toHaveLength(1);
      expect(result.diagram).toBeNull();
    });

    it('should verify tenant isolation (SC-006)', async () => {
      const repo1Context: HybridRetrievalContext = {
        ...mockContext,
        repositoryId: 'repo-1',
      };

      mockPrisma.repository.findUnique.mockResolvedValue({
        id: 'repo-1',
        name: 'repo-1',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(repo1Context);
      mockStructurePlanner.plan.mockResolvedValue([]);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);

      await service.draft({ repositoryId: 'repo-1', userId: 'user-1' });

      const allRetrieveCalls = mockHybridRetriever.retrieve.mock.calls;
      for (const call of allRetrieveCalls) {
        expect(call[0]).toBe('repo-1');
      }
    });

    it('should call ensureClone exactly once with the authorized userId (US4)', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue([]);

      await service.draft({ repositoryId, userId: 'user-42' });

      expect(mockCodeContextLoader.ensureClone).toHaveBeenCalledTimes(1);
      expect(mockCodeContextLoader.ensureClone).toHaveBeenCalledWith(
        repositoryId,
        'user-42',
      );
    });

    it('should complete a description-only draft when the code root is null (US4)', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockCodeContextLoader.ensureClone.mockResolvedValue(null);
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);
      mockDiagramGenerator.generate.mockResolvedValue({
        mermaidSource: 'flowchart TD\n    A --> B',
        modules: ['Auth Module'],
        verdict: 'verified',
        verificationNotes: null,
      });

      const result = await service.draft({
        repositoryId,
        userId: 'user-1',
      });

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].verdict).toBe('verified');
      expect(result.sections[1].key).toBe('dependency-graph');
      expect(result.diagram).not.toBeNull();
    });

    it('should fail when repository does not exist', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);

      await expect(
        service.draft({ repositoryId: 'nonexistent', userId: 'user-1' }),
      ).rejects.toThrow('Repository nonexistent not found');
    });

    it('should fail when repository status is not READY', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'INDEXING',
      });

      await expect(
        service.draft({ repositoryId, userId: 'user-1' }),
      ).rejects.toThrow();
    });

    it('should report retrieval, generation, and verification progress while preserving draft output', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue(mockPlan);
      mockSectionGenerator.generate.mockResolvedValue(mockSection);
      mockSectionVerifier.verify.mockResolvedValue(mockSection);
      mockDiagramGenerator.generate.mockResolvedValue({
        mermaidSource: 'flowchart TD\n    A --> B',
        modules: ['Auth Module'],
        verdict: 'verified',
        verificationNotes: null,
      });

      const progressStatuses: string[] = [];
      const result = await service.draft(
        { repositoryId, userId: 'user-1' },
        (status) => {
          progressStatuses.push(status);
        },
      );

      expect(progressStatuses).toEqual([
        'RETRIEVING',
        'GENERATING',
        'VERIFYING',
      ]);
      expect(result.repositoryId).toBe(repositoryId);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].verdict).toBe('verified');
      expect(result.sections[1].key).toBe('dependency-graph');
      expect(result.diagram).not.toBeNull();
    });
  });
});
