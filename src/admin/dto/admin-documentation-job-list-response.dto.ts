import { AdminDocumentationJobSummaryDto } from './admin-documentation-job-summary.dto';

export class AdminDocumentationJobListResponseDto {
  items: AdminDocumentationJobSummaryDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
