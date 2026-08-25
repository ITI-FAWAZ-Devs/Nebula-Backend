import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Neo4jService } from '../neo4j/neo4j.service';

@Injectable()
export class GraphService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
  ) {}

  private async assertRepositoryAccess(userId: string, repositoryId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id: repositoryId, userId },
    });
    if (!repo) {
      throw new NotFoundException(`Repository ${repositoryId} not found`);
    }
    return repo;
  }

  async getArchitectureGraph(
    userId: string,
    repositoryId: string,
    options?: { moduleId?: string; maxNodes?: number },
  ) {
    await this.assertRepositoryAccess(userId, repositoryId);
    return this.neo4j.getArchitectureGraph(repositoryId, options);
  }

  async getGraphOverview(userId: string, repositoryId: string) {
    await this.assertRepositoryAccess(userId, repositoryId);
    return this.neo4j.getGraphOverview(repositoryId);
  }

  async getCircularDependencies(
    userId: string,
    repositoryId: string,
    maxDepth?: number,
  ) {
    await this.assertRepositoryAccess(userId, repositoryId);
    return this.neo4j.getCircularDependencies(repositoryId, maxDepth);
  }

  async getImpactAnalysis(
    userId: string,
    repositoryId: string,
    filePath: string,
    maxDepth?: number,
  ) {
    await this.assertRepositoryAccess(userId, repositoryId);
    return this.neo4j.getImpactAnalysis(repositoryId, filePath, maxDepth);
  }

  async getDeadCode(userId: string, repositoryId: string) {
    await this.assertRepositoryAccess(userId, repositoryId);
    return this.neo4j.getDeadCode(repositoryId);
  }
}
