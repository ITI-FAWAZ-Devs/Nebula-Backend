import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StructurePlannerService } from './structure-planner.service';
import { SectionGeneratorService } from './section-generator.service';
import { SectionVerifierService } from './section-verifier.service';
import { DiagramGeneratorService } from './diagram-generator.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { DocStatus } from '@prisma/client';
import {
  DraftRequest,
  ArchitectureDraft,
  DraftSection,
  ArchitectureDiagram,
} from './dto/architecture-draft.dto';
import { buildDependencyGraphSectionContent } from './templates/dependency-graph-section.prompt';

export const DEPENDENCY_GRAPH_SECTION_KEY = 'dependency-graph';

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
    private readonly codeContextLoader: CodeContextLoaderService,
  ) {}

  async draft(
    request: DraftRequest,
    onProgress?: DraftProgressReporter,
  ): Promise<ArchitectureDraft> {
    const { repositoryId, userId } = request;

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

    let docModel: string | undefined;
    if (request.documentId) {
      const doc = await this.prisma.generatedDoc.findUnique({
        where: { id: request.documentId },
        select: { model: true },
      });
      docModel = doc?.model || undefined;
    }

    const codeRootPath = await this.codeContextLoader.ensureClone(
      repositoryId,
      userId,
    );
    this.logger.log(
      `[${repositoryId}] Code availability: ${codeRootPath ? `available at ${codeRootPath}` : 'unavailable — continuing with description-only evidence'}`,
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
    const sectionPlan = await this.structurePlanner.plan(
      repositoryId,
      codeRootPath,
      { overrideModel: docModel },
    );

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
    const allFiles = new Map<string, { filePath: string }>();
    broadContext.files.forEach((f) => allFiles.set(f.filePath, f));

    await onProgress?.('GENERATING');

    let verificationStarted = false;
    for (let i = 0; i < sectionPlan.length; i++) {
      const plan = sectionPlan[i];
      this.logger.log(
        `[${repositoryId}] Generating section ${i + 1}/${sectionPlan.length}: ${plan.key}`,
      );
      let generated: DraftSection | null = null;
      try {
        const context = await this.hybridRetriever.retrieve(repositoryId, {
          topic: plan.retrievalTopic,
        });

        allRelationships.push(...context.relationships);
        allClusters.push(...context.moduleClusters);
        context.files.forEach((f) => allFiles.set(f.filePath, f));

        this.logger.log(
          `[${repositoryId}] Retrieved ${context.files.length} files for "${plan.key}"`,
        );

        generated = await this.sectionGenerator.generate(
          repositoryId,
          plan,
          context,
          codeRootPath,
          { overrideModel: docModel },
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
          codeRootPath,
          { overrideModel: docModel },
        );

        this.logger.log(
          `[${repositoryId}] Verified "${plan.key}": verdict=${verified.verdict}, notes=${verified.verificationNotes ?? 'null'}`,
        );

        let sectionDiagram: ArchitectureDiagram | null = null;
        try {
          sectionDiagram = await this.diagramGenerator.generate(
            context.relationships,
            context.moduleClusters,
            [verified],
            plan.title,
            context.files,
          );
          this.logger.log(
            `[${repositoryId}] Section diagram "${plan.key}": ${sectionDiagram ? 'present' : 'null'}`,
          );
        } catch (diagramError) {
          this.logger.error(
            `[${repositoryId}] Failed to generate diagram for "${plan.key}": ${(diagramError as Error).message}`,
            (diagramError as Error).stack,
          );
        }

        sections.push({
          ...verified,
          diagramMermaid: sectionDiagram?.mermaidSource ?? null,
        });
      } catch (error) {
        this.logger.error(
          `[${repositoryId}] Failed to process section ${plan.key}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        sections.push(
          generated
            ? {
                ...generated,
                verdict: 'unverified',
                verificationNotes: `Processing failed: ${(error as Error).message}`,
              }
            : {
                key: plan.key,
                title: plan.title,
                contentMd: '',
                sourceFiles: [],
                verdict: 'removed',
                verificationNotes: `Processing failed: ${(error as Error).message}`,
              },
        );
      }
    }

    this.logger.log(`[${repositoryId}] Generating diagram...`);
    let diagram: ArchitectureDiagram | null = null;
    try {
      diagram = await this.diagramGenerator.generate(
        allRelationships,
        allClusters,
        sections,
        undefined,
        Array.from(allFiles.values()),
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

    const hasDependencyGraphSection = sectionPlan.some(
      (p) => p.key === DEPENDENCY_GRAPH_SECTION_KEY,
    );
    const hasSectionGraphs = sections.some(
      (s) => s.diagramMermaid && s.key !== DEPENDENCY_GRAPH_SECTION_KEY,
    );
    if (!hasDependencyGraphSection && (diagram != null || hasSectionGraphs)) {
      const dependencyGraphSection: DraftSection = {
        key: DEPENDENCY_GRAPH_SECTION_KEY,
        title: 'Dependency Graph',
        contentMd: buildDependencyGraphSectionContent(sections),
        sourceFiles: [],
        verdict: 'verified',
        verificationNotes: null,
        diagramMermaid: diagram?.mermaidSource ?? null,
      };
      sections.push(dependencyGraphSection);
      this.logger.log(
        `[${repositoryId}] Appended "${dependencyGraphSection.title}" aggregate section (${sections.length} total)`,
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
