import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SUBSCRIPTION_TIERS } from '../config/subscription.config';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    usageLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    subscriptionTier: SubscriptionTier.FREE,
    currentPeriodStart: new Date(),
    generationsUsedThisPeriod: 0,
    totalGenerationsUsed: 0,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      usageLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(DEFAULT_SUBSCRIPTION_TIERS),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserSubscription', () => {
    it('should return subscription details for FREE user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserSubscription('user-123');

      expect(result.tier).toBe(SubscriptionTier.FREE);
      expect(result.maxGenerationsPerMonth).toBe(200);
      expect(result.remainingGenerations).toBe(200);
      expect(result.generationsUsedThisPeriod).toBe(0);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserSubscription('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reset quota if 30 days have passed', async () => {
      const pastDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const expiredUser = {
        ...mockUser,
        currentPeriodStart: pastDate,
        generationsUsedThisPeriod: 3,
      };

      prisma.user.findUnique.mockResolvedValue(expiredUser);
      prisma.user.update.mockResolvedValue({
        ...expiredUser,
        generationsUsedThisPeriod: 0,
        currentPeriodStart: new Date(),
      });

      const result = await service.getUserSubscription('user-123');

      expect(prisma.user.update).toHaveBeenCalled();
      expect(result.generationsUsedThisPeriod).toBe(0);
      expect(result.remainingGenerations).toBe(200);
    });
  });

  describe('checkAndIncrementQuota', () => {
    it('should increment quota and log usage for available quota', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        generationsUsedThisPeriod: 1,
      });

      const config = await service.checkAndIncrementQuota(
        'user-123',
        'DOCUMENTATION_INDEXING',
        'repo-1',
      );

      expect(config.llmModel).toBe(DEFAULT_SUBSCRIPTION_TIERS.FREE.llmModel);
      expect(config.llmProvider).toBe(DEFAULT_SUBSCRIPTION_TIERS.FREE.llmProvider);
      expect(config.embeddingProvider).toBe(DEFAULT_SUBSCRIPTION_TIERS.FREE.embeddingProvider);
      expect(config.embeddingModel).toBe(DEFAULT_SUBSCRIPTION_TIERS.FREE.embeddingModel);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw 402 Payment Required when quota is reached', async () => {
      const maxedUser = {
        ...mockUser,
        generationsUsedThisPeriod: 200,
      };
      prisma.user.findUnique.mockResolvedValue(maxedUser);

      await expect(
        service.checkAndIncrementQuota('user-123', 'ARCH_DOC_DRAFT'),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('updateSubscriptionTier', () => {
    it('should update subscription tier to PRO', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({
          ...mockUser,
          subscriptionTier: SubscriptionTier.PRO,
          generationsUsedThisPeriod: 0,
        });
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        subscriptionTier: SubscriptionTier.PRO,
        generationsUsedThisPeriod: 0,
      });

      const result = await service.updateSubscriptionTier(
        'user-123',
        SubscriptionTier.PRO,
      );

      expect(result.tier).toBe(SubscriptionTier.PRO);
      expect(result.maxGenerationsPerMonth).toBe(200);
    });
  });
});
