import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TierConfig,
  DEFAULT_SUBSCRIPTION_TIERS,
} from '../config/subscription.config';

export interface UserSubscriptionDetails {
  tier: SubscriptionTier;
  currentPeriodStart: Date;
  generationsUsedThisPeriod: number;
  totalGenerationsUsed: number;
  maxGenerationsPerMonth: number;
  remainingGenerations: number;
  config: TierConfig;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves the TierConfig for a given subscription tier.
   */
  getTierConfig(tier: SubscriptionTier): TierConfig {
    const configuredTiers =
      this.configService.get<Record<string, TierConfig>>(
        'subscription.tiers',
      ) || DEFAULT_SUBSCRIPTION_TIERS;

    const tierKey = tier.toString().toUpperCase();
    return configuredTiers[tierKey] || DEFAULT_SUBSCRIPTION_TIERS.FREE;
  }

  /**
   * Helper to check if the 30-day period has elapsed and reset period count if necessary.
   */
  private async checkAndResetPeriod(user: {
    id: string;
    subscriptionTier: SubscriptionTier;
    currentPeriodStart: Date;
    generationsUsedThisPeriod: number;
  }): Promise<{
    generationsUsedThisPeriod: number;
    currentPeriodStart: Date;
  }> {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const elapsed = now.getTime() - new Date(user.currentPeriodStart).getTime();

    if (elapsed >= thirtyDaysMs) {
      this.logger.log(
        `Monthly generation period elapsed for user ${user.id}. Resetting usage counter.`,
      );
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          generationsUsedThisPeriod: 0,
          currentPeriodStart: now,
        },
      });
      return {
        generationsUsedThisPeriod: updated.generationsUsedThisPeriod,
        currentPeriodStart: updated.currentPeriodStart,
      };
    }

    return {
      generationsUsedThisPeriod: user.generationsUsedThisPeriod,
      currentPeriodStart: user.currentPeriodStart,
    };
  }

  /**
   * Get subscription status and remaining quotas for a user.
   */
  async getUserSubscription(userId: string): Promise<UserSubscriptionDetails> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const { generationsUsedThisPeriod, currentPeriodStart } =
      await this.checkAndResetPeriod(user);

    const config = this.getTierConfig(user.subscriptionTier);
    const remainingGenerations = Math.max(
      0,
      config.maxGenerationsPerMonth - generationsUsedThisPeriod,
    );

    return {
      tier: user.subscriptionTier,
      currentPeriodStart,
      generationsUsedThisPeriod,
      totalGenerationsUsed: user.totalGenerationsUsed,
      maxGenerationsPerMonth: config.maxGenerationsPerMonth,
      remainingGenerations,
      config,
    };
  }

  /**
   * Get tier model configuration for a user.
   */
  async getTierModelConfig(userId: string): Promise<TierConfig> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) {
      return DEFAULT_SUBSCRIPTION_TIERS.FREE;
    }

    return this.getTierConfig(user.subscriptionTier);
  }

  /**
   * Check if user has available quota for a generation job.
   * If quota is available, increment usage and log execution atomically.
   * Throws 402 Payment Required if quota exceeded.
   */
  async checkAndIncrementQuota(
    userId: string,
    jobType: string,
    repositoryId?: string,
  ): Promise<TierConfig> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const { generationsUsedThisPeriod } = await this.checkAndResetPeriod(user);
    const config = this.getTierConfig(user.subscriptionTier);

    if (generationsUsedThisPeriod >= config.maxGenerationsPerMonth) {
      this.logger.warn(
        `User ${userId} (${user.subscriptionTier}) exceeded monthly generation quota (${generationsUsedThisPeriod}/${config.maxGenerationsPerMonth}).`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `Generation quota exceeded for plan ${user.subscriptionTier} (${config.maxGenerationsPerMonth} generations/month). Please upgrade your subscription.`,
          tier: user.subscriptionTier,
          maxGenerationsPerMonth: config.maxGenerationsPerMonth,
          usedThisPeriod: generationsUsedThisPeriod,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Atomically increment usage and record log
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          generationsUsedThisPeriod: { increment: 1 },
          totalGenerationsUsed: { increment: 1 },
        },
      }),
      this.prisma.usageLog.create({
        data: {
          userId,
          repositoryId: repositoryId || null,
          jobType,
          tierAtExecution: user.subscriptionTier,
          llmModel: config.llmModel,
          embeddingModel: config.embeddingModel,
        },
      }),
    ]);

    this.logger.log(
      `Recorded generation usage for user ${userId} (${user.subscriptionTier}) - Job: ${jobType}`,
    );

    return config;
  }

  /**
   * Update subscription tier for a user (Upgrade / Downgrade).
   */
  async updateSubscriptionTier(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<UserSubscriptionDetails> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: tier,
        generationsUsedThisPeriod: 0,
        currentPeriodStart: new Date(),
      },
    });

    this.logger.log(`Updated subscription tier for user ${userId} to ${tier}`);

    return this.getUserSubscription(userId);
  }
}
