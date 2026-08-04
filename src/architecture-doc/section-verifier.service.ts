import { Injectable, Logger } from '@nestjs/common';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { CodeContextLoaderService } from './code-context-loader.service';
import { DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { buildSectionVerificationPrompt } from './templates/section-verification.prompt';
import { buildJsonCorrectionPrompt } from './templates/json-correction.prompt';
import { extractJsonFromLlmText } from './utils/llm-response.util';
import { sanitizeSectionMarkdown } from './utils/markdown.util';

interface VerificationResponse {
  verdict: 'verified' | 'unverified' | 'removed';
  rewrittenBody: string | null;
  notes: string | null;
}

function isValidVerificationResponse(
  obj: unknown,
): obj is VerificationResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const v = obj as VerificationResponse;
  return (
    (v.verdict === 'verified' ||
      v.verdict === 'unverified' ||
      v.verdict === 'removed') &&
    (v.rewrittenBody === null || typeof v.rewrittenBody === 'string') &&
    (v.notes === null || typeof v.notes === 'string')
  );
}

/**
 * Phase 2 internal drafting pipeline component.
 * Implements per-section verification as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class SectionVerifierService {
  private readonly logger = new Logger(SectionVerifierService.name);

  constructor(
    private readonly hybridRetriever: HybridRetrieverService,
    private readonly aiProvider: AiProviderService,
    private readonly codeContextLoader: CodeContextLoaderService,
  ) {}

  async verify(
    section: DraftSection,
    context: HybridRetrievalContext,
    repositoryId: string,
    codeRootPath?: string | null,
  ): Promise<DraftSection> {
    const enrichedContext = await this.codeContextLoader.enrich(
      context,
      codeRootPath ?? null,
    );
    const prompt = buildSectionVerificationPrompt(section, enrichedContext);
    const response = (
      await this.aiProvider.generateContent(prompt, { tier: 'strong' })
    ).text;

    const verification = await this.parseVerification(
      response,
      section,
      'Verification',
    );

    if (verification.verdict === 'verified' && verification.rewrittenBody) {
      return {
        ...section,
        contentMd: sanitizeSectionMarkdown(verification.rewrittenBody),
        verdict: 'verified',
        verificationNotes: null,
      };
    }

    if (verification.verdict === 'unverified') {
      const followUpContext = await this.attemptFollowUp(
        section,
        context,
        repositoryId,
        verification.notes,
        codeRootPath ?? null,
      );

      if (followUpContext) {
        const followUpPrompt = buildSectionVerificationPrompt(
          section,
          followUpContext,
        );
        const followUpResponse = (
          await this.aiProvider.generateContent(followUpPrompt, {
            tier: 'strong',
          })
        ).text;

        const followUpVerification = await this.parseVerification(
          followUpResponse,
          section,
          'Follow-up verification',
        );

        return {
          ...section,
          contentMd: sanitizeSectionMarkdown(
            followUpVerification.rewrittenBody || section.contentMd,
          ),
          verdict: followUpVerification.verdict,
          verificationNotes: followUpVerification.notes,
        };
      }
    }

    return {
      ...section,
      contentMd: sanitizeSectionMarkdown(
        verification.rewrittenBody || section.contentMd,
      ),
      verdict: verification.verdict,
      verificationNotes: verification.notes,
    };
  }

  /**
   * Parses a verification LLM response. On failure, the LLM is asked once to
   * re-emit its response as pure JSON (self-healing retry). If that also
   * fails, the generated section content is preserved and marked `unverified`
   * instead of being dropped, so the draft always keeps the produced content.
   */
  private async parseVerification(
    response: string,
    section: DraftSection,
    stage: string,
  ): Promise<VerificationResponse> {
    try {
      return await extractJsonFromLlmText<VerificationResponse>(
        response,
        isValidVerificationResponse,
      );
    } catch (error) {
      this.logger.warn(
        `[${section.key}] ${stage} response could not be parsed; requesting corrected JSON: ${(error as Error).message}`,
      );

      try {
        const corrected = (
          await this.aiProvider.generateContent(
            buildJsonCorrectionPrompt(
              'an object with keys "verdict" ("verified" | "unverified" | "removed"), optional "rewrittenBody", and optional "notes"',
              response,
            ),
            { tier: 'strong' },
          )
        ).text;

        return await extractJsonFromLlmText<VerificationResponse>(
          corrected,
          isValidVerificationResponse,
        );
      } catch (correctedError) {
        this.logger.warn(
          `[${section.key}] ${stage} corrected response could not be parsed; keeping generated content as unverified: ${(correctedError as Error).message}`,
        );
        return {
          verdict: 'unverified',
          rewrittenBody: section.contentMd,
          notes: `${stage} failed to produce a valid response: ${(correctedError as Error).message}`,
        };
      }
    }
  }

  private async attemptFollowUp(
    section: DraftSection,
    context: HybridRetrievalContext,
    repositoryId: string,
    notes: string | null,
    codeRootPath: string | null,
  ): Promise<HybridRetrievalContext | null> {
    if (!notes) return null;

    const topicMatch = notes.match(/(?:about|regarding|for)\s+([^.]+)/i);
    if (!topicMatch) return null;

    const focusedTopic = topicMatch[1].trim();

    try {
      const followUpContext = await this.hybridRetriever.retrieve(
        repositoryId,
        {
          topic: focusedTopic,
        },
      );
      return await this.codeContextLoader.enrich(followUpContext, codeRootPath);
    } catch (error) {
      this.logger.warn(
        `Follow-up retrieval failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
