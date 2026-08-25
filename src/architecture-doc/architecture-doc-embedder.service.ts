import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { ChromaService } from '../chroma/chroma.service';
import { ArchitectureDocEmbeddingPayload } from './dto/architecture-doc-embedding.dto';

export const ARCHITECTURE_DOCS_COLLECTION = 'architecture_docs';

@Injectable()
export class ArchitectureDocEmbedderService {
  private readonly logger = new Logger(ArchitectureDocEmbedderService.name);

  constructor(
    private readonly aiProvider: AiProviderService,
    private readonly chromaService: ChromaService,
  ) {}

  /**
   * Embeds sections of an Architecture Specification Document into ChromaDB
   * via a single batched AiProvider embedding call.
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

      // 1. Prepare texts to embed in a single batch
      const textsToEmbed = sections.map(
        (section) => `# ${section.title}\n\n${section.contentMd}`,
      );

      this.logger.log(
        `[Doc ${docId}] Generating batched embeddings for ${sections.length} section(s)...`,
      );
      const batchResult = await this.aiProvider.embedMany(
        textsToEmbed,
        'search_document',
      );

      // 2. Construct structured metadata & chunks for ChromaDB
      const chunksToUpsert = sections.map((section, index) => ({
        id: `${docId}_${section.key}`,
        document: textsToEmbed[index],
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
        embedding: batchResult.embeddings[index],
      }));

      // 3. Store/Upsert batch into ChromaDB
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
