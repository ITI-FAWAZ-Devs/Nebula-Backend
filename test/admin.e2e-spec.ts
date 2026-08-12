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
    },
    repository: { count: jest.fn().mockResolvedValue(0) },
    generatedDoc: { count: jest.fn().mockResolvedValue(0) },
    docSection: { count: jest.fn().mockResolvedValue(0) },
    usageLog: { count: jest.fn().mockResolvedValue(0) },
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

  const endpoints = ['/admin/users', '/admin/stats'];

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
});
