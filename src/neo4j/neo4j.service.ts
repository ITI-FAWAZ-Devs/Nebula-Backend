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
import { EntityType } from '../graph/interfaces/entity.interface';
import { RelationshipType } from '../graph/interfaces/relationship.interface';

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

/**
 * Result shape for the frozen agent graph tools (Phase 0 contract).
 * Every graph tool returns this shape and maps 1:1 to a RetrievalHit later.
 */
export interface GraphToolNode {
  id: string;
  labels: string[];
  name: string;
  filePath: string | null;
  sourceLocation: string | null;
  properties: Record<string, unknown>;
}

const GRAPH_TOOL_MAX_HOPS = 2;
const GRAPH_TOOL_MAX_NODES_PER_HOP = 25;

/** Allowlisted node labels sourced from EntityType */
const VALID_LABELS = new Set<string>([
  'Repository',
  'Module',
  'Directory',
  'File',
  'Class',
  'Interface',
  'Method',
  'Function',
  'Enum',
  'TypeAlias',
  'Endpoint',
  'Service',
  'Component',
] satisfies EntityType[]);

/** Allowlisted relationship types sourced from RelationshipType */
const VALID_REL_TYPES = new Set<string>([
  'CONTAINS',
  'HAS_MODULE',
  'IMPORTS',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
  'DEPENDS_ON',
  'HAS_METHOD',
  'EXPORTS',
  'TYPE_REFERENCES',
  'INJECTS',
  'ROUTES_TO',
  'USES_HOOK',
] satisfies RelationshipType[]);

