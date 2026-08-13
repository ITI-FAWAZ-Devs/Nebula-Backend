import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { DocStatus, UserRole } from '@prisma/client';
import { AdminController } from '../src/admin/admin.controller';
import { AdminService } from '../src/admin/admin.service';
import { AdminRepositoriesService } from '../src/admin/admin-repositories.service';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChromaService } from '../src/chroma/chroma.service';
import { GitService } from '../src/git/git.service';
import { Neo4jService } from '../src/neo4j/neo4j.service';
import { ArchitectureDocService } from '../src/architecture-doc/architecture-doc.service';

describe('Admin authorization (e2e)', () => {
  let app: INestApplication;

  // The real JwtAuthGuard needs a database; stub it to attach the "logged in"
  // user directly, exactly like JwtStrategy does after token validation.
  let currentUser: { id: string; role: UserRole } | null = null;

  class MockJwtAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      req.user = currentUser;
      return true;
    }
  }

  const prismaMock = {
    $transaction: jest.fn((arg) => Promise.all(arg)),
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    repository: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    },
    usageLog: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    organization: { count: jest.fn().mockResolvedValue(0) },
    generatedDoc: { count: jest.fn().mockResolvedValue(0) },
    docSection: { count: jest.fn().mockResolvedValue(0) },
    documentationJob: { count: jest.fn().mockResolvedValue(0) },
    analysisJob: { count: jest.fn().mockResolvedValue(0) },
  };

  const chromaMock = {
    deleteCollectionsByPrefix: jest.fn().mockResolvedValue(undefined),
  };
  const gitMock = { delete: jest.fn().mockResolvedValue(undefined) };
  const neo4jMock = { deleteGraph: jest.fn().mockResolvedValue(undefined) };
  const archDocMock = { regenerateForAdmin: jest.fn() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        AdminRepositoriesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChromaService, useValue: chromaMock },
        { provide: GitService, useValue: gitMock },
        { provide: Neo4jService, useValue: neo4jMock },
        { provide: ArchitectureDocService, useValue: archDocMock },
        { provide: APP_GUARD, useClass: MockJwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const endpoints = [
    '/admin/users',
    '/admin/repositories',
    '/admin/stats',
    '/admin/dashboard/stats',
  ];

  describe('Admin user', () => {
    it.each(endpoints)('should access %s (200)', async (endpoint) => {
      currentUser = { id: 'admin-1', role: UserRole.ADMIN };

      await request(app.getHttpServer())
        .get(endpoint)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
        });
    });
  });

  describe('Normal user', () => {
    it.each(endpoints)('should be denied on %s (403)', async (endpoint) => {
      currentUser = { id: 'user-1', role: UserRole.USER };

      await request(app.getHttpServer()).get(endpoint).expect(403);
    });
  });

  describe('Unauthenticated user', () => {
    it.each(endpoints)('should be denied on %s (401)', async (endpoint) => {
      currentUser = null;

      await request(app.getHttpServer()).get(endpoint).expect(401);
    });
  });

  describe('User management endpoints', () => {
    const USER_ID = '11111111-1111-4111-8111-111111111111';
    const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
    const OTHER_ADMIN_ID = '33333333-3333-4333-8333-333333333333';

    const userDetailRow = {
      id: USER_ID,
      email: 'user@example.com',
      fullName: 'User One',
      avatar: null,
      role: UserRole.USER,
      isEmailVerified: true,
      subscriptionTier: 'FREE',
      currentPeriodStart: new Date('2024-01-01'),
      currentPeriodEnd: null,
      totalGenerationsUsed: 0,
      generationsUsedThisPeriod: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      githubToken: null,
      accounts: [],
      usageLogs: [],
      _count: {
        repositories: 0,
        usageLogs: 0,
        memberships: 0,
        ownedOrganizations: 0,
        accounts: 0,
      },
    };

    beforeEach(() => {
      prismaMock.user.findUnique.mockReset();
      prismaMock.user.delete.mockReset();
      prismaMock.repository.count.mockReset();
      prismaMock.organization.count.mockReset();
      prismaMock.repository.count.mockResolvedValue(0);
      prismaMock.organization.count.mockResolvedValue(0);
    });

    it('GET /admin/users/:id returns user detail (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.user.findUnique.mockResolvedValue(userDetailRow);

      const res = await request(app.getHttpServer())
        .get(`/admin/users/${USER_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(USER_ID);
      expect(res.body.data.password).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();
    });

    it('GET /admin/users/:id returns 404 for unknown user', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.user.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/admin/users/${OTHER_ADMIN_ID}`)
        .expect(404);
    });

    it('GET /admin/users/:id is denied for normal users (403)', async () => {
      currentUser = { id: USER_ID, role: UserRole.USER };

      await request(app.getHttpServer())
        .get(`/admin/users/${USER_ID}`)
        .expect(403);
    });

    it('DELETE /admin/users/:id deletes a user with no owned data (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.user.findUnique.mockResolvedValue({
        id: USER_ID,
        role: UserRole.USER,
      });
      prismaMock.user.delete.mockResolvedValue({ id: USER_ID });

      const res = await request(app.getHttpServer())
        .delete(`/admin/users/${USER_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: USER_ID },
      });
    });

    it('DELETE /admin/users/:id is blocked when the user owns repositories (409)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.user.findUnique.mockResolvedValue({
        id: USER_ID,
        role: UserRole.USER,
      });
      prismaMock.repository.count.mockResolvedValue(2);

      await request(app.getHttpServer())
        .delete(`/admin/users/${USER_ID}`)
        .expect(409);
    });

    it('DELETE /admin/users/:id is blocked for self-deletion (409)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.user.findUnique.mockResolvedValue({
        id: ADMIN_ID,
        role: UserRole.ADMIN,
      });

      await request(app.getHttpServer())
        .delete(`/admin/users/${ADMIN_ID}`)
        .expect(409);
    });

    it('DELETE /admin/users/:id is denied for normal users (403)', async () => {
      currentUser = { id: USER_ID, role: UserRole.USER };

      await request(app.getHttpServer())
        .delete(`/admin/users/${USER_ID}`)
        .expect(403);
    });
  });

  describe('Repository management endpoints', () => {
    const REPO_ID = '99999999-9999-4999-8999-999999999999';
    const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
    const USER_ID = '11111111-1111-4111-8111-111111111111';

    const repoRow = {
      id: REPO_ID,
      githubRepoId: 'github-1',
      name: 'nebula',
      owner: 'ayman',
      defaultBranch: 'main',
      isPrivate: false,
      cloneUrl: 'https://github.com/ayman/nebula.git',
      localPath: '/tmp/nebula',
      status: 'READY',
      lastIndexedCommit: 'abc123',
      lastDocumentedAt: new Date('2024-02-01'),
      documentedCommit: 'abc123',
      userId: USER_ID,
      organizationId: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
      user: {
        id: USER_ID,
        email: 'user@example.com',
        fullName: 'User One',
        avatar: null,
      },
      organization: null,
      generatedDocs: [
        {
          id: 'doc-1',
          version: 1,
          status: DocStatus.COMPLETED,
          generatedAt: new Date('2024-02-02'),
        },
      ],
    };

    beforeEach(() => {
      prismaMock.repository.findMany.mockReset();
      prismaMock.repository.findUnique.mockReset();
      prismaMock.repository.delete.mockReset();
      prismaMock.documentationJob.count.mockReset();
      prismaMock.analysisJob.count.mockReset();
      prismaMock.generatedDoc.count.mockReset();
      prismaMock.repository.findMany.mockResolvedValue([]);
      prismaMock.repository.delete.mockResolvedValue({ id: REPO_ID });
      prismaMock.documentationJob.count.mockResolvedValue(0);
      prismaMock.analysisJob.count.mockResolvedValue(0);
      prismaMock.generatedDoc.count.mockResolvedValue(0);
      prismaMock.usageLog.groupBy.mockReset();
      prismaMock.usageLog.groupBy.mockResolvedValue([]);
      archDocMock.regenerateForAdmin.mockReset();
    });

    it('GET /admin/repositories lists repositories for admins (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.repository.findMany.mockResolvedValue([repoRow]);
      prismaMock.repository.count.mockResolvedValue(1);

      const res = await request(app.getHttpServer())
        .get('/admin/repositories')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items[0].id).toBe(REPO_ID);
      expect(res.body.data.items[0].githubUrl).toBe(
        'https://github.com/ayman/nebula',
      );
      expect(res.body.data.items[0].documentationStatus).toBe(
        DocStatus.COMPLETED,
      );
      expect(res.body.data.pagination.total).toBe(1);
      expect(res.body.data.items[0].cloneUrl).toBeUndefined();
      expect(res.body.data.items[0].localPath).toBeUndefined();
    });

    it('GET /admin/repositories/:id returns repository detail (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.repository.findUnique.mockResolvedValue({
        ...repoRow,
        documentationJobs: [],
        generatedDocs: [
          {
            id: 'doc-1',
            version: 1,
            status: DocStatus.COMPLETED,
            commitSha: 'abc123',
            generatedAt: new Date('2024-02-02'),
            verificationScore: 0.8,
            triggeredByUserId: USER_ID,
            createdAt: new Date('2024-02-02'),
          },
        ],
        _count: { documentationJobs: 0, analysisJobs: 0 },
      });

      const res = await request(app.getHttpServer())
        .get(`/admin/repositories/${REPO_ID}`)
        .expect(200);

      expect(res.body.data.id).toBe(REPO_ID);
      expect(res.body.data.latestGeneratedDoc.version).toBe(1);
      expect(res.body.data.documentationStatus).toBe(DocStatus.COMPLETED);
      expect(res.body.data.githubRepoId).toBe('github-1');
      expect(res.body.data.password).toBeUndefined();
    });

    it('GET /admin/repositories/:id returns 404 for unknown repository', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.repository.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/admin/repositories/${REPO_ID}`)
        .expect(404);
    });

    it('DELETE /admin/repositories/:id deletes a repository (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.repository.findUnique.mockResolvedValue(repoRow);

      const res = await request(app.getHttpServer())
        .delete(`/admin/repositories/${REPO_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(prismaMock.repository.delete).toHaveBeenCalledWith({
        where: { id: REPO_ID },
      });
      expect(chromaMock.deleteCollectionsByPrefix).toHaveBeenCalledWith(
        `repo-${REPO_ID}`,
      );
      expect(neo4jMock.deleteGraph).toHaveBeenCalledWith(REPO_ID);
    });

    it('DELETE /admin/repositories/:id is blocked while jobs are in flight (409)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      prismaMock.repository.findUnique.mockResolvedValue(repoRow);
      prismaMock.generatedDoc.count.mockResolvedValue(1);

      await request(app.getHttpServer())
        .delete(`/admin/repositories/${REPO_ID}`)
        .expect(409);
      expect(prismaMock.repository.delete).not.toHaveBeenCalled();
    });

    it('POST /admin/repositories/:id/documentation/regenerate triggers regeneration (200)', async () => {
      currentUser = { id: ADMIN_ID, role: UserRole.ADMIN };
      archDocMock.regenerateForAdmin.mockResolvedValue({
        needsRegeneration: true,
        docId: 'doc-1',
        jobId: 'doc-1',
        version: 2,
        status: DocStatus.PENDING,
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/repositories/${REPO_ID}/documentation/regenerate`)
        .expect(200);

      expect(res.body.data.needsRegeneration).toBe(true);
      expect(archDocMock.regenerateForAdmin).toHaveBeenCalledWith(REPO_ID);
    });

    it('repository endpoints are denied for normal users (403)', async () => {
      currentUser = { id: USER_ID, role: UserRole.USER };

      await request(app.getHttpServer())
        .get('/admin/repositories')
        .expect(403);
      await request(app.getHttpServer())
        .get(`/admin/repositories/${REPO_ID}`)
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/admin/repositories/${REPO_ID}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/admin/repositories/${REPO_ID}/documentation/regenerate`)
        .expect(403);
    });

    it('repository endpoints are denied when unauthenticated (401)', async () => {
      currentUser = null;

      await request(app.getHttpServer())
        .get('/admin/repositories')
        .expect(401);
      await request(app.getHttpServer())
        .delete(`/admin/repositories/${REPO_ID}`)
        .expect(401);
    });
  });
});
