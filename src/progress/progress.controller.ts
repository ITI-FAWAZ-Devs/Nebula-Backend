import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipResponseIntercept } from '../common/decorators/skip-response-intercept.decorator';
import {
  ProgressEventsService,
  ArchDocProgressPayload,
} from './progress-events.service';

@Controller('repositories/:repositoryId/progress')
export class ProgressController {
  private readonly logger = new Logger(ProgressController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
  ) {}

  @Get('stream')
  @SkipResponseIntercept()
  @SkipThrottle()
  async stream(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Res() res: Response,
  ): Promise<void> {
    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.organizationId) {
      const isMember = await this.prisma.organizationMember.findFirst({
        where: {
          orgId: repository.organizationId,
          userId,
        },
      });
      if (!isMember) {
        throw new ForbiddenException(
          'You do not have access to this repository',
        );
      }
    } else if (repository.userId !== userId) {
      throw new ForbiddenException('You do not have access to this repository');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const [analysis, documentation, generatedDoc] = await Promise.all([
      this.prisma.analysisJob.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.documentationJob.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.generatedDoc.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const architectureDoc: ArchDocProgressPayload | null = generatedDoc
      ? {
          jobId: generatedDoc.id,
          docId: generatedDoc.id,
          status: generatedDoc.status,
          errorMessage: generatedDoc.errorMessage,
        }
      : null;

    res.write(
      `event: snapshot\ndata: ${JSON.stringify({
        analysis,
        documentation,
        architectureDoc,
      })}\n\n`,
    );

    const unsubscribe = this.progress.subscribe(repositoryId, (event) => {
      res.write(
        `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`,
      );
    });

    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    res.on('close', cleanup);
    res.on('aborted', cleanup);

    this.logger.log(
      `Progress stream opened for repository ${repositoryId} by user ${userId}`,
    );
  }
}
