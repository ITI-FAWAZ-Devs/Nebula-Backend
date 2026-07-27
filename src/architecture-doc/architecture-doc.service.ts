import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DocStatus, RepositoryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ARCHITECTURE_DRAFT_QUEUE,
  ArchitectureDraftJobPayload,
} from './architecture-doc.constants';
import {
  CreateArchitectureDocDto,
  ArchitectureDocTriggerResponse,
  ArchitectureDocJobResponse,
  ArchitectureDocResponse,
  ArchitectureDocVersionSummary,
  ArchitectureDocSectionResponse,
} from './dto/architecture-doc.dto';

const ACTIVE_STATUSES: DocStatus[] = [
  DocStatus.PENDING,
  DocStatus.RETRIEVING,
  DocStatus.GENERATING,
  DocStatus.VERIFYING,
];

@Injectable()
export class ArchitectureDocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue(ARCHITECTURE_DRAFT_QUEUE)
    private readonly architectureDraftQueue: Queue,
  ) {}

  async start(
    userId: string,
    repositoryId: string,
    dto: CreateArchitectureDocDto = {},
  ): Promise<ArchitectureDocTriggerResponse> {
    const repository = await this.findOwnedRepository(userId, repositoryId);
    this.assertRepositoryReady(repository);
    this.assertValidCommit(repository, dto.commitSha);

    const commitSha = dto.commitSha ?? repository.lastIndexedCommit ?? undefined;
    const model =
      this.configService.get<string>('gemini.llmModel') || 'gemini-2.5-flash';

    const activeDoc = await this.prisma.generatedDoc.findFirst({
      where: {
        repositoryId,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { version: 'desc' },
    });

    if (activeDoc) {
      return this.toTriggerResponse(activeDoc);
    }

    let created = false;
    const document = await this.prisma.$transaction(async (tx) => {
      const activeInTx = await tx.generatedDoc.findFirst({
        where: {
          repositoryId,
          status: { in: ACTIVE_STATUSES },
        },
        orderBy: { version: 'desc' },
      });

      if (activeInTx) {
        return activeInTx;
      }

      const latest = await tx.generatedDoc.findFirst({
        where: { repositoryId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      created = true;
      return tx.generatedDoc.create({
        data: {
          repositoryId,
          version: (latest?.version ?? 0) + 1,
          status: DocStatus.PENDING,
          commitSha: commitSha ?? null,
          triggeredByUserId: userId,
          model,
        },
      });
    });

    if (!created) {
      return this.toTriggerResponse(document);
    }

    const payload: ArchitectureDraftJobPayload = {
      repositoryId,
      documentId: document.id,
      userId,
    };

    try {
      await this.architectureDraftQueue.add('draft', payload, {
        jobId: document.id,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
    } catch (error) {
      await this.prisma.generatedDoc.update({
        where: { id: document.id },
        data: {
          status: DocStatus.FAILED,
          errorMessage: this.boundErrorMessage(error),
        },
      });
      throw error;
    }

    return this.toTriggerResponse(document);
  }

  async getLatestCompleted(
    userId: string,
    repositoryId: string,
  ): Promise<ArchitectureDocResponse> {
    await this.findOwnedRepository(userId, repositoryId);

    const document = await this.prisma.generatedDoc.findFirst({
      where: {
        repositoryId,
        status: DocStatus.COMPLETED,
      },
      orderBy: { version: 'desc' },
      include: {
        sections: { orderBy: { order: 'asc' } },
      },
    });

    if (!document) {
      throw new NotFoundException('No completed architecture document found');
    }

    return this.toDocumentResponse(document);
  }

  async getJob(
    userId: string,
    repositoryId: string,
    jobId: string,
  ): Promise<ArchitectureDocJobResponse> {
    await this.findOwnedRepository(userId, repositoryId);

    const document = await this.prisma.generatedDoc.findFirst({
      where: { id: jobId, repositoryId },
    });

    if (!document) {
      throw new NotFoundException('Architecture document job not found');
    }

    return {
      jobId: document.id,
      docId: document.id,
      status: document.status,
      errorMessage: document.errorMessage,
    };
  }

  async listVersions(
    userId: string,
    repositoryId: string,
  ): Promise<ArchitectureDocVersionSummary[]> {
    await this.findOwnedRepository(userId, repositoryId);

    const documents = await this.prisma.generatedDoc.findMany({
      where: { repositoryId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        generatedAt: true,
        verificationScore: true,
      },
    });

    return documents.map((doc) => ({
      docId: doc.id,
      version: doc.version,
      status: doc.status,
      generatedAt: doc.generatedAt,
      verificationScore: doc.verificationScore,
    }));
  }

  async getVersion(
    userId: string,
    repositoryId: string,
    version: number,
  ): Promise<ArchitectureDocResponse> {
    await this.findOwnedRepository(userId, repositoryId);

    const document = await this.prisma.generatedDoc.findFirst({
      where: { repositoryId, version },
      include: {
        sections: { orderBy: { order: 'asc' } },
      },
    });

    if (!document) {
      throw new NotFoundException(
        `Architecture document version ${version} not found`,
      );
    }

    return this.toDocumentResponse(document);
  }

  private async findOwnedRepository(userId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this repository',
      );
    }

    return repository;
  }

  private assertRepositoryReady(repository: {
    status: RepositoryStatus;
  }): void {
    if (repository.status !== RepositoryStatus.READY) {
      throw new BadRequestException(
        'Repository is not ready for architecture document generation',
      );
    }
  }

  private assertValidCommit(
    repository: { lastIndexedCommit: string | null },
    commitSha?: string,
  ): void {
    if (commitSha === undefined || commitSha === null) {
      return;
    }

    if (!repository.lastIndexedCommit) {
      throw new BadRequestException(
        'Repository has no indexed commit to validate against',
      );
    }

    if (commitSha !== repository.lastIndexedCommit) {
      throw new BadRequestException(
        'Commit reference must match the repository current indexed commit',
      );
    }
  }

  private toTriggerResponse(document: {
    id: string;
    version: number;
    status: DocStatus;
  }): ArchitectureDocTriggerResponse {
    return {
      docId: document.id,
      jobId: document.id,
      version: document.version,
      status: document.status,
    };
  }

  private toDocumentResponse(document: {
    id: string;
    version: number;
    status: DocStatus;
    commitSha: string | null;
    generatedAt: Date | null;
    verificationScore: number | null;
    sections: Array<{
      key: string;
      title: string;
      order: number;
      contentMd: string;
      sourceFiles: string[];
      diagramMermaid: string | null;
      verified: boolean;
      verificationNotes: string | null;
    }>;
  }): ArchitectureDocResponse {
    const sections: ArchitectureDocSectionResponse[] =
      document.status === DocStatus.COMPLETED
        ? document.sections.map((section) => ({
            key: section.key,
            title: section.title,
            order: section.order,
            contentMd: section.contentMd,
            sourceFiles: section.sourceFiles,
            diagramMermaid: section.diagramMermaid,
            verified: section.verified,
            verificationNotes: section.verificationNotes,
          }))
        : [];

    return {
      docId: document.id,
      version: document.version,
      status: document.status,
      commitSha: document.commitSha,
      generatedAt: document.generatedAt,
      verificationScore: document.verificationScore,
      sections,
    };
  }

  private boundErrorMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'Unknown queueing error';
    return message.slice(0, 500);
  }
}
