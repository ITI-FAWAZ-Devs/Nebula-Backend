import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionService } from './subscription.service';

export interface ChangeSubscriptionDto {
  tier: SubscriptionTier;
}

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  async getMySubscription(@CurrentUser('userId') userId: string) {
    return this.subscriptionService.getUserSubscription(userId);
  }

  @Post('upgrade')
  async upgradeSubscription(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    if (!dto.tier || !Object.values(SubscriptionTier).includes(dto.tier)) {
      throw new BadRequestException(
        `Invalid subscription tier. Allowed values: ${Object.values(SubscriptionTier).join(', ')}`,
      );
    }
    return this.subscriptionService.updateSubscriptionTier(userId, dto.tier);
  }

  @Post('downgrade')
  async downgradeSubscription(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    if (!dto.tier || !Object.values(SubscriptionTier).includes(dto.tier)) {
      throw new BadRequestException(
        `Invalid subscription tier. Allowed values: ${Object.values(SubscriptionTier).join(', ')}`,
      );
    }
    return this.subscriptionService.updateSubscriptionTier(userId, dto.tier);
  }
}
