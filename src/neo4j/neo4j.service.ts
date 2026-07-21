import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
} from '../graph/interfaces/knowledge-graph.interface';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver: Driver | null = null;
  private readonly database: string;

  constructor(private readonly configService: ConfigService) {
    this.database =
      this.configService.get<string>('neo4j.database') || 'neo4j';
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

  async saveNode(node: GraphNode): Promise<void> {
    const session = this.getSession();
    try {
      const label = node.labels[0] || 'Entity';
      await session.run(
        `MERGE (n:${label} {id: $id}) SET n += $properties`,
        { id: node.id, properties: node.properties },
      );
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
      await tx.run(
        `MATCH (n {repositoryId: $repositoryId}) DETACH DELETE n`,
        { repositoryId: graph.repositoryId },
      );

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
      this.logger.error(
        `Failed to save graph: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      await session.close();
    }
  }
}
