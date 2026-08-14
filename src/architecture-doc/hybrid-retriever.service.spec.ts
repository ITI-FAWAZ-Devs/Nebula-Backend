import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { ChromaService } from '../chroma/chroma.service';
import { Neo4jService } from '../neo4j/neo4j.service';

describe('HybridRetrieverService', () => {
  let service: HybridRetrieverService;
  let prisma: PrismaService;
  let aiProvider: AiProviderService;
  let chroma: ChromaService;
  let neo4j: Neo4jService;

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
    },
  };

  const mockAiProvider = {
    embedString: jest.fn(),
  };

  const mockChroma = {
    collectionExists: jest.fn(),
    queryCollection: jest.fn(),
  };

  const mockNeo4j = {
    getFileNeighborhood: jest.fn(),
  };

  const embedResult = (embedding: number[], fallbackOccurred = false) => ({
    embedding,
    provider: fallbackOccurred ? 'gemini' : 'bedrock',
    dimensions: fallbackOccurred ? 768 : 1024,
    model: fallbackOccurred ? 'gemini-test-model' : 'bedrock-test-model',
    latencyMs: 1,
    fallbackOccurred,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridRetrieverService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProviderService, useValue: mockAiProvider },
        { provide: ChromaService, useValue: mockChroma },
        { provide: Neo4jService, useValue: mockNeo4j },
      ],
    }).compile();

    service = module.get<HybridRetrieverService>(HybridRetrieverService);
    prisma = module.get<PrismaService>(PrismaService);
    aiProvider = module.get<AiProviderService>(AiProviderService);
    chroma = module.get<ChromaService>(ChromaService);
    neo4j = module.get<Neo4jService>(Neo4jService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('retrieve', () => {
    const repositoryId = 'repo-123';

    it('should fail when the repository is absent', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(null);

      await expect(
        service.retrieve(repositoryId, { topic: 'authentication' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should fail when topic and seed paths are both absent', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });

      await expect(service.retrieve(repositoryId, {})).rejects.toThrow(
        'At least one of topic or filePaths is required',
      );
    });

    it('should fail with empty string topic and no seed paths', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });

      await expect(
        service.retrieve(repositoryId, { topic: '  ' }),
      ).rejects.toThrow('At least one of topic or filePaths is required');
    });

    it('should fail with empty seed paths and no topic', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });

      await expect(
        service.retrieve(repositoryId, { filePaths: [] }),
      ).rejects.toThrow('At least one of topic or filePaths is required');
    });

    it('should perform topic-only lookup', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['file1', 'file2']],
        distances: [[0.1, 0.2]],
        metadatas: [
          [
            { filePath: 'src/auth.ts', description: 'Auth module' },
            { filePath: 'src/user.ts', description: 'User module' },
          ],
        ],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'authentication',
      });

      expect(mockAiProvider.embedString).toHaveBeenCalledWith(
        'authentication',
        'search_query',
      );
      expect(mockChroma.queryCollection).toHaveBeenCalledWith(
        'repo-repo-123',
        [0.1, 0.2, 0.3],
        10,
      );
      expect(result.files.length).toBeGreaterThanOrEqual(0);
      expect(result.repositoryId).toBe(repositoryId);
    });

    it('should perform seed-path-only lookup without calling embedString', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/config.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        filePaths: ['src/config.ts'],
      });

      expect(mockAiProvider.embedString).not.toHaveBeenCalled();
      expect(mockChroma.queryCollection).not.toHaveBeenCalled();
      expect(result.files.length).toBe(1);
      expect(result.files[0].filePath).toBe('src/config.ts');
    });

    it('should perform topic-plus-seed lookup', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem-file1']],
        distances: [[0.15]],
        metadatas: [[{ filePath: 'src/core.ts', description: 'Core' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/core.ts',
            labels: ['File'],
            properties: {},
          },
          {
            id: 'n2',
            filePath: 'src/config.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'core',
        filePaths: ['src/config.ts'],
      });

      expect(mockAiProvider.embedString).toHaveBeenCalledWith(
        'core',
        'search_query',
      );
      expect(mockChroma.queryCollection).toHaveBeenCalled();
      expect(result.files.some((f) => f.filePath === 'src/config.ts')).toBe(
        true,
      );
      expect(result.files.some((f) => f.filePath === 'src/core.ts')).toBe(true);
    });

    it('should collapse duplicate semantic paths to one record', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['id1', 'id2']],
        distances: [[0.1, 0.2]],
        metadatas: [
          [
            { filePath: 'src/dup.ts', description: 'First' },
            { filePath: 'src/dup.ts', description: 'Duplicate' },
          ],
        ],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'test',
      });

      const dupFiles = result.files.filter((f) => f.filePath === 'src/dup.ts');
      expect(dupFiles.length).toBe(1);
    });

    it('should produce stable output order', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['id1', 'id2', 'id3']],
        distances: [[0.3, 0.2, 0.1]],
        metadatas: [
          [
            { filePath: 'src/c.ts', description: 'C' },
            { filePath: 'src/a.ts', description: 'A' },
            { filePath: 'src/b.ts', description: 'B' },
          ],
        ],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result1 = await service.retrieve(repositoryId, {
        topic: 'test',
      });
      const result2 = await service.retrieve(repositoryId, {
        topic: 'test',
      });

      const paths1 = result1.files.map((f) => f.filePath);
      const paths2 = result2.files.map((f) => f.filePath);
      expect(paths1).toEqual(paths2);
    });

    it('should include a direct graph neighbor outside semantic results', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/semantic.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/semantic.ts',
            labels: ['File'],
            properties: {},
          },
          {
            id: 'n2',
            filePath: 'src/graph-only.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [
          {
            id: 'e1',
            fromFilePath: 'src/semantic.ts',
            toFilePath: 'src/graph-only.ts',
            type: 'IMPORTS',
            hopDistance: 1,
          },
        ],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'test',
      });

      expect(result.files.some((f) => f.filePath === 'src/graph-only.ts')).toBe(
        true,
      );
      expect(result.relationships.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle two-hop paths when maxHops is 2', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/seed.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/seed.ts',
            labels: ['File'],
            properties: {},
          },
          {
            id: 'n2',
            filePath: 'src/hop1.ts',
            labels: ['File'],
            properties: {},
          },
          {
            id: 'n3',
            filePath: 'src/hop2.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [
          {
            id: 'e1',
            fromFilePath: 'src/seed.ts',
            toFilePath: 'src/hop1.ts',
            type: 'IMPORTS',
            hopDistance: 1,
          },
          {
            id: 'e2',
            fromFilePath: 'src/hop1.ts',
            toFilePath: 'src/hop2.ts',
            type: 'IMPORTS',
            hopDistance: 2,
          },
        ],
        clusters: [],
      });

      const result = await service.retrieve(
        repositoryId,
        { topic: 'test' },
        { maxHops: 2 },
      );

      expect(result.files.some((f) => f.filePath === 'src/hop2.ts')).toBe(true);
    });

    it('should deduplicate graph edges', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/a.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          { id: 'n1', filePath: 'src/a.ts', labels: ['File'], properties: {} },
          { id: 'n2', filePath: 'src/b.ts', labels: ['File'], properties: {} },
        ],
        edges: [
          {
            id: 'e1',
            fromFilePath: 'src/a.ts',
            toFilePath: 'src/b.ts',
            type: 'IMPORTS',
            hopDistance: 1,
          },
          {
            id: 'e1',
            fromFilePath: 'src/a.ts',
            toFilePath: 'src/b.ts',
            type: 'IMPORTS',
            hopDistance: 1,
          },
        ],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, { topic: 'test' });
      const dupEdges = result.relationships.filter(
        (e) =>
          e.edgeId === 'e1' &&
          e.fromFilePath === 'src/a.ts' &&
          e.toFilePath === 'src/b.ts',
      );
      expect(dupEdges.length).toBe(1);
    });

    it('should rank both-signal file ahead of otherwise comparable single-signal file', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1', 'sem2']],
        distances: [[0.2, 0.2]],
        metadatas: [
          [{ filePath: 'src/both.ts' }, { filePath: 'src/semantic-only.ts' }],
        ],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/both.ts',
            labels: ['File'],
            properties: {},
          },
          {
            id: 'n2',
            filePath: 'src/semantic-only.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [
          {
            id: 'e1',
            fromFilePath: 'src/both.ts',
            toFilePath: 'src/semantic-only.ts',
            type: 'IMPORTS',
            hopDistance: 1,
          },
        ],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, { topic: 'test' });
      const bothIdx = result.files.findIndex(
        (f) => f.filePath === 'src/both.ts',
      );
      const semIdx = result.files.findIndex(
        (f) => f.filePath === 'src/semantic-only.ts',
      );
      expect(bothIdx).toBeLessThan(semIdx);
    });

    it('should return empty cluster data', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/a.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          { id: 'n1', filePath: 'src/a.ts', labels: ['File'], properties: {} },
        ],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, { topic: 'test' });
      expect(result.moduleClusters).toEqual([]);
    });

    it('should skip graph node without a source path', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['sem1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/valid.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/valid.ts',
            labels: ['File'],
            properties: {},
          },
          { id: 'n2', filePath: '', labels: ['File'], properties: {} },
        ],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, { topic: 'test' });
      const emptyPaths = result.files.filter((f) => !f.filePath);
      expect(emptyPaths.length).toBe(0);
    });

    it('should query the quarantine collection when a fallback embedding is used', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3], true),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [['q1']],
        distances: [[0.1]],
        metadatas: [[{ filePath: 'src/fallback.ts' }]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      await service.retrieve(repositoryId, { topic: 'test' });

      expect(mockChroma.queryCollection).toHaveBeenCalledWith(
        'repo-repo-123-quarantine-gemini-gemini-test-model-768d',
        [0.1, 0.2, 0.3],
        10,
      );
    });

    it('should treat semantic source as empty when its collection is missing', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(false);
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'test',
      });

      expect(mockChroma.queryCollection).not.toHaveBeenCalled();
      expect(result.sourceStatus.semantic).toBe('empty');
      expect(result.noEvidence).toBe(true);
    });

    it('should resolve one unavailable source and one available source with diagnostics', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockRejectedValue(new Error('Gemini down'));
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [
          {
            id: 'n1',
            filePath: 'src/only-graph.ts',
            labels: ['File'],
            properties: {},
          },
        ],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'test',
        filePaths: ['src/only-graph.ts'],
      });

      expect(result.sourceStatus.semantic).toBe('unavailable');
      expect(result.sourceStatus.graph).toBe('available');
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('should set noEvidence true when both sources are available but return no results', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockResolvedValue(
        embedResult([0.1, 0.2, 0.3]),
      );
      mockChroma.collectionExists.mockResolvedValue(true);
      mockChroma.queryCollection.mockResolvedValue({
        ids: [[]],
        distances: [[]],
        metadatas: [[]],
      });
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'nonexistent',
      });

      expect(result.noEvidence).toBe(true);
    });

    it('should set noEvidence false when one source is unavailable and the other is empty', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockRejectedValue(new Error('Down'));
      mockNeo4j.getFileNeighborhood.mockResolvedValue({
        nodes: [],
        edges: [],
        clusters: [],
      });

      const result = await service.retrieve(repositoryId, {
        topic: 'test',
        filePaths: ['src/nonexistent.ts'],
      });

      expect(result.noEvidence).toBe(false);
    });

    it('should fail explicitly when both sources are unavailable', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });
      mockAiProvider.embedString.mockRejectedValue(new Error('Gemini down'));
      mockNeo4j.getFileNeighborhood.mockRejectedValue(new Error('Neo4j down'));

      await expect(
        service.retrieve(repositoryId, {
          topic: 'test',
          filePaths: ['src/any.ts'],
        }),
      ).rejects.toThrow('Both semantic and graph sources are unavailable');
    });

    it('should not call any source when query is invalid', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({ id: repositoryId });

      await expect(
        service.retrieve(repositoryId, { topic: '', filePaths: [] }),
      ).rejects.toThrow();

      expect(mockAiProvider.embedString).not.toHaveBeenCalled();
      expect(mockChroma.queryCollection).not.toHaveBeenCalled();
      expect(mockNeo4j.getFileNeighborhood).not.toHaveBeenCalled();
    });
  });
});
