import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireConnection } from '../connections/decorators/require-connection.decorator';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';
import { AnalysisService } from '../analysis/analysis.service';
import { ImportRepoDto } from './dto/import-repo.dto';
import { ImportFromUrlDto } from './dto/import-url.dto';
import { GithubRepoQueryDto } from './dto/github-repo-query.dto';
import { AskService } from './ask.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressEventsService } from '../progress/progress-events.service';
import { DocumentationJobStatus } from '@prisma/client';
import {
  DOCUMENTATION_QUEUE,
  DocumentationJobPayload,
} from './documentation.constants';

@Controller('repositories')
export class RepositoriesController {
  private readonly logger = new Logger(RepositoriesController.name);

  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly githubClientService: GithubClientService,
    private readonly analysisService: AnalysisService,
    private readonly askService: AskService,
    private readonly prisma: PrismaService,
    private readonly progress: ProgressEventsService,
    @InjectQueue(DOCUMENTATION_QUEUE)
    private readonly documentationQueue: Queue,
  ) {}

  /**
   * GET /repositories/github
   * Lists the user's GitHub repositories. Accepts optional ?connectionId= for
   * scoped browsing (OAuth connection per GitHub org/user account).
   */
  @Get('github')
  async listGithubRepos(
    @CurrentUser('id') userId: string,
    @Query() query: GithubRepoQueryDto,
  ) {
    const forceRefresh = query.force === 'true';

    const allRepos = await this.githubClientService.getRepositories(
      userId,
      forceRefresh,
      query.connectionId,
      query.organizationId,
      {
        search: query.search,
        visibility: query.visibility,
        sort: query.sort,
      },
    );

    // Apply pagination if parameters are provided
    if (query.page || query.limit) {
      const page = query.page || 1;
      const limit = query.limit || 30;
      const startIndex = (page - 1) * limit;
      const paginatedRepos = allRepos.slice(startIndex, startIndex + limit);

      return {
        success: true,
        message: 'GitHub repositories retrieved successfully',
        data: {
          repositories: paginatedRepos,
          total: allRepos.length,
          page,
          limit,
          totalPages: Math.ceil(allRepos.length / limit),
        },
      };
    }

    return {
      success: true,
      message: 'GitHub repositories retrieved successfully',
      data: {
        repositories: allRepos,
        total: allRepos.length,
      },
    };
  }

  /**
   * POST /repositories/import
   * Imports a selected GitHub repository into the database.
   * Connection is optional for public repositories.
   */
  @Post('import')
  async importRepo(
    @CurrentUser('id') userId: string,
    @Body() dto: ImportRepoDto,
  ) {
    const importedRepo = await this.repositoriesService.importRepository(
      userId,
      dto,
    );
    return {
      success: true,
      message: 'Repository imported successfully',
      data: importedRepo,
    };
  }

  /**
   * POST /repositories/import-url
   * Imports a public or private repository by URL or owner/repo shorthand.
   */
  @Post('import-url')
  async importRepoFromUrl(
    @CurrentUser('id') userId: string,
    @Body() dto: ImportFromUrlDto,
  ) {
    const importedRepo = await this.repositoriesService.importFromUrl(
      userId,
      dto,
    );
    return {
      success: true,
      message: 'Repository imported successfully',
      data: importedRepo,
    };
  }

  /**
   * GET /repositories
   * Lists the user's imported repositories from the database.
   * Optionally filter by organizationId to get org-scoped repos.
   */
  @Get()
  async listImportedRepos(
    @CurrentUser('id') userId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const repos = await this.repositoriesService.listImported(
      userId,
      organizationId,
    );
    return {
      success: true,
      message: 'Imported repositories retrieved successfully',
      data: repos,
    };
  }

  /**
   * GET /repositories/architecture-doc/status
   * Reports, per imported repository, whether a completed architecture document exists.
   */
  @Get('architecture-doc/status')
  async getArchitectureDocStatus(@CurrentUser('id') userId: string) {
    const data =
      await this.repositoriesService.getArchitectureDocStatus(userId);
    return {
      success: true,
      message: 'Architecture document status retrieved successfully',
      data,
    };
  }

  /**
   * POST /repositories/:id/analyze
   * Starts an async analysis job for the imported repository.
   */
  @Post(':id/analyze')
  async analyzeRepository(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.analysisService.startAnalysis(userId, id);
    return {
      success: true,
      message: 'Analysis job started',
      data: job,
    };
  }

  /**
   * GET /repositories/:id/analysis
   * Returns the latest analysis job status for polling.
   */
  @Get(':id/analysis')
  async getAnalysisStatus(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.analysisService.getLatestJob(userId, id);
    return {
      success: true,
      message: 'Analysis job retrieved successfully',
      data: job,
    };
  }

  /**
   * GET /repositories/:id
   * Retrieves details for a specific imported repository.
   */
  @Get(':id')
  async getImportedRepo(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repo = await this.repositoriesService.getImportedById(userId, id);
    return {
      success: true,
      message: 'Repository details retrieved successfully',
      data: repo,
    };
  }

  /**
   * DELETE /repositories/:id
   * Deletes an imported repository from the database.
   */
  @Delete(':id')
  async removeImportedRepo(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.repositoriesService.deleteImported(userId, id);
    return {
      success: true,
      message: 'Repository removed successfully',
      data: result,
    };
  }

  /**
   * POST /repositories/:id/document
   * Starts an async documentation indexing job for the imported repository.
   */
  @Post(':id/document')
  async documentRepository(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repository = await this.repositoriesService.getImportedByIdForWrite(
      userId,
      id,
    );

    // Return the most recent non-failed job — active or completed.
    // A new job is only created when there are no prior jobs or the last one failed.
    const latestDocJob = await this.prisma.documentationJob.findFirst({
      where: { repositoryId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (latestDocJob && latestDocJob.status !== DocumentationJobStatus.FAILED) {
      this.progress.publishDocumentation(id, latestDocJob);
      return {
        success: true,
        message:
          latestDocJob.status === DocumentationJobStatus.COMPLETED
            ? 'Documentation already completed'
            : 'Documentation job already in progress',
        data: latestDocJob,
      };
    }

    const job = await this.prisma.documentationJob.create({
      data: {
        repositoryId: id,
        status: DocumentationJobStatus.PENDING,
        stage: 'queued',
      },
    });

    this.progress.publishDocumentation(id, job);

    const payload: DocumentationJobPayload = {
      repositoryId: id,
      documentationJobId: job.id,
      userId,
    };

    const queueJob = await this.documentationQueue.add('document', payload, {
      jobId: job.id,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    await this.prisma.documentationJob.update({
      where: { id: job.id },
      data: { queueJobId: String(queueJob.id) },
    });

    const withQueueJobId = await this.prisma.documentationJob.findUnique({
      where: { id: job.id },
    });
    if (withQueueJobId) {
      this.progress.publishDocumentation(id, withQueueJobId);
    }

    return {
      success: true,
      message: 'Documentation job started',
      data: withQueueJobId ?? job,
    };
  }

  /**
   * GET /repositories/:id/documentation
   * Returns the latest documentation job status for polling.
   */
  @Get(':id/documentation')
  async getDocumentationStatus(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repository = await this.repositoriesService.getImportedById(
      userId,
      id,
    );

    const job = await this.prisma.documentationJob.findFirst({
      where: { repositoryId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (!job) {
      throw new NotFoundException(
        'No documentation job found for this repository',
      );
    }

    return {
      success: true,
      message: 'Documentation job retrieved successfully',
      data: job,
    };
  }

  /**
   * POST /repositories/:id/ask
   * @deprecated Legacy stateless endpoint. Redirection target is POST /repositories/:id/agent/sessions/:sessionId/messages
   */
  @Post(':id/ask')
  async askQuestion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskQuestionDto,
  ) {
    const repository = await this.repositoriesService.getImportedByIdForWrite(
      userId,
      id,
    );

    const result = await this.askService.ask(id, dto.question);
    return {
      success: true,
      message: 'Question answered successfully',
      data: result,
    };
  }
}
