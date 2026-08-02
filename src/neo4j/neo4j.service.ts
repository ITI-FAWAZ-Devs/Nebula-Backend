import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Integer } from 'neo4j-driver';
import {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
} from '../graph/interfaces/knowledge-graph.interface';

export interface NeighborhoodNode {
  id: string;
  filePath: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface NeighborhoodEdge {
  id: string;
  fromFilePath: string;
  toFilePath: string;
  type: string;
  hopDistance: number;
}

export interface FileNeighborhoodResult {
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
  clusters: Array<{ name: string; filePaths: string[] }>;
}

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver: Driver | null = null;
  private readonly database: string;

  constructor(private readonly configService: ConfigService) {
    this.database = this.configService.get<string>('neo4j.database') || 'neo4j';
  }

  async onModuleInit(): Promise<void> {
    const uri = this.configService.get<string>('neo4j.uri');
    const username = this.configService.get<string>('neo4j.username');
    const password = this.configService.get<string>('neo4j.password');

    if (!uri || !username || !password) {
      this.logger.warn(
        'Neo4j credentials not fully configured — driver not initialized',
      );
      return;
    }

    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    try {
      await this.driver.verifyConnectivity();
      this.logger.log('Connected to Neo4j');
    } catch (error) {
      this.logger.error(
        `Neo4j connectivity check failed: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.logger.log('Neo4j driver closed');
    }
  }

  private getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver is not initialized');
    }
    return this.driver.session({ database: this.database });
  }

  async getFileNeighborhood(
    repositoryId: string,
    seedPaths: string[],
    maxHops: number,
  ): Promise<FileNeighborhoodResult> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (start)
        WHERE start.repositoryId = $repositoryId
          AND any(key IN ['path', 'sourceFile', 'name']
              KEYS start[key] AND start[key] IN $seedPaths)
        OPTIONAL MATCH (start)-[r*1..$maxHops]-(neighbor)
        WHERE neighbor.repositoryId = $repositoryId
        UNWIND (CASE WHEN r IS NULL THEN [NULL] ELSE r END) AS relChain
        WITH start, collect(DISTINCT neighbor) AS allNodes,
             collect(DISTINCT relChain) AS allRelChains
        UNWIND allNodes AS node
        WITH DISTINCT node,
             [rel IN allRelChains WHERE rel IS NOT NULL | rel] AS chains
        UNWIND (CASE WHEN chains = [] THEN [NULL] ELSE chains END) AS chain
        UNWIND (CASE WHEN chain IS NULL THEN [NULL] ELSE chain END) AS rel
        WITH node, rel,
             CASE
               WHEN rel IS NOT NULL
               THEN reduce(hop = 0, r IN CASE WHEN chain IS NULL THEN [] ELSE chain END | hop + 1)
               ELSE NULL
             END AS distance
        WITH node,
             collect(DISTINCT {
               rel: rel,
               distance: coalesce(
                 CASE WHEN rel IS NOT NULL THEN
                   reduce(h = 0, r IN CASE WHEN chain IS NULL THEN [] ELSE chain END | h + 1)
                 ELSE NULL END,
                 0
               )
             }) AS rels
        RETURN
          collect(DISTINCT {
            id: node.id,
            filePath: coalesce(node.path, node.sourceFile, node.name),
            labels: labels(node),
            properties: properties(node)
          }) AS nodes,
          [r IN rels WHERE r.rel IS NOT NULL | {
            id: r.rel.id,
            fromFilePath: coalesce(
              startNode(r.rel).path,
              startNode(r.rel).sourceFile,
              startNode(r.rel).name
            ),
            toFilePath: coalesce(
              endNode(r.rel).path,
              endNode(r.rel).sourceFile,
              endNode(r.rel).name
            ),
            type: type(r.rel),
            hopDistance: r.distance
          }] AS edges
        `,
        { repositoryId, seedPaths, maxHops: neo4j.int(maxHops) },
      );

      const nodes: NeighborhoodNode[] = [];
      const edges: NeighborhoodEdge[] = [];
      const clusters: Array<{ name: string; filePaths: string[] }> = [];

      if (result.records.length > 0) {
        const record = result.records[0];
        const rawNodes =
          (record.get('nodes') as Array<Record<string, unknown>>) || [];
        const rawEdges =
          (record.get('edges') as Array<Record<string, unknown>>) || [];

        for (const n of rawNodes) {
          const fp = n.filePath as string;
          if (fp) {
            nodes.push({
              id: n.id as string,
              filePath: fp,
              labels: n.labels as string[],
              properties: n.properties as Record<string, unknown>,
            });
          }
        }

        for (const e of rawEdges) {
          const fromFp = e.fromFilePath as string;
          const toFp = e.toFilePath as string;
          if (fromFp && toFp) {
            edges.push({
              id: e.id as string,
              fromFilePath: fromFp,
              toFilePath: toFp,
              type: e.type as string,
              hopDistance: (e.hopDistance as Integer).toNumber(),
            });
          }
        }
      }

      return { nodes, edges, clusters };
    } finally {
      await session.close();
    }
  }

