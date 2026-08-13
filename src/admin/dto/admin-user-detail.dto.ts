import { AdminUserSummaryDto } from './admin-user-summary.dto';

export class AdminAccountSummaryDto {
  provider: string;
  providerUsername: string | null;
  providerAvatar: string | null;
  createdAt: Date;
}

export class AdminUserDetailDto extends AdminUserSummaryDto {
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  totalGenerationsUsed: number;
  generationsUsedThisPeriod: number;
  organizationsCount: number;
  ownedOrganizationsCount: number;
  lastUsageAt: Date | null;
  accounts: AdminAccountSummaryDto[];
}
