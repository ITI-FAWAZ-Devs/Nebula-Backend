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
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireGithubToken } from '../integrations/decorators/require-github-token.decorator';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';
import { AnalysisService } from '../analysis/analysis.service';
import { ImportRepoDto } from './dto/import-repo.dto';
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
   * Lists the user's GitHub repositories (fetched live from GitHub, with caching and pagination).
   */
  @Get('github')
  @RequireGithubToken()
  async listGithubRepos(
    @CurrentUser('id') userId: string,
    @Query() query: GithubRepoQueryDto,
  ) {
    const forceRefresh = query.force === 'true';
    const allRepos = await this.githubClientService.getRepositories(
      userId,
      forceRefresh,
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
   */
  @Post('import')
  @RequireGithubToken()
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
   * GET /repositories
   * Lists the user's imported repositories from the database.
   */
  @Get()
  async listImportedRepos(@CurrentUser('id') userId: string) {
    const repos = await this.repositoriesService.listImported(userId);
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
    const repository = await this.prisma.repository.findFirst({
      where: { id },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException('You do not have access to this repository');
    }

    // Prevent concurrent documentation jobs
    const activeJob = await this.prisma.documentationJob.findFirst({
      where: {
        repositoryId: id,
        status: {
          in: [DocumentationJobStatus.PENDING, DocumentationJobStatus.RUNNING],
        },
      },
    });

    if (activeJob) {
      throw new ConflictException(
        'A documentation job is already in progress for this repository',
      );
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
    const repository = await this.prisma.repository.findFirst({
      where: { id },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException('You do not have access to this repository');
    }

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
   * Query the repository documentation using RAG.
   */
  @Post(':id/ask')
  async askQuestion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskQuestionDto,
  ) {
    const repository = await this.prisma.repository.findFirst({
      where: { id },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.userId !== userId) {
      throw new ForbiddenException('You do not have access to this repository');
    }

    const result = await this.askService.ask(id, dto.question);
    return {
      success: true,
      message: 'Question answered successfully',
      data: result,
    };
  }
}
