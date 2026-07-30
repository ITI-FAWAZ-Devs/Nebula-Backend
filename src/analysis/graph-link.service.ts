import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import { ChromaService } from '../chroma/chroma.service';

@Injectable()
export class GraphLinkService {
  private readonly logger = new Logger(GraphLinkService.name);

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly chroma: ChromaService,
  ) {}

  async linkEmbeddingsToGraphNodes(
    repositoryId: string,
    collectionName: string,
  ): Promise<number> {
    const graphNodes = await this.getFileNodes(repositoryId);
    if (graphNodes.length === 0) {
      this.logger.warn(`No File nodes found for repository ${repositoryId}`);
      return 0;
    }

    const pathToNode = new Map<string, string>();
    for (const node of graphNodes) {
      const filePath =
        (node.path as string) ||
        (node.sourceFile as string) ||
        (node.name as string);
      if (filePath) {
        pathToNode.set(filePath, node.id as string);
      }
    }

    let chromaEntries;
    try {
      chromaEntries = await this.chroma.getCollectionEntries(collectionName, {
        repositoryId,
      });
    } catch {
      this.logger.warn(
        `Could not read Chroma collection ${collectionName} — skipping link`,
      );
      return 0;
    }

    if (
      !chromaEntries ||
      !chromaEntries.ids ||
      chromaEntries.ids.length === 0
    ) {
      this.logger.log(`No Chroma entries found for repository ${repositoryId}`);
      return 0;
    }

    const updatedIds: string[] = [];
    const updatedDocuments: string[] = [];
    const updatedMetadatas: Record<string, any>[] = [];
    const updatedEmbeddings: number[][] = [];
    let linkCount = 0;

    for (let i = 0; i < chromaEntries.ids.length; i++) {
      const id = chromaEntries.ids[i];
      const meta = (chromaEntries.metadatas?.[i] || {}) as Record<string, any>;
      const doc = (chromaEntries.documents?.[i] || '') as string;
      const embedding = (chromaEntries.embeddings?.[i] || []) as number[];

      const filePath = meta.filePath as string | undefined;
      const graphNodeId = filePath ? pathToNode.get(filePath) : undefined;

      if (graphNodeId && !meta.graphNodeId) {
        const modulePath = meta.modulePath as string | undefined;
        const moduleGraphNodeId = modulePath
          ? pathToNode.get(modulePath)
          : undefined;

        updatedIds.push(id);
        updatedDocuments.push(doc);
        updatedMetadatas.push({
          ...meta,
          graphNodeId,
          moduleGraphNodeId: moduleGraphNodeId || '',
        });
        updatedEmbeddings.push(embedding);
        linkCount++;
      }
    }

    if (updatedIds.length > 0) {
      await this.chroma.upsertChunks(collectionName, updatedIds.map((id, i) => ({
        id,
        document: updatedDocuments[i],
        metadata: updatedMetadatas[i],
        embedding: updatedEmbeddings[i],
      })));
      this.logger.log(
        `Linked ${linkCount} Chroma embeddings to Neo4j graph nodes for repository ${repositoryId}`,
      );
    } else {
      this.logger.log(
        `All ${chromaEntries.ids.length} Chroma entries already linked for repository ${repositoryId}`,
      );
    }

    return linkCount;
  }

  private async getFileNodes(
    repositoryId: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (n {repositoryId: $repositoryId})
      WHERE n:File OR n:Module
      RETURN n.id AS id, n.name AS name, n.path AS path,
             n.sourceFile AS sourceFile
      `,
      { repositoryId },
    );
    return result.records.map((r) => r.toObject());
  }
}
