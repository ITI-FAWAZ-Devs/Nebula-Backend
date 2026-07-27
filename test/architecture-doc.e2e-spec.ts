import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  CanActivate,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, DocStatus, RepositoryStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ArchitectureDocController } from '../src/architecture-doc/architecture-doc.controller';
import { ArchitectureDocService } from '../src/architecture-doc/architecture-doc.service';
import { ArchitectureDocProcessor } from '../src/architecture-doc/architecture-doc.processor';
import { DraftingOrchestratorService } from '../src/architecture-doc/drafting-orchestrator.service';
import { ARCHITECTURE_DRAFT_QUEUE } from '../src/architecture-doc/architecture-doc.constants';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

const TEST_PREFIX = `e2e-archdoc-${Date.now()}`;
const OWNER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();
const REPO_ID = randomUUID();
const REPO_GITHUB_ID = `${TEST_PREFIX}-github-id`;
const INDEXED_COMMIT = 'deadbeef';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const controlledDraft = {
  repositoryId: REPO_ID,
  repositoryName: `${TEST_PREFIX}-name`,
  sections: [
    {
      key: 'overview',
      title: 'System Overview',
      contentMd: '## Overview\nBootstraps in [src/main.ts].',
      sourceFiles: ['src/main.ts'],
      verdict: 'verified' as const,
      verificationNotes: null,
    },
    {
      key: 'removed',
      title: 'Removed Section',
      contentMd: '',
      sourceFiles: [],
      verdict: 'removed' as const,
      verificationNotes: 'No publishable content',
    },
  ],
  diagram: {
    mermaidSource: 'flowchart TD\n  A[main.ts] --> B[app.module.ts]',
    modules: ['Overview'],
    verdict: 'verified' as const,
    verificationNotes: null,
  },
  sectionPlan: [],
  sourceStatus: { semantic: 'available' as const, graph: 'available' as const },
  generatedAt: new Date(),
};

const failingDraft = jest
  .fn()
  .mockRejectedValue(new Error('Controlled drafting failure'));

