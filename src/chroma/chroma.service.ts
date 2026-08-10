import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudClient } from 'chromadb';

@Injectable()
export class ChromaService {
  private readonly logger = new Logger(ChromaService.name);
  private readonly client: CloudClient;

  constructor(private readonly configService: ConfigService) {
    const host =
      this.configService.get<string>('chroma.host') || 'api.trychroma.com';
    const apiKey = this.configService.get<string>('chroma.apiKey');
    const tenant =
      this.configService.get<string>('chroma.tenant') || 'default_tenant';
    const database =
      this.configService.get<string>('chroma.database') || 'default_database';

    if (!apiKey) {
      this.logger.warn('Chroma API key is not configured');
    }

    this.client = new CloudClient({
      host,
      tenant,
      database,
      apiKey: apiKey || '',
    });
  }

  /**
   * Retrieves an existing collection or creates it if it doesn't exist.
   */
  async getOrCreateCollection(collectionName: string) {
    try {
      this.logger.log(`Get or create Chroma collection: ${collectionName}`);
      return await this.client.getOrCreateCollection({
        name: collectionName,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get or create collection ${collectionName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Returns true if a collection with the given name already exists.
   * Used to avoid querying collections that live in a different embedding
   * space (e.g. the quarantine collection written during provider fallback).
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      await this.client.getCollection({ name: collectionName });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes a collection and all its contents if it exists.
   */
  async deleteCollection(collectionName: string) {    try {
      this.logger.log(`Deleting Chroma collection: ${collectionName}`);
      await this.client.deleteCollection({
        name: collectionName,
      });
    } catch (error) {
      // If collection does not exist, deleteCollection might throw. We log a warning.
      this.logger.warn(
        `Failed to delete collection ${collectionName}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Upserts a batch of document chunks with pre-computed embeddings and metadata.
   *
   * Chroma Cloud enforces a 16 KB document-size limit per upsert request.
   * To stay safely under that threshold, chunks are grouped into sub-batches
   * whose combined UTF-8 byte size does not exceed MAX_BATCH_BYTES. Each
   * sub-batch is then upserted sequentially.
   */
  async upsertChunks(
    collectionName: string,
    chunks: Array<{
      id: string;
      document: string;
      metadata: Record<string, any>;
      embedding: number[];
    }>,
  ) {
    if (chunks.length === 0) return;

    /** Conservative limit — 12 KB leaves headroom below the 16 KB quota */
    const MAX_BATCH_BYTES = 12 * 1024;

    // Split chunks into size-aware sub-batches
    const batches: (typeof chunks)[] = [];
    let currentBatch: typeof chunks = [];
    let currentBatchSize = 0;

    for (const chunk of chunks) {
      const chunkSize = Buffer.byteLength(chunk.document, 'utf8');

      // If a single chunk exceeds the limit on its own, warn and skip it
      if (chunkSize > MAX_BATCH_BYTES) {
        this.logger.warn(
          `Chunk ${chunk.id} document size (${chunkSize} bytes) exceeds MAX_BATCH_BYTES ` +
            `(${MAX_BATCH_BYTES} bytes). Skipping this chunk to avoid quota error.`,
        );
        continue;
      }

      if (currentBatchSize + chunkSize > MAX_BATCH_BYTES && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(chunk);
      currentBatchSize += chunkSize;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    if (batches.length === 0) return;

    const collection = await this.getOrCreateCollection(collectionName);

    this.logger.log(
      `Upserting ${chunks.length} chunks to collection ${collectionName} ` +
        `in ${batches.length} size-aware batch(es)`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        await collection.upsert({
          ids: batch.map((c) => c.id),
          documents: batch.map((c) => c.document),
          metadatas: batch.map((c) => c.metadata),
          embeddings: batch.map((c) => c.embedding),
        });
      } catch (error) {
        this.logger.error(
          `Failed to upsert batch ${i + 1}/${batches.length} to collection ` +
            `${collectionName}: ${(error as Error).message}`,
        );
        throw error;
      }
    }
  }

  /**
   * Performs a similarity query (top-K results) in the collection using the query embedding.
   * `where` narrows scope by metadata (e.g. filePath, language, repositoryId) instead of
   * relying purely on raw top-k similarity.
   */
  async queryCollection(
    collectionName: string,
    queryEmbedding: number[],
    limit = 5,
    where?: Record<string, string | number | boolean>,
  ) {
    try {
      const collection = await this.getOrCreateCollection(collectionName);
      this.logger.log(
        `Querying collection ${collectionName} with limit ${limit}`,
      );
      const result = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit,
        ...(where && Object.keys(where).length > 0
          ? { where: where as Record<string, string | number | boolean> }
          : {}),
      } as Parameters<typeof collection.query>[0]);

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to query collection ${collectionName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
