import { Test, TestingModule } from '@nestjs/testing';
import { DraftingOrchestratorService } from '../src/architecture-doc/drafting-orchestrator.service';
import { StructurePlannerService } from '../src/architecture-doc/structure-planner.service';
import { SectionGeneratorService } from '../src/architecture-doc/section-generator.service';
import { SectionVerifierService } from '../src/architecture-doc/section-verifier.service';
import { DiagramGeneratorService } from '../src/architecture-doc/diagram-generator.service';
import { HybridRetrieverService } from '../src/architecture-doc/hybrid-retriever.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProviderService } from '../src/ai-provider/ai-provider.service';
import {
  minimalRepoFiles,
  minimalRepoRelationships,
  minimalRepoClusters,
} from './drafting-pipeline/minimal-repo';

const RUN_INTEGRATION =
  process.env.RUN_DRAFTING_PIPELINE_INTEGRATION === 'true';

describe('Drafting Pipeline Integration', () => {
  let orchestrator: DraftingOrchestratorService;

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
    },
  };

  const mockHybridRetriever = {
    retrieve: jest.fn(),
  };

  const aiLlmResult = (text: string) => ({
    text,
    model: 'gemini-model',
    tier: 'strong',
    provider: 'gemini',
    latencyMs: 0,
    fallbackOccurred: false,
  });

  const mockAiProvider = {
    generateContent: jest.fn(),
    embedString: jest.fn(),
    embedMany: jest.fn(),
  };

  const repositoryId = 'integration-test-repo';

  beforeAll(async () => {
    if (!RUN_INTEGRATION) {
      return;
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DraftingOrchestratorService,
        StructurePlannerService,
        SectionGeneratorService,
        SectionVerifierService,
        DiagramGeneratorService,
        { provide: HybridRetrieverService, useValue: mockHybridRetriever },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProviderService, useValue: mockAiProvider },
      ],
    }).compile();

    orchestrator = module.get<DraftingOrchestratorService>(
      DraftingOrchestratorService,
    );

    mockPrisma.repository.findUnique.mockResolvedValue({
      id: repositoryId,
      name: 'integration-test',
      status: 'READY',
      owner: 'test-owner',
    });

    mockHybridRetriever.retrieve.mockResolvedValue({
      repositoryId,
      files: minimalRepoFiles.map((f) => ({
        ...f,
        evidenceSources: ['semantic'],
        combinedScore: 100,
      })),
      relationships: minimalRepoRelationships,
      moduleClusters: minimalRepoClusters,
      missingSeedPaths: [],
      sourceStatus: { semantic: 'available', graph: 'available' },
      noEvidence: false,
    });

    mockAiProvider.generateContent
      .mockResolvedValueOnce(
        aiLlmResult(
          JSON.stringify([
            {
              key: 'overview',
              title: 'Application Overview',
              purpose: 'High-level overview of the application',
              retrievalTopic: 'application entry point and module structure',
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        aiLlmResult(
          '## Application Overview\n\nThe application bootstraps in [src/main.ts] using [src/app.module.ts].',
        ),
      )
      .mockResolvedValueOnce(
        aiLlmResult(
          JSON.stringify({
            verdict: 'verified',
            rewrittenBody: null,
            notes: null,
          }),
        ),
      )
      .mockResolvedValueOnce(
        aiLlmResult(
          'flowchart TD\n    A[main.ts] --> B[app.module.ts]\n    B --> C[app.service.ts]',
        ),
      )
      .mockResolvedValueOnce(
        aiLlmResult(
          'flowchart TD\n    A[Application Core] --> B[Application Overview]',
        ),
      );
  });

  it('should produce a grounded draft with citations', async () => {
    if (!RUN_INTEGRATION) {
      console.log(
        'Skipping integration test: RUN_DRAFTING_PIPELINE_INTEGRATION not set',
      );
      return;
    }

    const result = await orchestrator.draft({ repositoryId });

    expect(result.repositoryId).toBe(repositoryId);
    expect(result.sections.length).toBeGreaterThan(0);

    for (const section of result.sections) {
      if (section.verdict === 'verified') {
        expect(section.sourceFiles.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should catch seeded hallucination', async () => {
    if (!RUN_INTEGRATION) {
      console.log(
        'Skipping integration test: RUN_DRAFTING_PIPELINE_INTEGRATION not set',
      );
      return;
    }

    const result = await orchestrator.draft({ repositoryId });

    for (const section of result.sections) {
      if (section.verdict === 'verified') {
        expect(section.sourceFiles.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should produce a valid diagram when evidence is present', async () => {
    if (!RUN_INTEGRATION) {
      console.log(
        'Skipping integration test: RUN_DRAFTING_PIPELINE_INTEGRATION not set',
      );
      return;
    }

    const result = await orchestrator.draft({ repositoryId });

    if (result.diagram) {
      expect(result.diagram.mermaidSource).toMatch(/^(flowchart|graph)\s/);
    }
  });

  it('should attach a per-section diagram and aggregate Dependency Graph section', async () => {
    if (!RUN_INTEGRATION) {
      console.log(
        'Skipping integration test: RUN_DRAFTING_PIPELINE_INTEGRATION not set',
      );
      return;
    }

    const result = await orchestrator.draft({ repositoryId });

    const graphSection = result.sections.find(
      (s) => s.key === 'dependency-graph',
    );
    expect(graphSection).toBeDefined();
    expect(graphSection!.diagramMermaid).toMatch(/^(flowchart|graph)\s/);
    expect(graphSection!.contentMd).toContain('```mermaid');

    const regularSections = result.sections.filter(
      (s) => s.key !== 'dependency-graph',
    );
    for (const section of regularSections) {
      if (section.verdict === 'verified' && section.contentMd.length > 0) {
        expect(section.diagramMermaid).toMatch(/^(flowchart|graph)\s/);
      }
    }
  });
});
