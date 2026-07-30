import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudClient } from 'chromadb';

@Injectable()
export class ChromaService {
  private readonly logger = new Logger(ChromaService.name);
  private readonly client: CloudClient;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('chroma.host') || 'api.trychroma.com';
    const apiKey = this.configService.get<string>('chroma.apiKey');
    const tenant = this.configService.get<string>('chroma.tenant') || 'default_tenant';
    const database = this.configService.get<string>('chroma.database') || 'default_database';

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
      this.logger.error(`Failed to get or create collection ${collectionName}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Deletes a collection and all its contents if it exists.
   */
  async deleteCollection(collectionName: string) {
    try {
      this.logger.log(`Deleting Chroma collection: ${collectionName}`);
      await this.client.deleteCollection({
        name: collectionName,
      });
    } catch (error) {
      // If collection does not exist, deleteCollection might throw. We log a warning.
      this.logger.warn(`Failed to delete collection ${collectionName}: ${(error as Error).message}`);
    }
  }

  /**
   * Upserts a batch of document chunks with pre-computed embeddings and metadata.
   */
  async upsertChunks(
    collectionName: string,
    chunks: Array<{ id: string; document: string; metadata: Record<string, any>; embedding: number[] }>
  ) {
    if (chunks.length === 0) return;

    try {
      const collection = await this.getOrCreateCollection(collectionName);
      const ids = chunks.map((c) => c.id);
      const documents = chunks.map((c) => c.document);
      const metadatas = chunks.map((c) => c.metadata);
      const embeddings = chunks.map((c) => c.embedding);

      this.logger.log(`Upserting ${chunks.length} chunks to collection ${collectionName}`);
      await collection.upsert({
        ids,
        documents,
        metadatas,
        embeddings,
      });
    } catch (error) {
      this.logger.error(`Failed to upsert chunks to collection ${collectionName}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Retrieves all entries from a collection, optionally filtered by IDs or metadata.
   */
  async getCollectionEntries(
    collectionName: string,
    where?: Record<string, any>,
  ) {
    try {
      const collection = await this.getOrCreateCollection(collectionName);
      this.logger.log(`Getting entries from collection ${collectionName}`);
      const result = await collection.get({ where });
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get entries from collection ${collectionName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Performs a similarity query (top-K results) in the collection using the query embedding.
   */
  async queryCollection(collectionName: string, queryEmbedding: number[], limit = 5) {
    try {
      const collection = await this.getOrCreateCollection(collectionName);
      this.logger.log(`Querying collection ${collectionName} with limit ${limit}`);
      const result = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit,
      });

      return result;
    } catch (error) {
      this.logger.error(`Failed to query collection ${collectionName}: ${(error as Error).message}`);
      throw error;
    }
  }
}
