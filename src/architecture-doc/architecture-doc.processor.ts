import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import {
  ARCHITECTURE_DRAFT_QUEUE,
  ArchitectureDraftJobPayload,
} from './architecture-doc.constants';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { ArchitectureDocEmbedderService } from './architecture-doc-embedder.service';

const STATUS_ORDER: DocStatus[] = [
  DocStatus.PENDING,
  DocStatus.RETRIEVING,
  DocStatus.GENERATING,
  DocStatus.VERIFYING,
  DocStatus.COMPLETED,
  DocStatus.FAILED,
];

@Processor(ARCHITECTURE_DRAFT_QUEUE)
export class ArchitectureDocProcessor extends WorkerHost {
  private readonly logger = new Logger(ArchitectureDocProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    private readonly draftingOrchestrator: DraftingOrchestratorService,
    private readonly embedder: ArchitectureDocEmbedderService,
  ) {
    super();
  }

  async process(job: Job<ArchitectureDraftJobPayload>): Promise<void> {
    const { repositoryId, documentId } = job.data;
    this.logger.log(
      `Processing architecture draft job ${documentId} for repository ${repositoryId}`,
    );

    try {
      await this.updateStatus(repositoryId, documentId, DocStatus.RETRIEVING);

      this.logger.log(`[${documentId}] Calling drafting orchestrator...`);
      const draft = await this.draftingOrchestrator.draft(
        { repositoryId },
        async (status) => {
          this.logger.log(`[${documentId}] Progress: ${status}`);
          await this.updateStatusMonotonic(repositoryId, documentId, status);
        },
      );

      this.logger.log(
        `[${documentId}] Draft completed. Total sections: ${draft.sections.length}`,
      );
      draft.sections.forEach((s, i) => {
        this.logger.log(
          `[${documentId}] Section ${i}: key="${s.key}" verdict="${s.verdict}" contentLength=${s.contentMd.length}`,
        );
      });
      this.logger.log(
        `[${documentId}] Diagram: ${draft.diagram ? `present (${draft.diagram.mermaidSource.length} chars)` : 'null'}`,
      );

      const persistedSections = draft.sections.filter(
        (section) => section.verdict !== 'removed',
      );

      this.logger.log(
        `[${documentId}] Persisting ${persistedSections.length} sections (filtered from ${draft.sections.length} total)`,
      );

      let docVersion = 1;
      let docCommitSha: string | null = null;

      await this.prisma.$transaction(async (tx) => {
        if (persistedSections.length > 0) {
          const diagramMermaid = draft.diagram?.mermaidSource ?? null;

          await tx.docSection.createMany({
            data: persistedSections.map((section, index) => ({
              docId: documentId,
              key: section.key,
              title: section.title,
              order: index,
              contentMd: section.contentMd,
              sourceFiles: section.sourceFiles,
              diagramMermaid: index === 0 ? diagramMermaid : null,
              verified: section.verdict === 'verified',
              verificationNotes: section.verificationNotes,
            })),
          });
          this.logger.log(
            `[${documentId}] Persisted ${persistedSections.length} sections to database`,
          );
        } else {
          this.logger.warn(
            `[${documentId}] No sections to persist (all ${draft.sections.length} were removed)`,
          );
        }

        const verifiedCount = persistedSections.filter(
          (section) => section.verdict === 'verified',
        ).length;
        const verificationScore =
          persistedSections.length > 0
            ? verifiedCount / persistedSections.length
            : null;

        const updatedDoc = await tx.generatedDoc.update({
          where: { id: documentId },
          data: {
            status: DocStatus.COMPLETED,
            verificationScore,
            generatedAt: new Date(),
            errorMessage: null,
          },
        });
        docVersion = updatedDoc.version;
        docCommitSha = updatedDoc.commitSha;

        this.logger.log(
          `[${documentId}] Document marked COMPLETED. verificationScore=${verificationScore}`,
        );
      });

      // Embed document sections into ChromaDB
      if (persistedSections.length > 0) {
        try {
          this.logger.log(`[${documentId}] Initiating ChromaDB embedding for sections...`);
          await this.embedder.embedDocument({
            docId: documentId,
            version: docVersion,
            commitSha: docCommitSha,
            sections: persistedSections.map((s) => ({
              key: s.key,
              title: s.title,
              contentMd: s.contentMd,
              sourceFiles: s.sourceFiles,
            })),
          });
        } catch (embedError) {
          this.logger.warn(
            `[${documentId}] Embedding sections into ChromaDB encountered an error: ${(embedError as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `[${documentId}] Architecture draft job failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      await this.prisma.generatedDoc.update({
        where: { id: documentId },
        data: {
          status: DocStatus.FAILED,
          errorMessage: this.boundErrorMessage(error),
        },
      });
      this.publishProgress(
        repositoryId,
        documentId,
        DocStatus.FAILED,
        this.boundErrorMessage(error),
      );
    }
  }

  private async updateStatus(
    repositoryId: string,
    documentId: string,
    status: DocStatus,
  ): Promise<void> {
    await this.prisma.generatedDoc.update({
      where: { id: documentId },
      data: { status },
    });
    this.publishProgress(repositoryId, documentId, status, null);
  }

  private async updateStatusMonotonic(
    repositoryId: string,
    documentId: string,
    status: DocStatus,
  ): Promise<void> {
    const document = await this.prisma.generatedDoc.findUnique({
      where: { id: documentId },
      select: { status: true },
    });

    if (!document) {
      return;
    }

    const currentIndex = STATUS_ORDER.indexOf(document.status);
    const nextIndex = STATUS_ORDER.indexOf(status);

    if (nextIndex <= currentIndex) {
      return;
    }

    await this.updateStatus(repositoryId, documentId, status);
  }

  private publishProgress(
    repositoryId: string,
    documentId: string,
    status: DocStatus,
    errorMessage: string | null,
  ): void {
    this.progress.publishArchDoc(repositoryId, {
      jobId: documentId,
      docId: documentId,
      status,
      errorMessage,
    });
  }

  private boundErrorMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'Unknown drafting error';
    return message.slice(0, 500);
  }
}