describe('ArchitectureDoc (e2e)', () => {
  let app: INestApplication<App>;
  let processor: ArchitectureDocProcessor;
  let currentUserId = OWNER_ID;
  let queueAdd: jest.Mock;

  const shouldRun = () =>
    process.env.RUN_ARCHITECTURE_DOC_E2E === 'true' ||
    process.env.RUN_ARCHITECTURE_DOC_E2E === '1';

  const processJob = async (docId: string) => {
    await processor.process({
      data: { repositoryId: REPO_ID, documentId: docId, userId: OWNER_ID },
      id: docId,
    } as any);
  };

  beforeAll(async () => {
    if (!shouldRun()) {
      console.log(
        'Skipping architecture doc e2e tests. Set RUN_ARCHITECTURE_DOC_E2E=true to run.',
      );
      return;
    }

    await prisma.$connect();

    await prisma.user.createMany({
      data: [
        { id: OWNER_ID, email: `${OWNER_ID}@test.com` },
        { id: OTHER_USER_ID, email: `${OTHER_USER_ID}@test.com` },
      ],
    });

    await prisma.repository.create({
      data: {
        id: REPO_ID,
        githubRepoId: REPO_GITHUB_ID,
        userId: OWNER_ID,
        name: `${TEST_PREFIX}-name`,
        owner: 'e2e',
        defaultBranch: 'main',
        isPrivate: false,
        cloneUrl: `https://github.com/e2e/${TEST_PREFIX}.git`,
        status: RepositoryStatus.READY,
        lastIndexedCommit: INDEXED_COMMIT,
      },
    });

    queueAdd = jest.fn(async (_name, payload, options) => {
      return { id: options.jobId };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ArchitectureDocController],
      providers: [
        ArchitectureDocService,
        ArchitectureDocProcessor,
        DraftingOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'gemini.llmModel' ? 'gemini-2.5-flash' : undefined,
          },
        },
        {
          provide: getQueueToken(ARCHITECTURE_DRAFT_QUEUE),
          useValue: { add: queueAdd },
        },
        {
          provide: DraftingOrchestratorService,
          useValue: {
            draft: jest.fn(async (_request, onProgress) => {
              await onProgress?.('GENERATING');
              await onProgress?.('VERIFYING');
              return controlledDraft;
            }),
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: (context: ExecutionContext) => {
              const req = context.switchToHttp().getRequest();
              req.user = { id: currentUserId };
              return true;
            },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalGuards({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.user = { id: currentUserId };
        return true;
      },
    } as CanActivate);
    await app.init();

    processor = moduleFixture.get<ArchitectureDocProcessor>(
      ArchitectureDocProcessor,
    );
  }, 60000);

  afterAll(async () => {
    if (!shouldRun()) {
      return;
    }

    try {
      await prisma.repository.delete({ where: { id: REPO_ID } });
    } catch {
      // cascade
    }

    try {
      await prisma.user.deleteMany({
        where: { id: { in: [OWNER_ID, OTHER_USER_ID] } },
      });
    } catch {
      // ignore
    }

    await prisma.$disconnect();
    await app?.close();
  }, 60000);

  it('should trigger, process, and fetch latest completed document for owner', async () => {
    if (!shouldRun()) {
      return;
    }

    currentUserId = OWNER_ID;

    const triggerResponse = await request(app.getHttpServer())
      .post(`/repositories/${REPO_ID}/architecture-doc`)
      .send({ commitSha: INDEXED_COMMIT })
      .expect(202);

    expect(triggerResponse.body.success).toBe(true);
    expect(triggerResponse.body.data.docId).toBe(
      triggerResponse.body.data.jobId,
    );
    expect(triggerResponse.body.data.status).toBe(DocStatus.PENDING);

    const docId = triggerResponse.body.data.docId as string;

    await processJob(docId);

    const jobResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc/jobs/${docId}`)
      .expect(200);

    expect(jobResponse.body.data.status).toBe(DocStatus.COMPLETED);

    const latestResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc`)
      .expect(200);

    expect(latestResponse.body.data.status).toBe(DocStatus.COMPLETED);
    expect(latestResponse.body.data.sections).toHaveLength(1);
    expect(latestResponse.body.data.sections[0]).toMatchObject({
      key: 'overview',
      order: 0,
      sourceFiles: ['src/main.ts'],
      verified: true,
      diagramMermaid: controlledDraft.diagram.mermaidSource,
    });
  });

  it('should reuse active document on duplicate trigger', async () => {
    if (!shouldRun()) {
      return;
    }

    currentUserId = OWNER_ID;

    const first = await request(app.getHttpServer())
      .post(`/repositories/${REPO_ID}/architecture-doc/regenerate`)
      .send({})
      .expect(202);

    const second = await request(app.getHttpServer())
      .post(`/repositories/${REPO_ID}/architecture-doc/regenerate`)
      .send({})
      .expect(202);

    expect(second.body.data.docId).toBe(first.body.data.docId);
    expect(second.body.data.version).toBe(first.body.data.version);

    await processJob(first.body.data.docId as string);
  });

  it('should expose progress and terminal failure through polling', async () => {
    if (!shouldRun()) {
      return;
    }

    currentUserId = OWNER_ID;

    const draftingOrchestrator = app.get(DraftingOrchestratorService) as {
      draft: jest.Mock;
    };
    draftingOrchestrator.draft = failingDraft;

    const triggerResponse = await request(app.getHttpServer())
      .post(`/repositories/${REPO_ID}/architecture-doc/regenerate`)
      .send({})
      .expect(202);

    const docId = triggerResponse.body.data.docId as string;

    await processJob(docId);

    const jobResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc/jobs/${docId}`)
      .expect(200);

    expect(jobResponse.body.data.status).toBe(DocStatus.FAILED);
    expect(jobResponse.body.data.errorMessage).toContain(
      'Controlled drafting failure',
    );
  });

  it('should preserve version history after regeneration', async () => {
    if (!shouldRun()) {
      return;
    }

    currentUserId = OWNER_ID;

    const draftingOrchestrator = app.get(DraftingOrchestratorService) as {
      draft: jest.Mock;
    };
    draftingOrchestrator.draft = jest.fn(async (_request, onProgress) => {
      await onProgress?.('GENERATING');
      await onProgress?.('VERIFYING');
      return controlledDraft;
    });

    const historyResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc/versions`)
      .expect(200);

    expect(historyResponse.body.data.length).toBeGreaterThanOrEqual(1);

    const versionOne = historyResponse.body.data.find(
      (entry: { version: number }) => entry.version === 1,
    );
    expect(versionOne).toBeDefined();

    const versionOneResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc/versions/1`)
      .expect(200);

    expect(versionOneResponse.body.data.version).toBe(1);
    expect(versionOneResponse.body.data.status).toBe(DocStatus.COMPLETED);

    const latestResponse = await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc`)
      .expect(200);

    expect(latestResponse.body.data.version).toBeGreaterThanOrEqual(1);
  });

  it('should deny non-owner trigger, poll, fetch, and history requests', async () => {
    if (!shouldRun()) {
      return;
    }

    currentUserId = OTHER_USER_ID;

    await request(app.getHttpServer())
      .post(`/repositories/${REPO_ID}/architecture-doc`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/repositories/${REPO_ID}/architecture-doc/versions`)
      .expect(403);

    const completedDoc = await prisma.generatedDoc.findFirst({
      where: { repositoryId: REPO_ID, status: DocStatus.COMPLETED },
    });

    if (completedDoc) {
      await request(app.getHttpServer())
        .get(
          `/repositories/${REPO_ID}/architecture-doc/jobs/${completedDoc.id}`,
        )
        .expect(403);
    }
  });
});
