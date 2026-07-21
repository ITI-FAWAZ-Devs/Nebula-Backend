import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectMetadata } from './interfaces/project-metadata.interface';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  async scan(repositoryPath: string): Promise<ProjectMetadata> {
    const [
      hasPackageJson,
      hasPnpmLock,
      hasNpmLock,
      hasYarnLock,
      hasTsconfig,
      hasNestCli,
      hasTurbo,
      hasNx,
    ] = await Promise.all([
      this.exists(path.join(repositoryPath, 'package.json')),
      this.exists(path.join(repositoryPath, 'pnpm-lock.yaml')),
      this.exists(path.join(repositoryPath, 'package-lock.json')),
      this.exists(path.join(repositoryPath, 'yarn.lock')),
      this.exists(path.join(repositoryPath, 'tsconfig.json')),
      this.exists(path.join(repositoryPath, 'nest-cli.json')),
      this.exists(path.join(repositoryPath, 'turbo.json')),
      this.exists(path.join(repositoryPath, 'nx.json')),
    ]);

    let packageJson: Record<string, unknown> = {};
    if (hasPackageJson) {
      try {
        const raw = await fs.readFile(
          path.join(repositoryPath, 'package.json'),
          'utf-8',
        );
        packageJson = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.logger.warn('Failed to parse package.json');
      }
    }

    const framework = this.detectFramework({
      packageJson,
      hasNestCli,
      hasTurbo,
      hasNx,
    });
    const language = this.detectLanguage({ hasTsconfig, packageJson });
    const packageManager = this.detectPackageManager({
      hasPnpmLock,
      hasNpmLock,
      hasYarnLock,
    });

    const metadata: ProjectMetadata = {
      framework,
      language,
      packageManager,
      rootPath: repositoryPath,
    };

    this.logger.log(
      `Discovered project: ${framework} / ${language} / ${packageManager}`,
    );

    return metadata;
  }

  private detectFramework(opts: {
    packageJson: Record<string, unknown>;
    hasNestCli: boolean;
    hasTurbo: boolean;
    hasNx: boolean;
  }): string {
    if (opts.hasNestCli) return 'NestJS';

    const deps = {
      ...(opts.packageJson.dependencies as Record<string, string> | undefined),
      ...(opts.packageJson.devDependencies as
        | Record<string, string>
        | undefined),
    };

    if (deps['@nestjs/core']) return 'NestJS';
    if (deps['next']) return 'Next.js';
    if (deps['react']) return 'React';
    if (deps['vue']) return 'Vue';
    if (deps['express']) return 'Express';
    if (opts.hasNx) return 'Nx';
    if (opts.hasTurbo) return 'Turborepo';
    if (opts.packageJson.name) return 'Node.js';

    return 'Unknown';
  }

  private detectLanguage(opts: {
    hasTsconfig: boolean;
    packageJson: Record<string, unknown>;
  }): string {
    if (opts.hasTsconfig) return 'TypeScript';

    const deps = {
      ...(opts.packageJson.dependencies as Record<string, string> | undefined),
      ...(opts.packageJson.devDependencies as
        | Record<string, string>
        | undefined),
    };

    if (deps['typescript']) return 'TypeScript';
    if (opts.packageJson.name) return 'JavaScript';

    return 'Unknown';
  }

  private detectPackageManager(opts: {
    hasPnpmLock: boolean;
    hasNpmLock: boolean;
    hasYarnLock: boolean;
  }): string {
    if (opts.hasPnpmLock) return 'pnpm';
    if (opts.hasYarnLock) return 'yarn';
    if (opts.hasNpmLock) return 'npm';
    return 'unknown';
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
