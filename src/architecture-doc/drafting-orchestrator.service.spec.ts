import { Test, TestingModule } from '@nestjs/testing';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
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

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
    },
  };

  const mockContext: HybridRetrievalContext = {
    repositoryId: 'repo-123',
    files: [
      { filePath: 'src/auth.ts', description: 'Auth module', evidenceSources: ['semantic'], combinedScore: 100 },
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
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DraftingOrchestratorService>(DraftingOrchestratorService);
    structurePlanner = module.get<StructurePlannerService>(StructurePlannerService);
    sectionGenerator = module.get<SectionGeneratorService>(SectionGeneratorService);
    sectionVerifier = module.get<SectionVerifierService>(SectionVerifierService);
    diagramGenerator = module.get<DiagramGeneratorService>(DiagramGeneratorService);
    hybridRetriever = module.get<HybridRetrieverService>(HybridRetrieverService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
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

      const result = await service.draft({ repositoryId });

      expect(result.repositoryId).toBe(repositoryId);
      expect(result.sections).toHaveLength(1);
      expect(result.diagram).not.toBeNull();
    });

    it('should return empty draft when planning produces no sections', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'READY',
      });
      mockHybridRetriever.retrieve.mockResolvedValue(mockContext);
      mockStructurePlanner.plan.mockResolvedValue([]);

      const result = await service.draft({ repositoryId });

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
      mockSectionGenerator.generate.mockRejectedValue(new Error('Generation failed'));

      const result = await service.draft({ repositoryId });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].verdict).toBe('removed');
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
      mockDiagramGenerator.generate.mockRejectedValue(new Error('Diagram failed'));

      const result = await service.draft({ repositoryId });

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

      await service.draft({ repositoryId: 'repo-1' });

      const allRetrieveCalls = mockHybridRetriever.retrieve.mock.calls;
      for (const call of allRetrieveCalls) {
        expect(call[0]).toBe('repo-1');
      }
    });

    it('should fail when repository does not exist', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);

      await expect(service.draft({ repositoryId: 'nonexistent' })).rejects.toThrow(
        'Repository nonexistent not found',
      );
    });

    it('should fail when repository status is not READY', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        id: repositoryId,
        name: 'test-repo',
        status: 'INDEXING',
      });

      await expect(service.draft({ repositoryId })).rejects.toThrow();
    });
  });
});
