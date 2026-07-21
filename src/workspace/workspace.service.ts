import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceContext } from './interfaces/workspace-context.interface';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly workspaceRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.workspaceRoot =
      this.configService.get<string>('workspace.root') ||
      path.resolve(process.cwd(), 'workspace');
  }

  async create(jobId: string): Promise<WorkspaceContext> {
    const rootPath = path.join(this.workspaceRoot, `analysis-${jobId}`);
    const repositoryPath = path.join(rootPath, 'repository');
    const graphifyPath = path.join(rootPath, 'graphify');
    const outputPath = path.join(rootPath, 'output');
    const logsPath = path.join(rootPath, 'logs');

    await Promise.all([
      fs.mkdir(repositoryPath, { recursive: true }),
      fs.mkdir(graphifyPath, { recursive: true }),
      fs.mkdir(outputPath, { recursive: true }),
      fs.mkdir(logsPath, { recursive: true }),
    ]);

    this.logger.log(`Created workspace at ${rootPath}`);

    return {
      id: jobId,
      rootPath,
      repositoryPath,
      graphifyPath,
      outputPath,
      logsPath,
    };
  }

  async cleanup(workspace: WorkspaceContext): Promise<void> {
    try {
      await fs.rm(workspace.rootPath, { recursive: true, force: true });
      this.logger.log(`Cleaned up workspace ${workspace.rootPath}`);
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup workspace ${workspace.rootPath}: ${(error as Error).message}`,
      );
    }
  }

  getRepositoryPath(workspace: WorkspaceContext): string {
    return workspace.repositoryPath;
  }

  getOutputPath(workspace: WorkspaceContext): string {
    return workspace.outputPath;
  }

  getGraphifyPath(workspace: WorkspaceContext): string {
    return workspace.graphifyPath;
  }

  getLogsPath(workspace: WorkspaceContext): string {
    return workspace.logsPath;
  }
}
