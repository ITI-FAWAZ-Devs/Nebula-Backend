import { Test, TestingModule } from '@nestjs/testing';
import { FastAnswerService, ARCHITECTURE_DOCS_COLLECTION } from './fast-answer.service';
import { AiProviderService } from '../../ai-provider/ai-provider.service';
import { ChromaService } from '../../chroma/chroma.service';
import { FAST_ANSWER_SIMILARITY_THRESHOLD } from '../agent-rag.constants';

describe('FastAnswerService', () => {
  let service: FastAnswerService;
  let aiProviderMock: jest.Mocked<Partial<AiProviderService>>;
  let chromaServiceMock: jest.Mocked<Partial<ChromaService>>;

  beforeEach(async () => {
    aiProviderMock = {
      embedString: jest.fn().mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        provider: 'gemini',
        dimensions: 3,
      }),
    };

    chromaServiceMock = {
      collectionExists: jest.fn().mockResolvedValue(true),
      queryCollection: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FastAnswerService,
        { provide: AiProviderService, useValue: aiProviderMock },
        { provide: ChromaService, useValue: chromaServiceMock },
      ],
    }).compile();

    service = module.get<FastAnswerService>(FastAnswerService);
  });

  it('returns null if collection does not exist', async () => {
    (chromaServiceMock.collectionExists as jest.Mock).mockResolvedValue(false);
    const result = await service.findFastAnswer('repo-1', 'What is authentication?');
    expect(result).toBeNull();
  });

  it('returns fast answer on high-similarity hit', async () => {
    // distance of 0.05 gives score 1 / 1.05 = 0.952 > 0.92
    (chromaServiceMock.queryCollection as jest.Mock).mockResolvedValue({
      ids: [['doc1_sec1']],
      documents: [['# Auth System\n\nHandles JWT authentication.']],
      metadatas: [[{ sectionTitle: 'Auth System', sectionKey: 'sec1', sourceFiles: 'src/auth.ts, src/jwt.ts' }]],
      distances: [[0.05]],
    });

    const result = await service.findFastAnswer('repo-1', 'What is authentication?');

    expect(result).not.toBeNull();
    expect(result?.answer).toContain('Handles JWT authentication');
    expect(result?.sectionTitle).toBe('Auth System');
    expect(result?.citations).toHaveLength(2);
    expect(result?.citations[0].filePath).toBe('src/auth.ts');
  });

  it('returns null when similarity score is below threshold', async () => {
    // distance of 0.50 gives score 1 / 1.50 = 0.666 < 0.92
    (chromaServiceMock.queryCollection as jest.Mock).mockResolvedValue({
      ids: [['doc1_sec1']],
      documents: [['# Database Setup\n\nUses Prisma ORM.']],
      metadatas: [[{ sectionTitle: 'Database Setup', sectionKey: 'sec1' }]],
      distances: [[0.5]],
    });

    const result = await service.findFastAnswer('repo-1', 'What is authentication?');
    expect(result).toBeNull();
  });
});
