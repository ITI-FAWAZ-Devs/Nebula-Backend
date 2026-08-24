import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentCitation } from '../dto/retrieval-hit.dto';
import {
  CITATION_SNIPPET_CONTEXT_LINES,
  CITATION_SNIPPET_DEFAULT_LINES,
  CITATION_SNIPPET_MAX_CHARS,
} from '../agent-rag.constants';

@Injectable()
export class CitationSnippetService {
  private readonly logger = new Logger(CitationSnippetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prefer a bounded window from the local clone when available; otherwise
   * keep the retrieval-hit content already attached to the citation.
   */
  async enrich(
    repositoryId: string,
    citations: AgentCitation[],
  ): Promise<AgentCitation[]> {
    if (citations.length === 0) return citations;

    const localPath = await this.resolveLocalPath(repositoryId);

    return Promise.all(
      citations.map(async (citation) => {
        const fromFile = localPath
          ? await this.readSnippet(
              localPath,
              citation.filePath,
              citation.lineRange,
            )
          : null;
        const snippet = fromFile ?? this.truncate(citation.snippet);
        return snippet ? { ...citation, snippet } : citation;
      }),
    );
  }

  merge(
    fromSynthesizer: AgentCitation[],
    enriched: AgentCitation[],
  ): AgentCitation[] {
    if (enriched.length === 0) return fromSynthesizer;
    if (fromSynthesizer.length === 0) return enriched;

    const byKey = new Map(enriched.map((c) => [this.key(c), c] as const));
    return fromSynthesizer.map((c) => {
      const prev = byKey.get(this.key(c));
      return prev?.snippet ? { ...c, snippet: prev.snippet } : c;
    });
  }

  private key(c: AgentCitation): string {
    return `${c.nodeId}:${c.filePath}:${c.lineRange || ''}`;
  }

  private async resolveLocalPath(repositoryId: string): Promise<string | null> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { localPath: true },
    });
    if (!repo?.localPath) return null;
    try {
      await fs.access(repo.localPath);
      return repo.localPath;
    } catch {
      return null;
    }
  }

  private async readSnippet(
    root: string,
    filePath: string,
    lineRange: string | null,
  ): Promise<string | null> {
    const resolvedRoot = path.resolve(root);
    const resolvedFile = path.resolve(resolvedRoot, filePath);
    const rootWithSep = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : resolvedRoot + path.sep;
    if (
      resolvedFile !== resolvedRoot &&
      !resolvedFile.startsWith(rootWithSep)
    ) {
      this.logger.warn(`Rejected path traversal for snippet: ${filePath}`);
      return null;
    }

    try {
      const raw = await fs.readFile(resolvedFile, 'utf8');
      const lines = raw.split(/\r?\n/);
      const { start, end } = this.parseRange(lineRange, lines.length);
      const from = Math.max(1, start - CITATION_SNIPPET_CONTEXT_LINES);
      const to = Math.min(lines.length, end + CITATION_SNIPPET_CONTEXT_LINES);
      return this.truncate(lines.slice(from - 1, to).join('\n')) ?? null;
    } catch (error) {
      this.logger.debug(
        `Could not read snippet ${filePath}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private parseRange(
    lineRange: string | null,
    lineCount: number,
  ): { start: number; end: number } {
    if (!lineRange) {
      return {
        start: 1,
        end: Math.min(lineCount, CITATION_SNIPPET_DEFAULT_LINES),
      };
    }
    const match = lineRange.match(/(\d+)\s*-?\s*(\d+)?/);
    if (!match) {
      return {
        start: 1,
        end: Math.min(lineCount, CITATION_SNIPPET_DEFAULT_LINES),
      };
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    return { start, end };
  }

  private truncate(text?: string): string | undefined {
    if (!text) return undefined;
    if (text.length <= CITATION_SNIPPET_MAX_CHARS) return text;
    return text.slice(0, CITATION_SNIPPET_MAX_CHARS);
  }
}
