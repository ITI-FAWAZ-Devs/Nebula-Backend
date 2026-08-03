import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { SectionPlan } from './dto/architecture-draft.dto';
import { buildStructurePlanPrompt } from './templates/structure-plan.prompt';
import {
  extractJsonFromLlmText,
  validateSectionPlanArray,
} from './utils/llm-response.util';

/**
 * Phase 2 internal drafting pipeline component.
 * Implements repository-specific section planning as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class StructurePlannerService {
  private readonly logger = new Logger(StructurePlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly hybridRetriever: HybridRetrieverService,
    private readonly codeContextLoader: CodeContextLoaderService,
  ) {}

  async plan(
    repositoryId: string,
    codeRootPath?: string | null,
  ): Promise<SectionPlan[]> {
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

    const context = await this.hybridRetriever.retrieve(repositoryId, {
      topic: 'architecture overview of the repository',
    });

    if (context.noEvidence) {
      return [];
    }

    const enrichedContext = await this.codeContextLoader.enrich(
      context,
      codeRootPath ?? null,
    );

    const prompt = buildStructurePlanPrompt(
      repository.name,
      repository.owner || 'unknown',
      enrichedContext,
    );

    let response: string;
    try {
      response = (
        await this.aiProvider.generateContent(prompt, { tier: 'strong' })
      ).text;
    } catch (error) {
      this.logger.error(
        `Failed to generate structure plan: ${(error as Error).message}`,
      );
      throw error;
    }

    let plans: SectionPlan[];
    try {
      plans = await extractJsonFromLlmText(response, validateSectionPlanArray);
    } catch (error) {
      this.logger.warn(
        `Malformed JSON response, retrying: ${(error as Error).message}`,
      );
      response = (
        await this.aiProvider.generateContent(prompt, { tier: 'strong' })
      ).text;
      plans = await extractJsonFromLlmText(response, validateSectionPlanArray);
    }

    return this.validatePlans(plans);
  }

  private validatePlans(plans: SectionPlan[]): SectionPlan[] {
    const seenKeys = new Set<string>();
    return plans.filter((plan) => {
      if (
        !plan.key ||
        plan.key.trim().length === 0 ||
        !plan.title ||
        plan.title.trim().length === 0 ||
        !plan.purpose ||
        plan.purpose.trim().length === 0 ||
        !plan.retrievalTopic ||
        plan.retrievalTopic.trim().length === 0
      ) {
        return false;
      }

      if (seenKeys.has(plan.key)) {
        return false;
      }
      seenKeys.add(plan.key);
      return true;
    });
  }
}
