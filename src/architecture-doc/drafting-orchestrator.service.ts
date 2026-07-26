import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { DraftRequest, ArchitectureDraft, DraftSection, ArchitectureDiagram } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

/**
 * Phase 2 internal drafting pipeline component.
 * Top-level orchestrator for the architecture drafting pipeline as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class DraftingOrchestratorService {
  private readonly logger = new Logger(DraftingOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly structurePlanner: StructurePlannerService,
    private readonly sectionGenerator: SectionGeneratorService,
    private readonly sectionVerifier: SectionVerifierService,
    private readonly diagramGenerator: DiagramGeneratorService,
    private readonly hybridRetriever: HybridRetrieverService,
  ) {}

  async draft(request: DraftRequest): Promise<ArchitectureDraft> {
    const { repositoryId } = request;

    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    if (repository.status !== 'READY') {
      throw new Error(
        `Repository ${repositoryId} is not ready (status: ${repository.status})`,
      );
    }

    const broadContext = await this.hybridRetriever.retrieve(repositoryId, {
      topic: 'architecture overview of the repository',
    });

    const sectionPlan = await this.structurePlanner.plan(repositoryId);

    if (sectionPlan.length === 0) {
      return {
        repositoryId,
        repositoryName: repository.name,
        sections: [],
        diagram: null,
        sectionPlan: [],
        sourceStatus: broadContext.sourceStatus,
        generatedAt: new Date(),
      };
    }

    const sections: DraftSection[] = [];
    const allRelationships = [...broadContext.relationships];
    const allClusters = [...broadContext.moduleClusters];

    for (const plan of sectionPlan) {
      try {
        const context = await this.hybridRetriever.retrieve(repositoryId, {
          topic: plan.retrievalTopic,
        });

        allRelationships.push(...context.relationships);
        allClusters.push(...context.moduleClusters);

        const generated = await this.sectionGenerator.generate(
          repositoryId,
          plan,
          context,
        );

        const verified = await this.sectionVerifier.verify(
          generated,
          context,
          repositoryId,
        );

        sections.push(verified);
      } catch (error) {
        this.logger.error(
          `Failed to process section ${plan.key}: ${(error as Error).message}`,
        );
        sections.push({
          key: plan.key,
          title: plan.title,
          contentMd: '',
          sourceFiles: [],
          verdict: 'removed',
          verificationNotes: `Processing failed: ${(error as Error).message}`,
        });
      }
    }

    let diagram: ArchitectureDiagram | null = null;
    try {
      diagram = await this.diagramGenerator.generate(
        allRelationships,
        allClusters,
        sections,
      );
    } catch (error) {
      this.logger.error(
        `Failed to generate diagram: ${(error as Error).message}`,
      );
    }

    return {
      repositoryId,
      repositoryName: repository.name,
      sections,
      diagram,
      sectionPlan,
      sourceStatus: broadContext.sourceStatus,
      generatedAt: new Date(),
    };
  }
}
