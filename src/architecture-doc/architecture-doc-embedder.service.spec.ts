import { Test, TestingModule } from '@nestjs/testing';
import {
  ArchitectureDocEmbedderService,
  ARCHITECTURE_DOCS_COLLECTION,
} from './architecture-doc-embedder.service';
import { GeminiService } from '../gemini/gemini.service';
import { ChromaService } from '../chroma/chroma.service';
import { ArchitectureDocEmbeddingPayload } from './dto/architecture-doc-embedding.dto';

describe('ArchitectureDocEmbedderService', () => {
  let service: ArchitectureDocEmbedderService;
  let geminiService: jest.Mocked<GeminiService>;
  let chromaService: jest.Mocked<ChromaService>;

  beforeEach(async () => {
    const mockGeminiService = {
      embedString: jest.fn(),
    };

    const mockChromaService = {
      upsertChunks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchitectureDocEmbedderService,
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: ChromaService, useValue: mockChromaService },
      ],
    }).compile();

    service = module.get<ArchitectureDocEmbedderService>(
      ArchitectureDocEmbedderService,
    );
    geminiService = module.get(GeminiService);
    chromaService = module.get(ChromaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should skip embedding if sections array is empty', async () => {
    const payload: ArchitectureDocEmbeddingPayload = {
      docId: 'doc-123',
      version: 1,
      commitSha: 'abc1234',
      sections: [],
    };

    await service.embedDocument(payload);

    expect(geminiService.embedString).not.toHaveBeenCalled();
    expect(chromaService.upsertChunks).not.toHaveBeenCalled();
  });

  it('should generate embeddings and upsert sections into ChromaDB with proper structure', async () => {
    const fakeEmbedding = [0.1, 0.2, 0.3];
    geminiService.embedString.mockResolvedValue(fakeEmbedding);
    chromaService.upsertChunks.mockResolvedValue(undefined);

    const payload: ArchitectureDocEmbeddingPayload = {
      docId: 'doc-456',
      version: 2,
      commitSha: 'sha-9876',
      sections: [
        {
          key: 'overview',
          title: 'System Overview',
          contentMd: 'This is the system overview content.',
          sourceFiles: ['src/main.ts', 'src/app.module.ts'],
        },
      ],
      generatedAt: '2026-07-28T12:00:00.000Z',
    };

    await service.embedDocument(payload);

    expect(geminiService.embedString).toHaveBeenCalledWith(
      '# System Overview\n\nThis is the system overview content.',
    );

    expect(chromaService.upsertChunks).toHaveBeenCalledWith(
      ARCHITECTURE_DOCS_COLLECTION,
      [
        {
          id: 'doc-456_overview',
          document: '# System Overview\n\nThis is the system overview content.',
          metadata: {
            docId: 'doc-456',
            version: 2,
            commitSha: 'sha-9876',
            sectionKey: 'overview',
            sectionTitle: 'System Overview',
            sourceFiles: 'src/main.ts, src/app.module.ts',
            generatedAt: '2026-07-28T12:00:00.000Z',
          },
          embedding: fakeEmbedding,
        },
      ],
    );
  });
});
