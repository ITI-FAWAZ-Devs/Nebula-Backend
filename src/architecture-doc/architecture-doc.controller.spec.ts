import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DocStatus } from '@prisma/client';
import { ArchitectureDocController } from './architecture-doc.controller';
import { ArchitectureDocService } from './architecture-doc.service';

describe('ArchitectureDocController', () => {
  let controller: ArchitectureDocController;

  const userId = 'user-1';
  const otherUserId = 'user-2';
  const repositoryId = '11111111-1111-1111-1111-111111111111';
  const jobId = '22222222-2222-2222-2222-222222222222';

  const mockService = {
    start: jest.fn(),
    getLatestCompleted: jest.fn(),
    getJob: jest.fn(),
    listVersions: jest.fn(),
    getVersion: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArchitectureDocController],
      providers: [{ provide: ArchitectureDocService, useValue: mockService }],
    }).compile();

    controller = module.get<ArchitectureDocController>(ArchitectureDocController);
    jest.clearAllMocks();
  });

  describe('POST /repositories/:repositoryId/architecture-doc', () => {
    it('should return 202 envelope with trigger data', async () => {
      const triggerData = {
        docId: jobId,
        jobId,
        version: 1,
        status: DocStatus.PENDING,
      };
      mockService.start.mockResolvedValue(triggerData);

      const result = await controller.trigger(userId, repositoryId, {});

      expect(mockService.start).toHaveBeenCalledWith(userId, repositoryId, {});
      expect(result).toEqual({
        success: true,
        message: 'Architecture document generation accepted',
        data: triggerData,
      });
    });

    it('should propagate service errors such as forbidden access', async () => {
      mockService.start.mockRejectedValue(new ForbiddenException());

      await expect(controller.trigger(otherUserId, repositoryId, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should propagate bad request for invalid commit', async () => {
      mockService.start.mockRejectedValue(new BadRequestException());

      await expect(
        controller.trigger(userId, repositoryId, { commitSha: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /repositories/:repositoryId/architecture-doc', () => {
    it('should return latest completed document in envelope', async () => {
      const document = {
        docId: jobId,
        version: 1,
        status: DocStatus.COMPLETED,
        commitSha: 'abc123',
        generatedAt: new Date('2026-07-26T10:00:00.000Z'),
        verificationScore: 1,
        sections: [],
      };
      mockService.getLatestCompleted.mockResolvedValue(document);

      const result = await controller.getLatestCompleted(userId, repositoryId);

      expect(result).toEqual({
        success: true,
        message: 'Latest completed architecture document retrieved successfully',
        data: document,
      });
    });

    it('should propagate not found when no completed document exists', async () => {
      mockService.getLatestCompleted.mockRejectedValue(new NotFoundException());

      await expect(
        controller.getLatestCompleted(userId, repositoryId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /repositories/:repositoryId/architecture-doc/jobs/:jobId', () => {
    it('should return job polling data for owner', async () => {
      const jobData = {
        jobId,
        docId: jobId,
        status: DocStatus.GENERATING,
        errorMessage: null,
      };
      mockService.getJob.mockResolvedValue(jobData);

      const result = await controller.getJob(userId, repositoryId, jobId);

      expect(mockService.getJob).toHaveBeenCalledWith(
        userId,
        repositoryId,
        jobId,
      );
      expect(result).toEqual({
        success: true,
        message: 'Architecture document job retrieved successfully',
        data: jobData,
      });
    });

    it('should deny non-owner job polling', async () => {
      mockService.getJob.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.getJob(otherUserId, repositoryId, jobId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /repositories/:repositoryId/architecture-doc/versions', () => {
    it('should return version history in envelope', async () => {
      const versions = [
        {
          docId: jobId,
          version: 2,
          status: DocStatus.COMPLETED,
          generatedAt: new Date(),
          verificationScore: 0.9,
        },
      ];
      mockService.listVersions.mockResolvedValue(versions);

      const result = await controller.listVersions(userId, repositoryId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(versions);
    });

    it('should deny non-owner history access', async () => {
      mockService.listVersions.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.listVersions(otherUserId, repositoryId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /repositories/:repositoryId/architecture-doc/versions/:version', () => {
    it('should return specific version in envelope', async () => {
      const document = {
        docId: jobId,
        version: 1,
        status: DocStatus.COMPLETED,
        commitSha: 'abc123',
        generatedAt: new Date(),
        verificationScore: 1,
        sections: [],
      };
      mockService.getVersion.mockResolvedValue(document);

      const result = await controller.getVersion(userId, repositoryId, 1);

      expect(mockService.getVersion).toHaveBeenCalledWith(
        userId,
        repositoryId,
        1,
      );
      expect(result.data).toEqual(document);
    });
  });

  describe('POST /repositories/:repositoryId/architecture-doc/regenerate', () => {
    it('should accept regeneration with same envelope as trigger', async () => {
      const triggerData = {
        docId: jobId,
        jobId,
        version: 2,
        status: DocStatus.PENDING,
      };
      mockService.start.mockResolvedValue(triggerData);

      const result = await controller.regenerate(userId, repositoryId, {});

      expect(mockService.start).toHaveBeenCalledWith(userId, repositoryId, {});
      expect(result).toEqual({
        success: true,
        message: 'Architecture document regeneration accepted',
        data: triggerData,
      });
    });
  });
});
