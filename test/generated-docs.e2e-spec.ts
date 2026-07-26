import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const TEST_PREFIX = `e2e-gendocs-${Date.now()}`;
const REPO_ID = `${TEST_PREFIX}-repo`;
const REPO_GITHUB_ID = `${TEST_PREFIX}-github-id`;
let USER_ID: string;

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

beforeAll(async () => {
  const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
  if (envFlag !== 'true' && envFlag !== '1') {
    console.log(
      'Skipping generated docs integration test. Set RUN_GENERATED_DOCS_INTEGRATION=true to run.',
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
      githubRepoId: `${TEST_PREFIX}-github-id`,
      userId: user.id,
      name: `${TEST_PREFIX}-name`,
      owner: 'e2e',
      defaultBranch: 'main',
      isPrivate: false,
      cloneUrl: `https://github.com/e2e/${TEST_PREFIX}.git`,
    },
  });
});

afterAll(async () => {
  const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
  if (envFlag !== 'true' && envFlag !== '1') {
    return;
  }

  try {
    await prisma.repository.delete({ where: { id: REPO_ID } });
  } catch {
    // May cascade-delete everything
  }

  try {
    await prisma.user.delete({ where: { id: USER_ID } });
  } catch {
    // May have already been deleted
  }

  await prisma.$disconnect();
}, 30000);

describe('GeneratedDocs (e2e)', () => {
  it('should create GeneratedDoc and ordered DocSection rows', async () => {
    const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const doc = await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 1,
        status: 'PENDING',
        model: 'gemini-2.5-flash',
      },
    });

    expect(doc.id).toBeDefined();
    expect(doc.status).toBe('PENDING');

    const section1 = await prisma.docSection.create({
      data: {
        docId: doc.id,
        key: 'overview',
        title: 'Overview',
        order: 1,
        contentMd: '# Overview\nThis is the overview.',
        sourceFiles: ['src/main.ts'],
      },
    });

    const section2 = await prisma.docSection.create({
      data: {
        docId: doc.id,
        key: 'details',
        title: 'Details',
        order: 2,
        contentMd: '# Details\nDetailed content.',
        sourceFiles: ['src/auth.ts'],
      },
    });

    expect(section1.order).toBe(1);
    expect(section2.order).toBe(2);

    const sections = await prisma.docSection.findMany({
      where: { docId: doc.id },
      orderBy: { order: 'asc' },
    });

    expect(sections.length).toBe(2);
    expect(sections[0].key).toBe('overview');
    expect(sections[1].key).toBe('details');
  }, 15000);

  it('should reject duplicate (repositoryId, version)', async () => {
    const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 99,
        status: 'PENDING',
        model: 'gemini-2.5-flash',
      },
    });

    await expect(
      prisma.generatedDoc.create({
        data: {
          repositoryId: REPO_ID,
          version: 99,
          status: 'PENDING',
          model: 'gemini-2.5-flash',
        },
      }),
    ).rejects.toThrow();
  }, 15000);

  it('should reject duplicate (docId, key)', async () => {
    const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const doc = await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 100,
        status: 'PENDING',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.docSection.create({
      data: {
        docId: doc.id,
        key: 'dup-key',
        title: 'First',
        order: 1,
        contentMd: '# First',
        sourceFiles: [],
      },
    });

    await expect(
      prisma.docSection.create({
        data: {
          docId: doc.id,
          key: 'dup-key',
          title: 'Second',
          order: 2,
          contentMd: '# Second',
          sourceFiles: [],
        },
      }),
    ).rejects.toThrow();
  }, 15000);

  it('should retain version 1 after version 2 exists', async () => {
    const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const v1 = await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 200,
        status: 'COMPLETED',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 201,
        status: 'GENERATING',
        model: 'gemini-2.5-flash',
      },
    });

    const found = await prisma.generatedDoc.findUnique({
      where: { id: v1.id },
    });
    expect(found).not.toBeNull();
    expect(found!.version).toBe(200);
  }, 15000);

  it('should cascade delete sections when document is deleted', async () => {
    const envFlag = process.env.RUN_GENERATED_DOCS_INTEGRATION;
    if (envFlag !== 'true' && envFlag !== '1') {
      return;
    }

    const doc = await prisma.generatedDoc.create({
      data: {
        repositoryId: REPO_ID,
        version: 300,
        status: 'PENDING',
        model: 'gemini-2.5-flash',
      },
    });

    await prisma.docSection.create({
      data: {
        docId: doc.id,
        key: 'cascade-test',
        title: 'Cascade Test',
        order: 1,
        contentMd: '# Cascade',
        sourceFiles: [],
      },
    });

    await prisma.generatedDoc.delete({ where: { id: doc.id } });

    const sections = await prisma.docSection.findMany({
      where: { docId: doc.id },
    });
    expect(sections.length).toBe(0);
  }, 15000);
});
