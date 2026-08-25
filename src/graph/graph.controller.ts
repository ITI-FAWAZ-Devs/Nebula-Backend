import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GraphService } from './graph.service';

@Controller('repositories/:repositoryId/graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  /**
   * GET /repositories/:repositoryId/graph
   * Fetches the architecture knowledge graph nodes and edges for visualization.
   */
  @Get()
  async getArchitectureGraph(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Query('moduleId') moduleId?: string,
    @Query('maxNodes') maxNodes?: string,
  ) {
    const limit = maxNodes ? parseInt(maxNodes, 10) : undefined;
    const data = await this.graphService.getArchitectureGraph(
      userId,
      repositoryId,
      { moduleId, maxNodes: limit },
    );
    return {
      success: true,
      message: 'Architecture graph retrieved successfully',
      data,
    };
  }

  /**
   * GET /repositories/:repositoryId/graph/overview
   * Returns repository-wide graph statistics, top hub nodes, and distribution.
   */
  @Get('overview')
  async getGraphOverview(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const data = await this.graphService.getGraphOverview(userId, repositoryId);
    return {
      success: true,
      message: 'Graph overview retrieved successfully',
      data,
    };
  }

  /**
   * GET /repositories/:repositoryId/graph/cycles
   * Detects circular dependencies in the codebase.
   */
  @Get('cycles')
  async getCircularDependencies(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    const depth = maxDepth ? parseInt(maxDepth, 10) : undefined;
    const data = await this.graphService.getCircularDependencies(
      userId,
      repositoryId,
      depth,
    );
    return {
      success: true,
      message: 'Circular dependencies retrieved successfully',
      data: {
        cyclesCount: data.length,
        cycles: data,
      },
    };
  }

  /**
   * GET /repositories/:repositoryId/graph/impact?filePath=...
   * Performs blast radius / transitive impact analysis on a file.
   */
  @Get('impact')
  async getImpactAnalysis(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Query('filePath') filePath?: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    if (!filePath || filePath.trim().length === 0) {
      throw new BadRequestException('Query parameter "filePath" is required');
    }
    const depth = maxDepth ? parseInt(maxDepth, 10) : undefined;
    const data = await this.graphService.getImpactAnalysis(
      userId,
      repositoryId,
      filePath.trim(),
      depth,
    );
    return {
      success: true,
      message: 'Impact analysis completed successfully',
      data: {
        targetFile: filePath.trim(),
        dependentCount: data.length,
        dependents: data,
      },
    };
  }

  /**
   * GET /repositories/:repositoryId/graph/dead-code
   * Finds unreferenced / dead code symbols with 0 incoming calls or imports.
   */
  @Get('dead-code')
  async getDeadCode(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const data = await this.graphService.getDeadCode(userId, repositoryId);
    return {
      success: true,
      message: 'Dead code analysis completed successfully',
      data: {
        deadCodeCount: data.length,
        items: data,
      },
    };
  }
}
