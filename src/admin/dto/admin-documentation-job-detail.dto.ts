import { AdminDocumentationJobSummaryDto } from './admin-documentation-job-summary.dto';

export interface AdminDocumentationJobDetailDto extends AdminDocumentationJobSummaryDto {
  queueJobId: string | null;
  resumeCount: number;
}
