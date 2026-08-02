import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AnalysisPipeline } from './analysis.pipeline';
import { ANALYSIS_QUEUE, AnalysisJobPayload } from './analysis.constants';

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(private readonly pipeline: AnalysisPipeline) {
    super();
  }

  async process(job: Job<AnalysisJobPayload>): Promise<void> {
    const { repositoryId, analysisJobId, userId } = job.data;
    this.logger.log(
      `Processing analysis job ${analysisJobId} for repository ${repositoryId}`,
    );

    await this.pipeline.execute(repositoryId, analysisJobId, userId);
  }
}
