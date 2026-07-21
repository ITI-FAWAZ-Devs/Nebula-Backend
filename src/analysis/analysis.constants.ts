export const ANALYSIS_QUEUE = 'analysis-queue';

export interface AnalysisJobPayload {
  repositoryId: string;
  analysisJobId: string;
  userId: string;
}
