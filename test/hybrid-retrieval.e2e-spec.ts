import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
jest.setTimeout(60000);
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { HybridRetrieverService } from '../src/architecture-doc/hybrid-retriever.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import { ChromaService } from '../src/chroma/chroma.service';
import { Neo4jService } from '../src/neo4j/neo4j.service';

const TEST_PREFIX = `e2e-hybrid-${Date.now()}`;
const REPO_ID = `${TEST_PREFIX}-repo`;
const REPO_GITHUB_ID = `${TEST_PREFIX}-github-id`;
let USER_ID: string;

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter }) as unknown as PrismaService;

describe('HybridRetrieval (e2e)', () => {
  let app: INestApplication;
  let service: HybridRetrieverService;
  let chroma: ChromaService;
  let neo4j: Neo4jService;

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string | undefined> = {
          'chroma.host': process.env.CHROMA_HOST || 'api.trychroma.com',
          'chroma.apiKey': process.env.CHROMA_API_KEY,
          'chroma.tenant': process.env.CHROMA_TENANT || 'default_tenant',
          'chroma.database': process.env.CHROMA_DATABASE || 'default_database',
          'neo4j.uri': process.env.NEO4J_URI || 'bolt://localhost:7687',
          'neo4j.username': process.env.NEO4J_USERNAME || 'neo4j',
          'neo4j.password': process.env.NEO4J_PASSWORD || '',
          'neo4j.database': process.env.NEO4J_DATABASE || 'neo4j',
          'gemini.apiKey': process.env.GEMINI_API_KEY || '',
          'gemini.llmModel': process.env.GEMINI_LLM_MODEL || 'gemini-2.5-flash',
          'gemini.embeddingModel': process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
        };
        return config[key];
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        GeminiService,
        ChromaService,
        Neo4jService,
        HybridRetrieverService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    service = app.get<HybridRetrieverService>(HybridRetrieverService);
    chroma = app.get<ChromaService>(ChromaService);
    neo4j = app.get<Neo4jService>(Neo4jService);

    const envFlag = process.env.RUN_HYBRID_RETRIEVAL_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      console.log(
        'Skipping hybrid retrieval integration test. Set RUN_HYBRID_RETRIEVAL_INTEGRATION=true to run.',
      );
      return;
    }

    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX}@test.com`,
      },
    });
    USER_ID = user.id;

    await prisma.repository.create({
      data: {
        id: REPO_ID,
        githubRepoId: REPO_GITHUB_ID,
        userId: user.id,
        name: `${TEST_PREFIX}-name`,
        owner: 'e2e',
        defaultBranch: 'main',
        isPrivate: false,
        cloneUrl: `https://github.com/e2e/${TEST_PREFIX}.git`,
      },
    });

    const collection = await chroma.getOrCreateCollection(
      `repo-${REPO_ID}`,
    );
    await collection.add({
      ids: [`${TEST_PREFIX}-seed`],
      embeddings: [[0.1, 0.2, 0.3]],
      metadatas: [
        {
          filePath: 'src/auth/login.ts',
          description: 'Login handler',
          repositoryId: REPO_ID,
        },
      ],
    });

    await neo4j.saveGraph({
      repositoryId: REPO_ID,
      nodes: [
        {
          id: `${TEST_PREFIX}-login`,
          labels: ['File'],
          properties: {
            path: 'src/auth/login.ts',
            repositoryId: REPO_ID,
          },
        },
        {
          id: `${TEST_PREFIX}-session`,
          labels: ['File'],
          properties: {
            path: 'src/auth/session.ts',
            repositoryId: REPO_ID,
          },
        },
      ],
      relationships: [
        {
          id: `${TEST_PREFIX}-imports`,
          type: 'IMPORTS',
          startNodeId: `${TEST_PREFIX}-login`,
          endNodeId: `${TEST_PREFIX}-session`,
          properties: {},
        },
      ],
    });
  });

  afterAll(async () => {
    const envFlag = process.env.RUN_HYBRID_RETRIEVAL_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    try {
      await chroma.deleteCollection(`repo-${REPO_ID}`);
    } catch {
      // Collection may not exist
    }

    try {
      const driver = (neo4j as any).driver;
      if (driver) {
        const session = driver.session();
        await session.run(
          `MATCH (n {repositoryId: $repositoryId}) DETACH DELETE n`,
          { repositoryId: REPO_ID },
        );
        await session.close();
      }
    } catch {
      // Graph nodes may not exist
    }

    try {
      await prisma.repository.delete({ where: { id: REPO_ID } });
    } catch {
      // Repository may already be deleted
    }

    try {
      await prisma.user.delete({ where: { id: USER_ID } });
    } catch {
      // May have already been deleted
    }

    await app.close();
    await prisma.$disconnect();
  });

  it('should return the direct graph neighbor with an edge', async () => {
    const envFlag = process.env.RUN_HYBRID_RETRIEVAL_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const result = await service.retrieve(REPO_ID, {
      topic: 'login',
    });

    expect(result.files.some((f) => f.filePath === 'src/auth/login.ts')).toBe(
      true,
    );
    expect(result.files.some((f) => f.filePath === 'src/auth/session.ts')).toBe(
      true,
    );
    expect(result.relationships.length).toBeGreaterThanOrEqual(1);
    expect(result.repositoryId).toBe(REPO_ID);
  });

  it('should return unique files and edges scoped to the repository', async () => {
    const envFlag = process.env.RUN_HYBRID_RETRIEVAL_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const result = await service.retrieve(REPO_ID, {
      topic: 'login',
    });

    const filePaths = result.files.map((f) => f.filePath);
    expect(new Set(filePaths).size).toBe(filePaths.length);

    const edgeKeys = result.relationships.map(
      (e) => `${e.edgeId}-${e.fromFilePath}-${e.toFilePath}`,
    );
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);

    for (const file of result.files) {
      expect(file.filePath).not.toContain('\\');
    }

    expect(result.repositoryId).toBe(REPO_ID);
  });

  it('should complete 19 of 20 sequential calls in under 3 seconds', async () => {
    const envFlag = process.env.RUN_HYBRID_RETRIEVAL_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const attempts = 20;
    let fastCount = 0;

    for (let i = 0; i < attempts; i++) {
      const start = Date.now();
      await service.retrieve(REPO_ID, {
        topic: 'login',
      });
      const elapsed = Date.now() - start;
      if (elapsed < 3000) {
        fastCount++;
      }
    }

    expect(fastCount).toBeGreaterThanOrEqual(19);
  });
});