  async saveNode(node: GraphNode): Promise<void> {
    const session = this.getSession();
    try {
      const label = node.labels[0] || 'Entity';
      await session.run(`MERGE (n:${label} {id: $id}) SET n += $properties`, {
        id: node.id,
        properties: node.properties,
      });
    } finally {
      await session.close();
    }
  }

  async saveRelationship(rel: GraphRelationship): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `
        MATCH (a {id: $startId}), (b {id: $endId})
        MERGE (a)-[r:${rel.type} {id: $id}]->(b)
        SET r += $properties
        `,
        {
          startId: rel.startNodeId,
          endId: rel.endNodeId,
          id: rel.id,
          properties: rel.properties,
        },
      );
    } finally {
      await session.close();
    }
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    const session = this.getSession();
    const tx = session.beginTransaction();

    try {
      // Clear previous graph for this repository
      await tx.run(`MATCH (n {repositoryId: $repositoryId}) DETACH DELETE n`, {
        repositoryId: graph.repositoryId,
      });

      // Batch insert nodes grouped by label
      const byLabel = new Map<string, GraphNode[]>();
      for (const node of graph.nodes) {
        const label = node.labels[0] || 'Entity';
        const list = byLabel.get(label) || [];
        list.push(node);
        byLabel.set(label, list);
      }

      for (const [label, nodes] of byLabel) {
        await tx.run(
          `
          UNWIND $nodes AS node
          MERGE (n:${label} {id: node.id})
          SET n += node.properties
          `,
          {
            nodes: nodes.map((n) => ({
              id: n.id,
              properties: n.properties,
            })),
          },
        );
      }

      // Batch insert relationships grouped by type
      const byType = new Map<string, GraphRelationship[]>();
      for (const rel of graph.relationships) {
        const list = byType.get(rel.type) || [];
        list.push(rel);
        byType.set(rel.type, list);
      }

      for (const [type, rels] of byType) {
        await tx.run(
          `
          UNWIND $rels AS rel
          MATCH (a {id: rel.startNodeId}), (b {id: rel.endNodeId})
          MERGE (a)-[r:${type} {id: rel.id}]->(b)
          SET r += rel.properties
          `,
          {
            rels: rels.map((r) => ({
              id: r.id,
              startNodeId: r.startNodeId,
              endNodeId: r.endNodeId,
              properties: r.properties,
            })),
          },
        );
      }

      await tx.commit();
      this.logger.log(
        `Saved knowledge graph for repository ${graph.repositoryId}: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`,
      );
    } catch (error) {
      await tx.rollback();
      this.logger.error(`Failed to save graph: ${(error as Error).message}`);
      throw error;
    } finally {
      await session.close();
    }
  }
}
