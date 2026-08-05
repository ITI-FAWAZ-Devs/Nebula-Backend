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

    it('should fall back to a deterministic diagram when the LLM returns malformed output', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('This is not valid Mermaid syntax'),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^(flowchart|graph)\s/);
      expect(result!.modules.length).toBeGreaterThan(0);
    });

    it('should extract mermaid from prose-wrapped LLM output', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          'Here is the dependency graph for this repository:\n\nflowchart TD\n  A[Application Core] --> B[Auth Module]',
        ),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^flowchart\s/);
      expect(result!.modules).toContain('Application Core');
    });

    it('should fall back to a deterministic diagram when the response is not mermaid', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('```text\nnot a diagram\n```'),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^(flowchart|graph)\s/);
    });

    it('should build a deterministic diagram from files when no graph evidence exists', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult('Not a diagram at all'),
      );

      const files = [
        { filePath: 'src/auth/auth.service.ts' },
        { filePath: 'src/users/users.service.ts' },
      ];

      const result = await service.generate(
        [],
        [],
        mockSections,
        undefined,
        files,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^flowchart\s/);
      expect(result!.modules).toContain('src');
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

    it('should strip mermaid fences from the LLM response', async () => {
      mockAiProvider.generateContent.mockResolvedValue(
        llmResult(
          '```mermaid\nflowchart TD\n  A[Application Core] --> B[Auth Module]\n```',
        ),
      );

      const result = await service.generate(
        mockRelationships,
        mockClusters,
        mockSections,
      );

      expect(result).not.toBeNull();
      expect(result!.mermaidSource).toMatch(/^(flowchart|graph)\s/);
      expect(result!.mermaidSource).not.toContain('```');
    });

    it('should pass focus through to the diagram prompt', async () => {
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
        'Auth Module',
      );

      expect(result).not.toBeNull();
      expect(mockAiProvider.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('"Auth Module"'),
        expect.anything(),
      );
    });
  });
});
