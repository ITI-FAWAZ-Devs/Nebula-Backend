import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import {
  ARCHITECTURE_DRAFT_QUEUE,
  ArchitectureDraftJobPayload,
} from './architecture-doc.constants';
import { DraftingOrchestratorService } from './drafting-orchestrator.service';
import { ArchitectureDocEmbedderService } from './architecture-doc-embedder.service';
import { MailService } from '../mail/mail.service';
import { DraftSection, SectionPlan } from './dto/architecture-draft.dto';
import {
  fromPrismaJson,
  toPrismaJson,
  PipelineCheckpoint,
} from '../common/pipeline-checkpoint';

const STATUS_ORDER: DocStatus[] = [
  DocStatus.PENDING,
  DocStatus.RETRIEVING,
  DocStatus.GENERATING,
  DocStatus.VERIFYING,
  DocStatus.COMPLETED,
  DocStatus.FAILED,
];

interface DraftCheckpointArtifacts {
  sectionPlan?: SectionPlan[];
  sections?: DraftSection[];
}

@Processor(ARCHITECTURE_DRAFT_QUEUE)
export class ArchitectureDocProcessor extends WorkerHost {
  private readonly logger = new Logger(ArchitectureDocProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    private readonly draftingOrchestrator: DraftingOrchestratorService,
    private readonly embedder: ArchitectureDocEmbedderService,
    private readonly mailService: MailService,
  ) {
    super();
  }

  async process(job: Job<ArchitectureDraftJobPayload>): Promise<void> {
    const { repositoryId, documentId, userId } = job.data;
    this.logger.log(
      `Processing architecture draft job ${documentId} for repository ${repositoryId}`,
    );

    try {
      // Load checkpoint to resume if this is a retry
      const docRow = await this.prisma.generatedDoc.findUnique({
        where: { id: documentId },
        select: { checkpoint: true, status: true },
      });
      const checkpoint = fromPrismaJson(docRow?.checkpoint);
      const artifacts = checkpoint.artifacts as DraftCheckpointArtifacts;

      const resumedSections = artifacts.sections ?? [];
      const resumedPlan = artifacts.sectionPlan ?? [];

      if (resumedSections.length > 0) {
        this.logger.log(
          `[${documentId}] Resuming draft — ${resumedSections.length} sections already completed`,
        );
      }

      await this.updateStatusMonotonic(
        repositoryId,
        documentId,
        DocStatus.RETRIEVING,
      );

      this.logger.log(`[${documentId}] Calling drafting orchestrator...`);
      const draft = await this.draftingOrchestrator.draft(
        {
          repositoryId,
          documentId,
          userId,
          resumedSections:
            resumedSections.length > 0 ? resumedSections : undefined,
          resumedPlan: resumedPlan.length > 0 ? resumedPlan : undefined,
        },
        async (status) => {
          this.logger.log(`[${documentId}] Progress: ${status}`);
          await this.updateStatusMonotonic(repositoryId, documentId, status);
        },
        async (section: DraftSection, plan: SectionPlan[]) => {
          // Persist checkpoint after each section completes
          await this.saveCheckpoint(documentId, {
            completedStages: checkpoint.completedStages,
            artifacts: {
              sectionPlan: plan,
              sections: [
                ...(artifacts.sections ?? []).filter(
                  (s: DraftSection) => s.key !== section.key,
                ),
                section,
              ],
            },
          });
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
        // Delete any sections from prior (partial) runs to avoid duplicates
        await tx.docSection.deleteMany({ where: { docId: documentId } });

        if (persistedSections.length > 0) {
          await tx.docSection.createMany({
            data: persistedSections.map((section, index) => ({
              docId: documentId,
              key: section.key,
              title: section.title,
              order: index,
              contentMd: section.contentMd,
              sourceFiles: section.sourceFiles,
              diagramMermaid: section.diagramMermaid ?? null,
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
            checkpoint: Prisma.JsonNull, // clear checkpoint on success
          },
        });
        docVersion = updatedDoc.version;
        docCommitSha = updatedDoc.commitSha;

        this.logger.log(
          `[${documentId}] Document marked COMPLETED. verificationScore=${verificationScore}`,
        );
      });

      this.publishProgress(repositoryId, documentId, DocStatus.COMPLETED, null);

      // Embed document sections into ChromaDB
      if (persistedSections.length > 0) {
        try {
          this.logger.log(
            `[${documentId}] Initiating ChromaDB embedding for sections...`,
          );
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

      // ── Completion emails ─────────────────────────────────────────────────
      // Send to: triggering developer, repo owner (if different), org owner (if org repo)
      await this.sendCompletionEmails(
        repositoryId,
        userId,
        'Architecture Documentation',
      ).catch((err) =>
        this.logger.warn(
          `[${documentId}] Could not send completion email(s): ${(err as Error).message}`,
        ),
      );
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async saveCheckpoint(
    documentId: string,
    checkpoint: PipelineCheckpoint,
  ): Promise<void> {
    await this.prisma.generatedDoc.update({
      where: { id: documentId },
      data: { checkpoint: toPrismaJson(checkpoint) },
    });
  }

  private async sendCompletionEmails(
    repositoryId: string,
    triggeringUserId: string,
    pipeline: string,
  ): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        user: true,
        organization: { include: { owner: true } },
      },
    });
    if (!repository) return;

    const repositoryName = `${repository.owner}/${repository.name}`;

    // Collect unique recipients: triggering user, repo owner, org owner
    const recipientMap = new Map<string, { email: string; fullName: string | null }>();

    // 1. Triggering user (developer who started the job)
    const triggeringUser = await this.prisma.user.findUnique({
      where: { id: triggeringUserId },
      select: { email: true, fullName: true },
    });
    if (triggeringUser?.email) {
      recipientMap.set(triggeringUserId, triggeringUser);
    }

    // 2. Repo owner (userId on the repository record)
    if (repository.user?.email && !recipientMap.has(repository.userId)) {
      recipientMap.set(repository.userId, repository.user);
    }

    // 3. Org owner (if org-scoped)
    if (
      repository.organization?.owner?.email &&
      !recipientMap.has(repository.organization.ownerId)
    ) {
      recipientMap.set(
        repository.organization.ownerId,
        repository.organization.owner,
      );
    }

    // Send to all unique recipients
    await Promise.allSettled(
      [...recipientMap.values()].map((recipient) =>
        this.mailService
          .sendJobCompletedEmail({
            email: recipient.email,
            fullName: recipient.fullName ?? undefined,
            repositoryName,
            repositoryId,
            pipeline,
          })
          .catch((err) =>
            this.logger.warn(
              `Failed to send completion email to ${recipient.email}: ${(err as Error).message}`,
            ),
          ),
      ),
    );
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
