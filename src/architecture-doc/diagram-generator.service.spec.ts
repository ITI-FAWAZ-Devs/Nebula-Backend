import { Test, TestingModule } from '@nestjs/testing';
import { DiagramGeneratorService } from './diagram-generator.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import {
  FileRelationship,
  ModuleCluster,
} from './dto/hybrid-retrieval-context.dto';
import { DraftSection } from './dto/architecture-draft.dto';

describe('DiagramGeneratorService', () => {
  let service: DiagramGeneratorService;
  let aiProvider: AiProviderService;

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

  const mockRelationships: FileRelationship[] = [
    {
      fromFilePath: 'src/main.ts',
      toFilePath: 'src/app.module.ts',
      type: 'IMPORTS',
      hopDistance: 1,
      edgeId: 'edge-1',
    },
    {
      fromFilePath: 'src/app.module.ts',
      toFilePath: 'src/auth/auth.module.ts',
      type: 'IMPORTS',
      hopDistance: 1,
      edgeId: 'edge-2',
    },
  ];

  const mockClusters: ModuleCluster[] = [
    {
      name: 'Application Core',
      filePaths: ['src/main.ts', 'src/app.module.ts'],
    },
    {
      name: 'Auth Module',
      filePaths: ['src/auth/auth.module.ts', 'src/auth/auth.service.ts'],
    },
  ];

  const mockSections: DraftSection[] = [
    {
      key: 'overview',
      title: 'Overview',
      contentMd: 'Application overview',
      sourceFiles: ['src/main.ts', 'src/app.module.ts'],
      verdict: 'verified',
      verificationNotes: null,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiagramGeneratorService,
        { provide: AiProviderService, useValue: mockAiProvider },
      ],
    }).compile();

    service = module.get<DiagramGeneratorService>(DiagramGeneratorService);
    aiProvider = module.get<AiProviderService>(AiProviderService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    it('should generate valid flowchart output', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `flowchart TD
    A[Application Core] --> B[Auth Module]`,
        ),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^(flowchart|graph)\s/);
      expect(result!.modules).toContain('Application Core');
      expect(result!.modules).toContain('Auth Module');
    });

    it('should generate valid graph output', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `graph TD
    A[main.ts] --> B[app.module.ts]
    B --> C[auth.module.ts]`,
        ),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^(flowchart|graph)\s/);
    });

    it('should return null when no relationship evidence exists', async () => {
      const result = await service.generate([], [], mockSections);

      expect(result).toBeNull();
    });

    it('should reject modules absent from evidence', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `flowchart TD
    A[main.ts] --> B[app.module.ts]
    B --> C[unknown.module.ts]`,
        ),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.modules).not.toContain('unknown.module.ts');
    });

    it('should return null with notes for malformed Mermaid', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('This is not valid Mermaid syntax'),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).toBeNull();
    });

    it('should handle empty clusters gracefully', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          `flowchart TD
    A[src/main.ts] --> B[src/app.module.ts]`,
        ),
      );

      const result = await service.generate(
        mockRelationships,
        [],
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^flowchart\s/);
    });
  });
});
