import { AdminPaginationDto } from './admin-user-list-response.dto';
import { AdminRepositorySummaryDto } from './admin-repository-summary.dto';

export class AdminRepositoryListResponseDto {
  items: AdminRepositorySummaryDto[];
  pagination: AdminPaginationDto;
}
