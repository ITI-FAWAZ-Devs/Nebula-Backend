import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../../ai-provider/ai-provider.service';
import { ChromaService } from '../../chroma/chroma.service';
import { FAST_ANSWER_SIMILARITY_THRESHOLD } from '../agent-rag.constants';
import { AgentCitation } from '../dto/retrieval-hit.dto';

export const ARCHITECTURE_DOCS_COLLECTION = 'architecture_docs';

export interface FastAnswerResult {
  answer: string;
  sectionTitle: string;
  sectionKey: string;
  score: number;
  citations: AgentCitation[];
}

@Injectable()
export class FastAnswerService {
  private readonly logger = new Logger(FastAnswerService.name);

  constructor(
    private readonly aiProvider: AiProviderService,
    private readonly chromaService: ChromaService,
  ) {}

  async findFastAnswer(
    repositoryId: string,
    question: string,
  ): Promise<FastAnswerResult | null> {
    try {
      if (
        !(await this.chromaService.collectionExists(
          ARCHITECTURE_DOCS_COLLECTION,
        ))
      ) {
        return null;
      }

      const embedResult = await this.aiProvider.embedString(
        question,
        'search_query',
      );

      const queryResult = await this.chromaService.queryCollection(
        ARCHITECTURE_DOCS_COLLECTION,
        embedResult.embedding,
        1,
        { docId: repositoryId },
      );

      const ids = queryResult.ids?.[0] || [];
      const documents = queryResult.documents?.[0] || [];
      const metadatas = queryResult.metadatas?.[0] || [];
      const distances = queryResult.distances?.[0] || [];

      if (ids.length === 0 || !documents[0]) {
        return null;
      }

      const distance =
        typeof distances[0] === 'number' ? distances[0] : 1.0;
      // Similarity score calculation matching VectorRetrievalService
      const score = Math.max(0, Math.min(1, 1 / (1 + distance)));

      if (score < FAST_ANSWER_SIMILARITY_THRESHOLD) {
        this.logger.debug(
          `Fast answer miss: top similarity score ${score.toFixed(3)} < threshold ${FAST_ANSWER_SIMILARITY_THRESHOLD}`,
        );
        return null;
      }

      const meta = (metadatas[0] || {}) as Record<string, unknown>;
      const sectionTitle = String(meta.sectionTitle || '');
      const sectionKey = String(meta.sectionKey || '');
      const sourceFilesRaw = String(meta.sourceFiles || '');
      const sourceFiles = sourceFilesRaw
        ? sourceFilesRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const citations: AgentCitation[] = sourceFiles.map((filePath) => ({
        filePath,
        lineRange: null,
        nodeId: `${repositoryId}:${filePath}`,
      }));

      this.logger.log(
        `Fast answer HIT for query "${question.slice(0, 80)}" (score: ${score.toFixed(3)}, section: ${sectionTitle})`,
      );

      return {
        answer: documents[0],
        sectionTitle,
        sectionKey,
        score,
        citations,
      };
    } catch (error) {
      this.logger.warn(
        `Fast answer evaluation failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
