import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudClient, Collection } from 'chromadb';

@Injectable()
export class ChromaService {
  private readonly logger = new Logger(ChromaService.name);
  private readonly client: CloudClient;
  /** In-process cache so repeated getOrCreate calls stay local (no HTTP round-trip). */
  private readonly collections = new Map<string, Promise<Collection>>();

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
   * Results are cached in-process (promise-coalesced) so concurrent callers
   * share a single network round-trip and subsequent calls are free.
   */
  async getOrCreateCollection(collectionName: string): Promise<Collection> {
    const cached = this.collections.get(collectionName);
    if (cached) {
      this.logger.debug(`Chroma collection cache hit: ${collectionName}`);
      return cached;
    }

    const pending = this.client
      .getOrCreateCollection({
        name: collectionName,
      })
      .then((collection) => {
        this.logger.debug(
          `Chroma collection fetched and cached: ${collectionName}`,
        );
        return collection;
      })
      .catch((error: unknown) => {
        // Don't poison the cache — allow a retry on the next call.
        this.collections.delete(collectionName);
        this.logger.error(
          `Failed to get or create collection ${collectionName}: ${(error as Error).message}`,
        );
        throw error;
      });

    this.collections.set(collectionName, pending);
    return pending;
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
  async deleteCollection(collectionName: string) {
    try {
      this.logger.log(`Deleting Chroma collection: ${collectionName}`);
      this.collections.delete(collectionName);
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

      if (
        currentBatchSize + chunkSize > MAX_BATCH_BYTES &&
        currentBatch.length > 0
      ) {
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
   * Deletes every collection whose name starts with the given prefix
   * (e.g. `repo-<id>` and any `repo-<id>-quarantine-...` collections).
   * Best-effort: failures are logged and swallowed so callers can clean up
   * other repository artifacts without being blocked by Chroma outages.
   */
  async deleteCollectionsByPrefix(prefix: string): Promise<void> {
    try {
      const total = await this.client.countCollections();
      const names: string[] = [];
      const PAGE_SIZE = 100;

      for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        const page = await this.client.listCollections({
          limit: PAGE_SIZE,
          offset,
        });
        names.push(...page.map((collection) => collection.name));
      }

      const matching = names.filter((name) => name.startsWith(prefix));
      for (const name of matching) {
        await this.deleteCollection(name);
      }

      if (matching.length > 0) {
        this.logger.log(
          `Deleted ${matching.length} Chroma collection(s) with prefix "${prefix}"`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete collections by prefix ${prefix}: ${(error as Error).message}`,
      );
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
        ...(where && Object.keys(where).length > 0 ? { where: where } : {}),
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to query collection ${collectionName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Fetches documents by exact chunk ids in a single request — no embedding
   * and no similarity search required. Ideal when ids are deterministic
   * (e.g. `${repositoryId}:${filePath}` description chunks).
   * Missing ids are simply absent from the response.
   */
  async getByIds(
    collectionName: string,
    ids: string[],
  ): Promise<{
    ids: string[];
    documents: (string | null)[];
    metadatas: (Record<string, unknown> | null)[];
  }> {
    if (ids.length === 0) {
      return { ids: [], documents: [], metadatas: [] };
    }

    try {
      const collection = await this.getOrCreateCollection(collectionName);
      this.logger.debug(
        `Fetching ${ids.length} chunk(s) by id from ${collectionName}`,
      );
      const result = await collection.get({
        ids: ids,
        include: ['documents', 'metadatas'],
      });
      return {
        ids: result.ids ?? [],
        documents: result.documents ?? [],
        metadatas: result.metadatas ?? [],
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch chunks by id from ${collectionName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
