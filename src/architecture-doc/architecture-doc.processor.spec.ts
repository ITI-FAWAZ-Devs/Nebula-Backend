import { Test, TestingModule } from '@nestjs/testing';
import { DocStatus } from '@prisma/client';
import { ArchitectureDocProcessor } from './architecture-doc.processor';
import { PrismaService } from '../prisma/prisma.service';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { ArchitectureDraft } from './dto/architecture-draft.dto';

describe('ArchitectureDocProcessor', () => {
  let processor: ArchitectureDocProcessor;

  const documentId = 'doc-1';
  const repositoryId = 'repo-1';
  const userId = 'user-1';

  const mockDraft: ArchitectureDraft = {
    repositoryId,
    repositoryName: 'test-repo',
    sections: [
      {
        key: 'overview',
        title: 'Overview',
        contentMd: '# Overview',
        sourceFiles: ['src/main.ts'],
        verdict: 'verified',
        verificationNotes: null,
      },
      {
        key: 'removed-section',
        title: 'Removed',
        contentMd: '',
        sourceFiles: [],
        verdict: 'removed',
        verificationNotes: 'No content',
      },
      {
        key: 'auth',
        title: 'Auth',
        contentMd: '# Auth',
        sourceFiles: ['src/auth.ts'],
        verdict: 'unverified',
        verificationNotes: 'Needs review',
      },
    ],
    diagram: {
      mermaidSource: 'flowchart TD\n  A --> B',
      modules: ['Overview', 'Auth'],
      verdict: 'verified',
      verificationNotes: null,
    },
    sectionPlan: [],
    sourceStatus: { semantic: 'available', graph: 'available' },
    generatedAt: new Date(),
  };

  const mockPrisma = {
    generatedDoc: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    docSection: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockDraftingOrchestrator = {
    draft: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchitectureDocProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: DraftingOrchestratorService,
          useValue: mockDraftingOrchestrator,
        },
      ],
    }).compile();

    processor = module.get<ArchitectureDocProcessor>(ArchitectureDocProcessor);
    jest.clearAllMocks();

    mockPrisma.generatedDoc.findUnique.mockResolvedValue({
      status: DocStatus.PENDING,
    });
    mockPrisma.generatedDoc.update.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        docSection: mockPrisma.docSection,
        generatedDoc: mockPrisma.generatedDoc,
      }),
    );
  });

  const createJob = () =>
    ({
      data: { repositoryId, documentId, userId },
    }) as any;

  it('should mark document RETRIEVING and persist non-removed sections on success', async () => {
    mockDraftingOrchestrator.draft.mockImplementation(
      async (_request, onProgress) => {
        await onProgress?.('GENERATING');
        await onProgress?.('VERIFYING');
        return mockDraft;
      },
    );

    await processor.process(createJob());

    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { status: DocStatus.RETRIEVING },
    });

    expect(mockPrisma.docSection.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          docId: documentId,
          key: 'overview',
          order: 0,
          diagramMermaid: 'flowchart TD\n  A --> B',
          verified: true,
        }),
        expect.objectContaining({
          docId: documentId,
          key: 'auth',
          order: 1,
          diagramMermaid: null,
          verified: false,
        }),
      ],
    });

    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: {
        status: DocStatus.COMPLETED,
        verificationScore: 0.5,
        generatedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it('should persist ordered section data and store diagram on first section', async () => {
    mockDraftingOrchestrator.draft.mockResolvedValue(mockDraft);

    await processor.process(createJob());

    const createManyCall = mockPrisma.docSection.createMany.mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(2);
    expect(createManyCall.data[0].order).toBe(0);
    expect(createManyCall.data[1].order).toBe(1);
    expect(createManyCall.data[0].diagramMermaid).toContain('flowchart');
  });

  it('should report GENERATING and VERIFYING through progress callback', async () => {
    const progressStatuses: DocStatus[] = [];
    mockDraftingOrchestrator.draft.mockImplementation(
      async (_request, onProgress) => {
        await onProgress?.('GENERATING');
        await onProgress?.('VERIFYING');
        progressStatuses.push(DocStatus.GENERATING, DocStatus.VERIFYING);
        return mockDraft;
      },
    );

    await processor.process(createJob());

    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { status: DocStatus.GENERATING },
    });
    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { status: DocStatus.VERIFYING },
    });
  });

  it('should mark document FAILED with error message when drafting fails', async () => {
    mockDraftingOrchestrator.draft.mockRejectedValue(
      new Error('Drafting pipeline failed'),
    );

    await processor.process(createJob());

    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: {
        status: DocStatus.FAILED,
        errorMessage: 'Drafting pipeline failed',
      },
    });

    expect(mockPrisma.generatedDoc.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DocStatus.COMPLETED }),
      }),
    );
  });

  it('should mark document FAILED when persistence fails', async () => {
    mockDraftingOrchestrator.draft.mockResolvedValue(mockDraft);
    mockPrisma.$transaction.mockRejectedValue(new Error('Database write failed'));

    await processor.process(createJob());

    expect(mockPrisma.generatedDoc.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: {
        status: DocStatus.FAILED,
        errorMessage: 'Database write failed',
      },
    });
  });
});
