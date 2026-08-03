import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentationPipeline } from './documentation.pipeline';
import {
  DOCUMENTATION_QUEUE,
  DocumentationJobPayload,
} from './documentation.constants';

@Processor(DOCUMENTATION_QUEUE)
export class DocumentationProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentationProcessor.name);

  constructor(private readonly pipeline: DocumentationPipeline) {
    super();
  }

  async process(job: Job<DocumentationJobPayload>): Promise<void> {
    const { repositoryId, documentationJobId, userId } = job.data;
    this.logger.log(
      `Processing documentation job ${documentationJobId} for repository ${repositoryId}`,
    );

    await this.pipeline.execute(repositoryId, documentationJobId, userId);
  }
}
