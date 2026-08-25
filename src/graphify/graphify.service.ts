import { Injectable, Logger } from '@nestjs/common';
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

import { AstExtractorService } from './ast-extractor.service';

@Injectable()
export class GraphifyService {
  private readonly logger = new Logger(GraphifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly astExtractor: AstExtractorService,
  ) {}

  async analyze(
    project: ProjectMetadata,
    workspace: WorkspaceContext,
  ): Promise<GraphifyResult> {
    const bin = this.configService.get<string>('graphify.bin') || 'graphify';
    const argsTemplate = this.configService.get<string>('graphify.args') || '';
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

      return await this.readResult(outputFile);
    } catch (error) {
      const err = error as Error & {
        stderr?: string;
        stdout?: string;
        failed?: boolean;
        timedOut?: boolean;
      };

      this.logger.warn(
        `Graphify CLI execution failed (bin='${bin}'): ${err.message}. Falling back to in-process AST extraction.`,
      );

      // In-process fallback parser
      const fallbackResult = await this.astExtractor.extract(projectPath);
      if (!fallbackResult.nodes?.length) {
        throw new Error(
          `Graphify extraction and in-process fallback both failed to find code entities in ${projectPath}`,
        );
      }

      // Ensure output directory and write fallback graph.json for pipeline checkpointing
      try {
        await fs.mkdir(path.dirname(outputFile), { recursive: true });
        await fs.writeFile(outputFile, JSON.stringify(fallbackResult, null, 2), 'utf-8');
        fallbackResult.outputPath = outputFile;
      } catch (writeErr) {
        this.logger.warn(
          `Could not persist fallback graph.json: ${(writeErr as Error).message}`,
        );
      }

      return fallbackResult;
    }
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

      const nodes = (parsed.nodes || parsed.entities || []) as GraphifyNode[];
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
      // The CLI exited 0 but produced no readable output — treat as failure
      // rather than silently continuing with an empty graph.
      this.logger.error(
        `Could not read Graphify output at ${outputFile}: ${(error as Error).message}`,
      );
      throw new Error(
        `Graphify reported success but no readable output was found at ${outputFile}`,
      );
    }
  }
}
