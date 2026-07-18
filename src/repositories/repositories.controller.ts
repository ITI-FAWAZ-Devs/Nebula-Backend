import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RepositoriesService } from './repositories.service';
import { GithubClientService } from './github-client.service';
import { ImportRepoDto } from './dto/import-repo.dto';
import { GithubRepoQueryDto } from './dto/github-repo-query.dto';

@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly githubClientService: GithubClientService,
  ) {}

  /**
   * GET /repositories/github
   * Lists the user's GitHub repositories (fetched live from GitHub, with caching and pagination).
   */
  @Get('github')
  async listGithubRepos(
    @CurrentUser('id') userId: string,
    @Query() query: GithubRepoQueryDto,
  ) {
    const forceRefresh = query.force === 'true';
    const allRepos = await this.githubClientService.getRepositories(userId, forceRefresh);

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
  async importRepo(
    @CurrentUser('id') userId: string,
    @Body() dto: ImportRepoDto,
  ) {
    const importedRepo = await this.repositoriesService.importRepository(userId, dto);
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
}
