import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { DocStatus } from '@prisma/client';
import {
  DraftRequest,
  ArchitectureDraft,
  DraftSection,
  ArchitectureDiagram,
} from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';

export type DraftProgressReporter = (status: DocStatus) => void | Promise<void>;

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

  async draft(
    request: DraftRequest,
    onProgress?: DraftProgressReporter,
  ): Promise<ArchitectureDraft> {
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

    this.logger.log(
      `[${repositoryId}] Starting draft for "${repository.name}"`,
    );

    await onProgress?.('RETRIEVING');
    this.logger.log(`[${repositoryId}] Retrieving broad context...`);

    const broadContext = await this.hybridRetriever.retrieve(repositoryId, {
      topic: 'architecture overview of the repository',
    });

    this.logger.log(
      `[${repositoryId}] Broad context: ${broadContext.files.length} files, ${broadContext.relationships.length} relationships, ${broadContext.moduleClusters.length} clusters, noEvidence=${broadContext.noEvidence}`,
    );

    this.logger.log(`[${repositoryId}] Planning sections...`);
    const sectionPlan = await this.structurePlanner.plan(repositoryId);

    this.logger.log(
      `[${repositoryId}] Section plan: ${sectionPlan.length} sections planned`,
    );
    sectionPlan.forEach((p) => {
      this.logger.log(
        `[${repositoryId}]   - ${p.key}: "${p.title}" (topic: ${p.retrievalTopic})`,
      );
    });

    if (sectionPlan.length === 0) {
      this.logger.warn(
        `[${repositoryId}] No sections planned — returning empty draft`,
      );
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

    await onProgress?.('GENERATING');

    let verificationStarted = false;
    for (let i = 0; i < sectionPlan.length; i++) {
      const plan = sectionPlan[i];
      this.logger.log(
        `[${repositoryId}] Generating section ${i + 1}/${sectionPlan.length}: ${plan.key}`,
      );
      try {
        const context = await this.hybridRetriever.retrieve(repositoryId, {
          topic: plan.retrievalTopic,
        });

        allRelationships.push(...context.relationships);
        allClusters.push(...context.moduleClusters);

        this.logger.log(
          `[${repositoryId}] Retrieved ${context.files.length} files for "${plan.key}"`,
        );

        const generated = await this.sectionGenerator.generate(
          repositoryId,
          plan,
          context,
        );

        this.logger.log(
          `[${repositoryId}] Generated "${plan.key}": verdict=${generated.verdict}, contentLength=${generated.contentMd.length}, citations=${generated.sourceFiles.length}`,
        );

        if (!verificationStarted) {
          verificationStarted = true;
          await onProgress?.('VERIFYING');
        }

        const verified = await this.sectionVerifier.verify(
          generated,
          context,
          repositoryId,
        );

        this.logger.log(
          `[${repositoryId}] Verified "${plan.key}": verdict=${verified.verdict}, notes=${verified.verificationNotes ?? 'null'}`,
        );

        sections.push(verified);
      } catch (error) {
        this.logger.error(
          `[${repositoryId}] Failed to process section ${plan.key}: ${(error as Error).message}`,
          (error as Error).stack,
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

    this.logger.log(`[${repositoryId}] Generating diagram...`);
    let diagram: ArchitectureDiagram | null = null;
    try {
      diagram = await this.diagramGenerator.generate(
        allRelationships,
        allClusters,
        sections,
      );
      this.logger.log(
        `[${repositoryId}] Diagram: ${diagram ? `present (${diagram.mermaidSource.length} chars, modules=${diagram.modules.length})` : 'null'}`,
      );
    } catch (error) {
      this.logger.error(
        `[${repositoryId}] Failed to generate diagram: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }

    this.logger.log(
      `[${repositoryId}] Draft complete: ${sections.length} sections, diagram=${diagram ? 'yes' : 'no'}`,
    );

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
