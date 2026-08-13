import { SubscriptionTier, UserRole } from '@prisma/client';

export class AdminUserSummaryDto {
  id: string;
  email: string;
  fullName: string | null;
  avatar: string | null;
  role: UserRole;
  isEmailVerified: boolean;
  subscriptionTier: SubscriptionTier;
  githubConnected: boolean;
  repositoriesCount: number;
  usageLogsCount: number;
  createdAt: Date;
  updatedAt: Date;
}
