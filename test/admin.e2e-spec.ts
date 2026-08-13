import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AdminController } from '../src/admin/admin.controller';
import { AdminService } from '../src/admin/admin.service';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { PrismaService } from '../src/prisma/prisma.service';

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
    repository: { count: jest.fn().mockResolvedValue(0) },
    organization: { count: jest.fn().mockResolvedValue(0) },
    generatedDoc: { count: jest.fn().mockResolvedValue(0) },
    docSection: { count: jest.fn().mockResolvedValue(0) },
    usageLog: { count: jest.fn().mockResolvedValue(0) },
    documentationJob: { count: jest.fn().mockResolvedValue(0) },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prismaMock },
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

  const endpoints = ['/admin/users', '/admin/stats', '/admin/dashboard/stats'];

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
});
