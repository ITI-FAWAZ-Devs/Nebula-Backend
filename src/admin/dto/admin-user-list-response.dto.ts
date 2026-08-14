import { AdminUserSummaryDto } from './admin-user-summary.dto';

export class AdminPaginationDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class AdminUserListResponseDto {
  items: AdminUserSummaryDto[];
  pagination: AdminPaginationDto;
}
