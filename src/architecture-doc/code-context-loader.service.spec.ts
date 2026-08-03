import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import { CodeContextLoaderService } from './code-context-loader.service';
import { PrismaService } from '../prisma/prisma.service';
import { GitService } from '../git/git.service';
import { ConfigService } from '@nestjs/config';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { buildSectionGenerationPrompt } from './templates/section-generation.prompt';
import { SectionPlan } from './dto/architecture-draft.dto';

jest.mock('fs/promises');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('CodeContextLoaderService', () => {
  let service: CodeContextLoaderService;

  const mockPrisma = {
    repository: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockGitService = {
    clone: jest.fn(),
  };

  const configValues: Record<string, string | number | undefined> = {
    'workspace.root': '/workspace',
    'drafting.codeContextMaxFiles': 12,
    'drafting.codeContextMaxCharsPerFile': 4000,
    'drafting.codeContextMaxTotalChars': 32000,
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const repository = {
    id: 'repo-123',
    cloneUrl: 'https://github.com/acme/repo.git',
    defaultBranch: 'main',
    localPath: null as string | null,
  };

  const makeFile = (
    overrides: Partial<HybridRetrievalContext['files'][number]> = {},
  ): HybridRetrievalContext['files'][number] => ({
    filePath: 'src/auth.ts',
    description: 'Auth module',
    evidenceSources: ['semantic'],
    combinedScore: 100,
    ...overrides,
  });

  const baseContext: HybridRetrievalContext = {
    repositoryId: 'repo-123',
    files: [makeFile()],
    relationships: [],
    moduleClusters: [],
    missingSeedPaths: [],
    sourceStatus: { semantic: 'available', graph: 'available' },
    noEvidence: false,
  };

  const makeContext = (
    files: HybridRetrievalContext['files'] = [makeFile()],
  ): HybridRetrievalContext => ({ ...baseContext, files });

  beforeEach(async () => {
    jest.resetAllMocks();
    configValues['workspace.root'] = '/workspace';
    configValues['drafting.codeContextMaxFiles'] = 12;
    configValues['drafting.codeContextMaxCharsPerFile'] = 4000;
    configValues['drafting.codeContextMaxTotalChars'] = 32000;
    mockConfigService.get.mockImplementation(
      (key: string) => configValues[key],
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodeContextLoaderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GitService, useValue: mockGitService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CodeContextLoaderService>(CodeContextLoaderService);
  });

  describe('ensureClone', () => {
    it('reuses an accessible localPath without cloning', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...repository,
        localPath: '/workspace/analysis-1/repository',
      });
      mockFs.access.mockResolvedValue(undefined);

      const result = await service.ensureClone('repo-123', 'user-1');

      expect(result).toBe('/workspace/analysis-1/repository');
      expect(mockGitService.clone).not.toHaveBeenCalled();
    });

    it('clones and persists localPath when the stored path is missing', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...repository,
        localPath: '/workspace/analysis-1/repository',
      });
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockGitService.clone.mockResolvedValue({
        repositoryId: 'repo-123',
        localPath: '/workspace/draft-repo-123',
        branch: 'main',
        commitHash: 'abc123',
      });
      mockPrisma.repository.update.mockResolvedValue({});

      const result = await service.ensureClone('repo-123', 'user-1');

      expect(mockGitService.clone).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          repositoryId: 'repo-123',
          cloneUrl: 'https://github.com/acme/repo.git',
          branch: 'main',
        }),
      );
      expect(mockPrisma.repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            localPath: '/workspace/draft-repo-123',
          }),
        }),
      );
      expect(result).toBe('/workspace/draft-repo-123');
    });

    it('returns null and logs when cloning fails', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue({
        ...repository,
        localPath: null,
      });
      mockGitService.clone.mockRejectedValue(new Error('auth failed'));

      const result = await service.ensureClone('repo-123', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('enrich', () => {
    it('returns the context unchanged when rootPath is null', async () => {
      const context = makeContext();

      const result = await service.enrich(context, null);

      expect(result).toBe(context);
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('reads bounded code for files and sets codeContent', async () => {
      mockFs.readFile.mockResolvedValue('export const auth = true;\n');

      const result = await service.enrich(makeContext(), '/workspace/repo');

      expect(result.files[0].codeContent).toBe('export const auth = true;\n');
      expect(result.files[0].codeLoadError).toBeUndefined();
    });

    it('truncates codeContent to the per-file cap', async () => {
      mockFs.readFile.mockResolvedValue('x'.repeat(6000));

      const result = await service.enrich(makeContext(), '/workspace/repo');

      expect(result.files[0].codeContent?.length).toBe(4000);
    });

    it('stops adding code once the cumulative budget is exhausted', async () => {
      const context = makeContext([
        makeFile({ filePath: 'a.ts', combinedScore: 100 }),
        makeFile({ filePath: 'b.ts', combinedScore: 90 }),
      ]);
      mockConfigService.get.mockImplementation(
        (key: string) =>
          (
            ({
              'workspace.root': '/workspace',
              'drafting.codeContextMaxFiles': 12,
              'drafting.codeContextMaxCharsPerFile': 4000,
              'drafting.codeContextMaxTotalChars': 500,
            }) as Record<string, string | number | undefined>
          )[key],
      );
      mockFs.readFile.mockResolvedValue('y'.repeat(400));

      const result = await service.enrich(context, '/workspace/repo');

      expect(result.files[0].codeContent).toBeDefined();
      expect(result.files[1].codeContent).toBeUndefined();
    });

    it('sets codeLoadError and keeps the description when a file cannot be read', async () => {
      mockFs.readFile.mockRejectedValue(new Error('EISDIR'));

      const result = await service.enrich(makeContext(), '/workspace/repo');

      expect(result.files[0].codeContent).toBeUndefined();
      expect(result.files[0].codeLoadError).toContain('EISDIR');
      expect(result.files[0].description).toBe('Auth module');
    });

    it('never mutates relationships, clusters, or source status', async () => {
      mockFs.readFile.mockResolvedValue('code');

      const result = await service.enrich(makeContext(), '/workspace/repo');

      expect(result.relationships).toEqual([]);
      expect(result.moduleClusters).toEqual([]);
      expect(result.sourceStatus).toEqual({
        semantic: 'available',
        graph: 'available',
      });
      expect(result.noEvidence).toBe(false);
    });

    it('keeps descriptions and renders the unavailable marker for unreadable files without aborting (US4)', async () => {
      mockFs.readFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const enriched = await service.enrich(makeContext(), '/workspace/repo');

      expect(enriched.files[0].codeLoadError).toContain('EACCES');
      expect(enriched.files[0].description).toBe('Auth module');

      const plan: SectionPlan = {
        key: 'auth-module',
        title: 'Authentication Module',
        purpose: 'Handles user authentication',
        retrievalTopic: 'authentication implementation',
      };
      const prompt = buildSectionGenerationPrompt(plan, enriched);

      expect(prompt).toContain('[code unavailable: EACCES: permission denied]');
      expect(prompt).toContain('src/auth.ts: Auth module');
    });
  });
});