function toGraphToolNode(raw: Record<string, unknown>): GraphToolNode {
  return {
    id: raw.id as string,
    labels: (raw.labels as string[]) || [],
    name: (raw.name as string) || '',
    filePath: (raw.filePath as string) || null,
    sourceLocation: (raw.sourceLocation as string) || null,
    properties: (raw.properties as Record<string, unknown>) || {},
  };
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
      await this.ensureSchema();
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

  /**
   * Creates indexes/constraints idempotently.
   * Uses `IF NOT EXISTS` so repeated calls are safe.
   */
  private async ensureSchema(): Promise<void> {
    const session = this.getSession();
    try {
      // Composite uniqueness: (id, repositoryId) per label ensures cross-repo
      // MERGE safety — a node from repo A can never collide with repo B.
      for (const label of VALID_LABELS) {
        if (label === 'Repository') continue; // Repository nodes are global
        await session
          .run(
            `CREATE CONSTRAINT IF NOT EXISTS
             FOR (n:${label}) REQUIRE (n.id, n.repositoryId) IS NODE KEY`,
          )
          .catch((err) => {
            // NODE KEY requires Enterprise; fall back to a regular index on neo4j Community
            if ((err as Error).message?.includes('supported')) {
              return session.run(
                `CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.id, n.repositoryId)`,
              );
            }
            throw err;
          });

        // Separate index on repositoryId alone for fast wipe-and-replace
        await session
          .run(
            `CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n.repositoryId)`,
          )
          .catch(() => undefined);
      }

      // Repository label: index on id
      await session
        .run(`CREATE INDEX IF NOT EXISTS FOR (n:Repository) ON (n.id)`)
        .catch(() => undefined);

      this.logger.log('Neo4j schema ensured');
    } catch (error) {
      this.logger.warn(
        `Neo4j schema ensure encountered an issue: ${(error as Error).message}`,
      );
    } finally {
      await session.close();
    }
  }

  private getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver is not initialized');
    }
    return this.driver.session({ database: this.database });
  }

  // ── Label / type validation ──────────────────────────────────────────────────

  private validateLabel(label: string): string {
    if (!VALID_LABELS.has(label)) {
      this.logger.warn(
        `Unknown node label "${label}" — falling back to "Function"`,
      );
      return 'Function';
    }
    return label;
  }

  private validateRelType(type: string): string | null {
    if (!VALID_REL_TYPES.has(type)) {
      this.logger.warn(`Unknown relationship type "${type}" — skipping`);
      return null;
    }
    return type;
  }

  // ── getFileNeighborhood (fixed Cypher) ────────────────────────────────────

  async getFileNeighborhood(
    repositoryId: string,
    seedPaths: string[],
    maxHops: number,
  ): Promise<FileNeighborhoodResult> {
    const session = this.getSession();
    try {
      // Corrected: use `WHERE ... IN keys(start)` with a proper `any()` predicate
      const result = await session.run(
        `
        MATCH (start)
        WHERE start.repositoryId = $repositoryId
          AND any(key IN ['path', 'sourceFile', 'name']
              WHERE key IN keys(start) AND start[key] IN $seedPaths)
        OPTIONAL MATCH path = (start)-[r*1..$maxHops]-(neighbor)
        WHERE neighbor.repositoryId = $repositoryId
        WITH start,
             collect(DISTINCT neighbor) AS neighbors,
             collect(DISTINCT r) AS relPaths
        UNWIND (CASE WHEN size(neighbors) = 0 THEN [null] ELSE neighbors END) AS node
        WITH DISTINCT node, relPaths
        WHERE node IS NOT NULL
        RETURN
          collect(DISTINCT {
            id: node.id,
            filePath: coalesce(node.path, node.sourceFile, node.name),
            labels: labels(node),
            properties: properties(node)
          }) AS nodes,
          [chain IN relPaths
           WHERE chain IS NOT NULL AND size(chain) > 0
           | {
               id: chain[-1].id,
               fromFilePath: coalesce(
                 startNode(chain[-1]).path,
                 startNode(chain[-1]).sourceFile,
                 startNode(chain[-1]).name
               ),
               toFilePath: coalesce(
                 endNode(chain[-1]).path,
                 endNode(chain[-1]).sourceFile,
                 endNode(chain[-1]).name
               ),
               type: type(chain[-1]),
               hopDistance: size(chain)
             }
          ] AS edges
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
            const hopRaw = e.hopDistance;
            const hopDistance =
              hopRaw instanceof Integer
                ? hopRaw.toNumber()
                : typeof hopRaw === 'number'
                  ? hopRaw
                  : 1;
            edges.push({
              id: e.id as string,
              fromFilePath: fromFp,
              toFilePath: toFp,
              type: e.type as string,
              hopDistance,
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
      const label = this.validateLabel(node.labels[0] || 'Function');
      await session.run(
        `MERGE (n:${label} {id: $id, repositoryId: $repositoryId}) SET n += $properties`,
        {
          id: node.id,
          repositoryId: node.properties.repositoryId ?? '',
          properties: node.properties,
        },
      );
    } finally {
      await session.close();
    }
  }

  async saveRelationship(rel: GraphRelationship): Promise<void> {
    const validType = this.validateRelType(rel.type);
    if (!validType) return;

    const session = this.getSession();
    try {
      await session.run(
        `
        MATCH (a {id: $startId, repositoryId: $repositoryId}),
              (b {id: $endId, repositoryId: $repositoryId})
        MERGE (a)-[r:${validType} {id: $id}]->(b)
        SET r += $properties
        `,
        {
          startId: rel.startNodeId,
          endId: rel.endNodeId,
          id: rel.id,
          repositoryId: rel.properties.repositoryId ?? '',
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

      // Batch insert nodes grouped by label (validated)
      const byLabel = new Map<string, GraphNode[]>();
      for (const node of graph.nodes) {
        const label = this.validateLabel(node.labels[0] || 'Function');
        const list = byLabel.get(label) || [];
        list.push(node);
        byLabel.set(label, list);
      }

      for (const [label, nodes] of byLabel) {
        await tx.run(
          `
          UNWIND $nodes AS node
          MERGE (n:${label} {id: node.id, repositoryId: $repositoryId})
          SET n += node.properties
          `,
          {
            repositoryId: graph.repositoryId,
            nodes: nodes.map((n) => ({
              id: n.id,
              properties: n.properties,
            })),
          },
        );
      }

      // Batch insert relationships grouped by type (validated)
      const byType = new Map<string, GraphRelationship[]>();
      for (const rel of graph.relationships) {
        const validType = this.validateRelType(rel.type);
        if (!validType) continue;
        const list = byType.get(validType) || [];
        list.push(rel);
        byType.set(validType, list);
      }

      for (const [type, rels] of byType) {
        await tx.run(
          `
          UNWIND $rels AS rel
          MATCH (a {id: rel.startNodeId, repositoryId: $repositoryId}),
                (b {id: rel.endNodeId, repositoryId: $repositoryId})
          MERGE (a)-[r:${type} {id: rel.id}]->(b)
          SET r += rel.properties
          `,
          {
            repositoryId: graph.repositoryId,
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

  /**
   * Deletes every node (and relationship) belonging to a repository.
   * Reuses the same `repositoryId` scoping used by `saveGraph`'s wipe step so
   * cleanup is consistent with the delete-and-replace invariant.
   * Throws when the driver is not initialized or the query fails.
   */
  async deleteGraph(repositoryId: string): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `MATCH (n {repositoryId: $repositoryId}) DETACH DELETE n`,
        { repositoryId },
      );
      this.logger.log(`Deleted Neo4j graph for repository ${repositoryId}`);
    } finally {
      await session.close();
    }
  }

  // ---------------------------------------------------------------------
  // Frozen agent graph tools (Phase 0 contract). All Cypher is parameterized
  // and written here — never templated from LLM output.
  // ---------------------------------------------------------------------

  private readonly nodeProjection = `{
    id: n.id,
    labels: labels(n),
    name: n.name,
    filePath: coalesce(n.path, n.sourceFile, n.name),
    sourceLocation: n.sourceLocation,
    properties: properties(n)
  }`;

  private projectNode(varName: string): string {
    return `{
      id: ${varName}.id,
      labels: labels(${varName}),
      name: ${varName}.name,
      filePath: coalesce(${varName}.path, ${varName}.sourceFile, ${varName}.name),
      sourceLocation: ${varName}.sourceLocation,
      properties: properties(${varName})
    }`;
  }

  /**
   * getDefinition — resolves a single node by id, or by (name, type) when id is unknown.
   */
  async getDefinition(
    repositoryId: string,
    params: { nodeId?: string; name?: string; type?: string },
  ): Promise<GraphToolNode | null> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId})
        WHERE ($nodeId IS NOT NULL AND n.id = $nodeId)
           OR ($nodeId IS NULL AND $name IS NOT NULL AND n.name = $name
               AND ($type IS NULL OR $type IN labels(n)))
        RETURN ${this.nodeProjection} AS node
        LIMIT 1
        `,
        {
          repositoryId,
          nodeId: params.nodeId ?? null,
          name: params.name ?? null,
          type: params.type ?? null,
        },
      );
      if (result.records.length === 0) return null;
      return toGraphToolNode(result.records[0].get('node'));
    } finally {
      await session.close();
    }
  }

  /**
   * getCallers — nodes with a CALLS edge into the target (1 hop, capped).
   */
  async getCallers(
    repositoryId: string,
    nodeId: string,
  ): Promise<GraphToolNode[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (caller)-[:CALLS]->(target {repositoryId: $repositoryId, id: $nodeId})
        WHERE caller.repositoryId = $repositoryId
        RETURN DISTINCT ${this.projectNode('caller')} AS node
        LIMIT $limit
        `,
        {
          repositoryId,
          nodeId,
          limit: neo4j.int(GRAPH_TOOL_MAX_NODES_PER_HOP),
        },
      );
      return result.records.map((r) => toGraphToolNode(r.get('node')));
    } finally {
      await session.close();
    }
  }

  /**
   * getCallees — nodes the source has a CALLS edge to (1 hop, capped).
   */
  async getCallees(
    repositoryId: string,
    nodeId: string,
  ): Promise<GraphToolNode[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (source {repositoryId: $repositoryId, id: $nodeId})-[:CALLS]->(callee)
        WHERE callee.repositoryId = $repositoryId
        RETURN DISTINCT ${this.projectNode('callee')} AS node
        LIMIT $limit
        `,
        {
          repositoryId,
          nodeId,
          limit: neo4j.int(GRAPH_TOOL_MAX_NODES_PER_HOP),
        },
      );
      return result.records.map((r) => toGraphToolNode(r.get('node')));
    } finally {
      await session.close();
    }
  }

  /**
   * getImplementations — both directions of IMPLEMENTS/EXTENDS around the node,
   * up to 2 hops.
   */
  async getImplementations(
    repositoryId: string,
    nodeId: string,
  ): Promise<GraphToolNode[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId, id: $nodeId})
        MATCH path = (n)-[:IMPLEMENTS|EXTENDS*1..${GRAPH_TOOL_MAX_HOPS}]-(related)
        WHERE related.repositoryId = $repositoryId
        RETURN DISTINCT ${this.projectNode('related')} AS node
        LIMIT $limit
        `,
        {
          repositoryId,
          nodeId,
          limit: neo4j.int(GRAPH_TOOL_MAX_NODES_PER_HOP),
        },
      );
      return result.records.map((r) => toGraphToolNode(r.get('node')));
    } finally {
      await session.close();
    }
  }

  /**
   * getFileContext — a File node's direct children (CONTAINS / HAS_METHOD) plus
   * same-file symbols, 1 hop, capped at 40.
   */
  async getFileContext(
    repositoryId: string,
    filePath: string,
  ): Promise<GraphToolNode[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (f {repositoryId: $repositoryId})
        WHERE f.path = $filePath OR f.sourceFile = $filePath
        OPTIONAL MATCH (f)-[:CONTAINS|HAS_METHOD]->(child)
        WHERE child.repositoryId = $repositoryId
        WITH f, collect(DISTINCT child) AS children
        UNWIND (CASE WHEN children = [] THEN [f] ELSE children + [f] END) AS n
        RETURN DISTINCT ${this.nodeProjection} AS node
        LIMIT $limit
        `,
        { repositoryId, filePath, limit: neo4j.int(40) },
      );
      return result.records.map((r) => toGraphToolNode(r.get('node')));
    } finally {
      await session.close();
    }
  }

  /**
   * getModuleOverview — ego neighborhood of a Directory/File over
   * CONTAINS|IMPORTS|DEPENDS_ON, up to 2 hops, capped per hop.
   */
  async getModuleOverview(
    repositoryId: string,
    filePath: string,
  ): Promise<GraphToolNode[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (start {repositoryId: $repositoryId})
        WHERE start.path = $filePath OR start.sourceFile = $filePath OR start.name = $filePath
        MATCH (start)-[:CONTAINS|IMPORTS|DEPENDS_ON*1..${GRAPH_TOOL_MAX_HOPS}]-(n)
        WHERE n.repositoryId = $repositoryId
        RETURN DISTINCT ${this.nodeProjection} AS node
        LIMIT $limit
        `,
        {
          repositoryId,
          filePath,
          limit: neo4j.int(GRAPH_TOOL_MAX_NODES_PER_HOP * GRAPH_TOOL_MAX_HOPS),
        },
      );
      return result.records.map((r) => toGraphToolNode(r.get('node')));
    } finally {
      await session.close();
    }
  }

  /**
   * getCircularDependencies — detects circular IMPORTS/DEPENDS_ON chains in the repository graph.
   */
  async getCircularDependencies(
    repositoryId: string,
    maxDepth = 8,
  ): Promise<Array<{ cycle: string[]; cycleLength: number }>> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH path = (a:File {repositoryId: $repositoryId})-[:IMPORTS*2..${Math.min(maxDepth, 10)}]->(a)
        WITH [n IN nodes(path) | coalesce(n.path, n.sourceFile, n.name)] AS cyclePaths,
             length(path) AS len
        RETURN DISTINCT cyclePaths AS cycle, len AS cycleLength
        LIMIT 25
        `,
        { repositoryId },
      );

      return result.records.map((r) => {
        const rawLen = r.get('cycleLength');
        const cycleLength =
          rawLen instanceof Integer
            ? rawLen.toNumber()
            : typeof rawLen === 'number'
              ? rawLen
              : 0;
        return {
          cycle: (r.get('cycle') as string[]) || [],
          cycleLength,
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * getImpactAnalysis — blast radius analysis: finds all upstream files that transitively depend on the target file.
   */
  async getImpactAnalysis(
    repositoryId: string,
    filePath: string,
    maxDepth = 4,
  ): Promise<
    Array<{
      dependentFile: string;
      depth: number;
      relationshipTypes: string[];
    }>
  > {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (target:File {repositoryId: $repositoryId})
        WHERE target.path = $filePath OR target.sourceFile = $filePath OR target.name = $filePath
        MATCH path = (dependent:File {repositoryId: $repositoryId})-[:IMPORTS|CALLS|DEPENDS_ON*1..${Math.min(maxDepth, 6)}]->(target)
        WHERE dependent <> target
        WITH dependent,
             min(length(path)) AS minDepth,
             [rel IN relationships(path) | type(rel)] AS relTypes
        RETURN DISTINCT
          coalesce(dependent.path, dependent.sourceFile, dependent.name) AS dependentFile,
          minDepth AS depth,
          relTypes AS relationshipTypes
        ORDER BY depth ASC
        LIMIT 50
        `,
        { repositoryId, filePath },
      );

      return result.records.map((r) => {
        const rawDepth = r.get('depth');
        const depth =
          rawDepth instanceof Integer
            ? rawDepth.toNumber()
            : typeof rawDepth === 'number'
              ? rawDepth
              : 1;
        return {
          dependentFile: (r.get('dependentFile') as string) || '',
          depth,
          relationshipTypes: (r.get('relationshipTypes') as string[]) || [],
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * getGraphOverview — returns repository-wide graph statistics, top hub nodes, and distribution.
   */
  async getGraphOverview(repositoryId: string): Promise<{
    totalNodes: number;
    totalRelationships: number;
    labelsCount: Record<string, number>;
    topHubs: Array<{
      id: string;
      name: string;
      filePath: string | null;
      inDegree: number;
      outDegree: number;
    }>;
  }> {
    const session = this.getSession();
    try {
      const statsResult = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId})
        OPTIONAL MATCH (n)-[r {repositoryId: $repositoryId}]->()
        RETURN count(DISTINCT n) AS nodeCount, count(r) AS relCount
        `,
        { repositoryId },
      );

      const nodeCountRaw = statsResult.records[0]?.get('nodeCount');
      const relCountRaw = statsResult.records[0]?.get('relCount');
      const totalNodes =
        nodeCountRaw instanceof Integer
          ? nodeCountRaw.toNumber()
          : typeof nodeCountRaw === 'number'
            ? nodeCountRaw
            : 0;
      const totalRelationships =
        relCountRaw instanceof Integer
          ? relCountRaw.toNumber()
          : typeof relCountRaw === 'number'
            ? relCountRaw
            : 0;

      const hubsResult = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId})
        WHERE n:File OR n:Class OR n:Module
        OPTIONAL MATCH (inNode)-[inRel]->(n)
        WHERE inRel.repositoryId = $repositoryId
        OPTIONAL MATCH (n)-[outRel]->(outNode)
        WHERE outRel.repositoryId = $repositoryId
        WITH n, count(DISTINCT inRel) AS inDeg, count(DISTINCT outRel) AS outDeg
        ORDER BY inDeg DESC
        LIMIT 10
        RETURN
          n.id AS id,
          n.name AS name,
          coalesce(n.path, n.sourceFile, null) AS filePath,
          inDeg AS inDegree,
          outDeg AS outDegree
        `,
        { repositoryId },
      );

      const topHubs = hubsResult.records.map((r) => {
        const inDegRaw = r.get('inDegree');
        const outDegRaw = r.get('outDegree');
        return {
          id: (r.get('id') as string) || '',
          name: (r.get('name') as string) || '',
          filePath: (r.get('filePath') as string) || null,
          inDegree:
            inDegRaw instanceof Integer
              ? inDegRaw.toNumber()
              : typeof inDegRaw === 'number'
                ? inDegRaw
                : 0,
          outDegree:
            outDegRaw instanceof Integer
              ? outDegRaw.toNumber()
              : typeof outDegRaw === 'number'
                ? outDegRaw
                : 0,
        };
      });

      return {
        totalNodes,
        totalRelationships,
        labelsCount: {},
        topHubs,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * getArchitectureGraph — fetches nodes and edges for frontend interactive visualization.
   */
  async getArchitectureGraph(
    repositoryId: string,
    options?: {
      moduleId?: string;
      maxNodes?: number;
    },
  ): Promise<{
    nodes: Array<{
      id: string;
      name: string;
      labels: string[];
      filePath: string | null;
      properties: Record<string, unknown>;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      type: string;
      properties: Record<string, unknown>;
    }>;
  }> {
    const session = this.getSession();
    const limit = options?.maxNodes ?? 250;
    try {
      const result = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId})
        WHERE ($moduleId IS NULL OR n.path STARTS WITH $moduleId OR n.sourceFile STARTS WITH $moduleId)
        WITH n LIMIT $limit
        OPTIONAL MATCH (n)-[r]->(m {repositoryId: $repositoryId})
        RETURN
          collect(DISTINCT {
            id: n.id,
            name: n.name,
            labels: labels(n),
            filePath: coalesce(n.path, n.sourceFile, null),
            properties: properties(n)
          }) AS nodes,
          collect(DISTINCT CASE WHEN r IS NOT NULL THEN {
            id: coalesce(r.id, id(r)),
            source: startNode(r).id,
            target: endNode(r).id,
            type: type(r),
            properties: properties(r)
          } ELSE null END) AS edges
        `,
        {
          repositoryId,
          moduleId: options?.moduleId ?? null,
          limit: neo4j.int(limit),
        },
      );

      if (result.records.length === 0) {
        return { nodes: [], edges: [] };
      }

      const rec = result.records[0];
      const rawNodes = (rec.get('nodes') as Array<Record<string, unknown>>) || [];
      const rawEdges = (rec.get('edges') as Array<Record<string, unknown>>) || [];

      const nodes = rawNodes
        .filter((n) => n && n.id)
        .map((n) => ({
          id: n.id as string,
          name: (n.name as string) || (n.id as string),
          labels: (n.labels as string[]) || [],
          filePath: (n.filePath as string) || null,
          properties: (n.properties as Record<string, unknown>) || {},
        }));

      const edges = rawEdges
        .filter((e) => e && e.source && e.target)
        .map((e) => ({
          id: String(e.id),
          source: e.source as string,
          target: e.target as string,
          type: e.type as string,
          properties: (e.properties as Record<string, unknown>) || {},
        }));

      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  /**
   * getDeadCode — finds orphan/dead code nodes with 0 incoming references.
   */
  async getDeadCode(repositoryId: string): Promise<
    Array<{
      id: string;
      name: string;
      filePath: string | null;
      label: string;
    }>
  > {
    const session = this.getSession();
    try {
      const result = await session.run(
        `
        MATCH (n {repositoryId: $repositoryId})
        WHERE (n:Function OR n:Class OR n:Method)
          AND NOT (()-[:CALLS|IMPORTS|EXTENDS|IMPLEMENTS]->(n))
          AND NOT n.name CONTAINS 'test'
          AND NOT n.name CONTAINS 'spec'
        RETURN
          n.id AS id,
          n.name AS name,
          coalesce(n.path, n.sourceFile, null) AS filePath,
          head(labels(n)) AS label
        LIMIT 30
        `,
        { repositoryId },
      );

      return result.records.map((r) => ({
        id: (r.get('id') as string) || '',
        name: (r.get('name') as string) || '',
        filePath: (r.get('filePath') as string) || null,
        label: (r.get('label') as string) || 'Function',
      }));
    } finally {
      await session.close();
    }
  }
}
