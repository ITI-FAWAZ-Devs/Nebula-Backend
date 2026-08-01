import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service';
import { ChromaService } from '../chroma/chroma.service';
import { ArchitectureDocEmbeddingPayload } from './dto/architecture-doc-embedding.dto';

export const ARCHITECTURE_DOCS_COLLECTION = 'architecture_docs';

@Injectable()
export class ArchitectureDocEmbedderService {
  private readonly logger = new Logger(ArchitectureDocEmbedderService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly chromaService: ChromaService,
  ) {}

  /**
   * Embeds sections of an Architecture Specification Document into ChromaDB using Gemini Embeddings.
   *
   * @param payload Document payload containing docId, version, commitSha, and sections.
   */
  async embedDocument(payload: ArchitectureDocEmbeddingPayload): Promise<void> {
    const { docId, version, commitSha, sections, generatedAt } = payload;

    if (!sections || sections.length === 0) {
      this.logger.warn(`[Doc ${docId}] No sections provided for embedding.`);
      return;
    }

    this.logger.log(
      `[Doc ${docId}] Starting section-based embedding pipeline for ${sections.length} sections (v${version})...`,
    );

    try {
      const generatedAtIso = generatedAt
        ? new Date(generatedAt).toISOString()
        : new Date().toISOString();

      const chunksToUpsert: Array<{
        id: string;
        document: string;
        metadata: Record<string, any>;
        embedding: number[];
      }> = [];

      for (const section of sections) {
        // 1. Construct text snippet combining title and markdown content
        const textToEmbed = `# ${section.title}\n\n${section.contentMd}`;
        const recordId = `${docId}_${section.key}`;

        // 2. Generate embedding vector via Gemini
        this.logger.log(
          `[Doc ${docId}] Generating embedding for section '${section.key}'...`,
        );
        const embedding = await this.geminiService.embedString(textToEmbed);

        // 3. Construct structured metadata & chunk
        chunksToUpsert.push({
          id: recordId,
          document: textToEmbed,
          metadata: {
            docId,
            version: Number(version),
            commitSha: commitSha ?? '',
            sectionKey: section.key,
            sectionTitle: section.title,
            sourceFiles: Array.isArray(section.sourceFiles)
              ? section.sourceFiles.join(', ')
              : String(section.sourceFiles || ''),
            generatedAt: generatedAtIso,
          },
          embedding,
        });
      }

      // 4. Store/Upsert batch into ChromaDB
      this.logger.log(
        `[Doc ${docId}] Upserting ${chunksToUpsert.length} vectors to ChromaDB collection '${ARCHITECTURE_DOCS_COLLECTION}'...`,
      );

      await this.chromaService.upsertChunks(
        ARCHITECTURE_DOCS_COLLECTION,
        chunksToUpsert,
      );

      this.logger.log(
        `[Doc ${docId}] Successfully stored architecture document (v${version}) in ChromaDB.`,
      );
    } catch (error) {
      this.logger.error(
        `[Doc ${docId}] Failed to embed architecture document: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
