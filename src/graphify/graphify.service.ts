import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceContext } from '../workspace/interfaces/workspace-context.interface';
import { ProjectMetadata } from '../discovery/interfaces/project-metadata.interface';
import {
  GraphifyResult,
  GraphifyNode,
  GraphifyEdge,
} from './interfaces/graphify-result.interface';

@Injectable()
export class GraphifyService {
  private readonly logger = new Logger(GraphifyService.name);

  constructor(private readonly configService: ConfigService) {}

  async analyze(
    project: ProjectMetadata,
    workspace: WorkspaceContext,
  ): Promise<GraphifyResult> {
    const bin = this.configService.get<string>('graphify.bin') || 'graphify';
    const argsTemplate =
      this.configService.get<string>('graphify.args') || '';
    const timeoutMs =
      this.configService.get<number>('graphify.timeoutMs') || 300000;

    const projectPath = path.resolve(project.rootPath);
    const graphifyDir = path.resolve(workspace.graphifyPath);
    // `graphify extract --out DIR` writes DIR/graphify-out/graph.json
    const outputFile = path.join(graphifyDir, 'graphify-out', 'graph.json');

    const args = this.buildArgs(argsTemplate, {
      projectPath,
      outputPath: outputFile,
      graphifyDir,
    });

    this.logger.log(`Running Graphify: ${bin} ${args.join(' ')}`);

    try {
      await execa(bin, args, {
        timeout: timeoutMs,
        cwd: projectPath,
        reject: true,
      });
    } catch (error) {
      const err = error as Error & { stderr?: string; stdout?: string };
      this.logger.error(
        `Graphify failed: ${err.message}\nstderr: ${err.stderr || ''}`,
      );
      throw new InternalServerErrorException(
        `Graphify analysis failed: ${err.message}`,
      );
    }

    return this.readResult(outputFile);
  }

  private buildArgs(
    template: string,
    vars: {
      projectPath: string;
      outputPath: string;
      graphifyDir: string;
    },
  ): string[] {
    // Default: headless AST extraction (no LLM) into graphifyDir/graphify-out/
    if (!template.trim()) {
      return [
        'extract',
        vars.projectPath,
        '--code-only',
        '--no-cluster',
        '--out',
        vars.graphifyDir,
      ];
    }

    return template
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        token
          .replace(/\{projectPath\}/g, vars.projectPath)
          .replace(/\{outputPath\}/g, vars.outputPath)
          .replace(/\{graphifyDir\}/g, vars.graphifyDir),
      );
  }

  private async readResult(outputFile: string): Promise<GraphifyResult> {
    try {
      const raw = await fs.readFile(outputFile, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const nodes = (parsed.nodes ||
        parsed.entities ||
        []) as GraphifyNode[];
      const edges = (parsed.edges ||
        parsed.relationships ||
        parsed.links ||
        []) as GraphifyEdge[];

      this.logger.log(
        `Graphify produced ${Array.isArray(nodes) ? nodes.length : 0} nodes, ${Array.isArray(edges) ? edges.length : 0} edges`,
      );

      return {
        raw: parsed,
        nodes: Array.isArray(nodes) ? nodes : [],
        edges: Array.isArray(edges) ? edges : [],
        outputPath: outputFile,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read Graphify output at ${outputFile}: ${(error as Error).message}. Returning empty result.`,
      );
      return {
        raw: null,
        nodes: [],
        edges: [],
        outputPath: outputFile,
      };
    }
  }
}
