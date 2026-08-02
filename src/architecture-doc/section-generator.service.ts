import { Injectable, Logger } from '@nestjs/common';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { SectionPlan, DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { buildSectionGenerationPrompt } from './templates/section-generation.prompt';

/**
 * Phase 2 internal drafting pipeline component.
 * Implements per-section content generation with citations as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class SectionGeneratorService {
  private readonly logger = new Logger(SectionGeneratorService.name);

  constructor(
    private readonly hybridRetriever: HybridRetrieverService,
    private readonly aiProvider: AiProviderService,
  ) {}

  async generate(
    repositoryId: string,
    plan: SectionPlan,
    context?: HybridRetrievalContext,
  ): Promise<DraftSection> {
    const retrievalContext =
      context ||
      (await this.hybridRetriever.retrieve(repositoryId, {
        topic: plan.retrievalTopic,
      }));

    const prompt = buildSectionGenerationPrompt(plan, retrievalContext);
    const response = (
      await this.aiProvider.generateContent(prompt, { tier: 'strong' })
    ).text;

    const sourceFiles = this.extractCitations(response, retrievalContext);

    return {
      key: plan.key,
      title: plan.title,
      contentMd: response,
      sourceFiles,
      verdict: 'unverified',
      verificationNotes: null,
    };
  }

  private extractCitations(
    content: string,
    context: HybridRetrievalContext,
  ): string[] {
    const citationRegex = /\[([^\]]+)\]/g;
    const evidencePaths = new Set(context.files.map((f) => f.filePath));
    const citations = new Set<string>();
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      const path = match[1].trim();
      if (path.length > 0 && evidencePaths.has(path)) {
        citations.add(path);
      }
    }

    return Array.from(citations);
  }
}
