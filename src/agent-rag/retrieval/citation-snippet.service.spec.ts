import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CitationSnippetService } from './citation-snippet.service';

describe('CitationSnippetService', () => {
  let service: CitationSnippetService;
  let tmpDir: string;
  let prismaMock: { repository: { findUnique: jest.Mock } };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nebula-snip-'));
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(
      path.join(tmpDir, 'src', 'auth.ts'),
      ['line1', 'line2', 'function authenticate() {', '  return true;', '}', 'line6'].join('\n'),
    );

    prismaMock = {
      repository: {
        findUnique: jest.fn().mockResolvedValue({ localPath: tmpDir }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CitationSnippetService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(CitationSnippetService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a bounded window around lineRange from the local clone', async () => {
    const [enriched] = await service.enrich('repo-1', [
      {
        filePath: 'src/auth.ts',
        lineRange: '3-5',
        nodeId: 'n1',
      },
    ]);

    expect(enriched.snippet).toContain('function authenticate() {');
    expect(enriched.snippet).toContain('return true;');
  });

  it('falls back to hit content when the clone is missing', async () => {
    prismaMock.repository.findUnique.mockResolvedValue({ localPath: null });

    const [enriched] = await service.enrich('repo-1', [
      {
        filePath: 'src/auth.ts',
        lineRange: '1-2',
        nodeId: 'n1',
        snippet: 'cached description',
      },
    ]);

    expect(enriched.snippet).toBe('cached description');
  });

  it('rejects path traversal', async () => {
    const [enriched] = await service.enrich('repo-1', [
      {
        filePath: '../../etc/passwd',
        lineRange: null,
        nodeId: 'n1',
        snippet: 'fallback',
      },
    ]);

    expect(enriched.snippet).toBe('fallback');
  });

  it('merges synthesizer citations with previously enriched snippets', () => {
    const merged = service.merge(
      [{ filePath: 'src/auth.ts', lineRange: '3-5', nodeId: 'n1' }],
      [
        {
          filePath: 'src/auth.ts',
          lineRange: '3-5',
          nodeId: 'n1',
          snippet: 'function authenticate() {',
        },
      ],
    );

    expect(merged[0].snippet).toBe('function authenticate() {');
  });
});
