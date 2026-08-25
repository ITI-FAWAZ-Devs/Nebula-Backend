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
  rewrittenBody?: string | null;
  notes?: string | null;
}

function isValidVerificationResponse(
  obj: unknown,
): obj is VerificationResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const v = obj as Record<string, unknown>;
  const rawVerdict =
    typeof v.verdict === 'string' ? v.verdict.toLowerCase().trim() : '';
  const validVerdict =
    rawVerdict === 'verified' ||
    rawVerdict === 'unverified' ||
    rawVerdict === 'removed';
  const validRewrittenBody =
    v.rewrittenBody === undefined ||
    v.rewrittenBody === null ||
    typeof v.rewrittenBody === 'string';
  const validNotes =
    v.notes === undefined ||
    v.notes === null ||
    typeof v.notes === 'string';

  return validVerdict && validRewrittenBody && validNotes;
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
    options?: { overrideModel?: string },
  ): Promise<DraftSection> {
    const enrichedContext = await this.codeContextLoader.enrich(
      context,
      codeRootPath ?? null,
    );
    const prompt = buildSectionVerificationPrompt(section, enrichedContext);
    const response = (
      await this.aiProvider.generateContent(prompt, {
        tier: 'strong',
        overrideModel: options?.overrideModel,
      })
    ).text;

    const verification = await this.parseVerification(
      response,
      section,
      'Verification',
      options,
    );

    if (verification.verdict === 'verified') {
      return {
        ...section,
        contentMd: verification.rewrittenBody
          ? sanitizeSectionMarkdown(verification.rewrittenBody)
          : section.contentMd,
        verdict: 'verified',
        verificationNotes: null,
      };
    }

    if (verification.verdict === 'unverified') {
      const followUpContext = await this.attemptFollowUp(
        section,
        context,
        repositoryId,
        verification.notes ?? null,
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
            overrideModel: options?.overrideModel,
          })
        ).text;

        const followUpVerification = await this.parseVerification(
          followUpResponse,
          section,
          'Follow-up verification',
          options,
        );

        return {
          ...section,
          contentMd: sanitizeSectionMarkdown(
            followUpVerification.rewrittenBody || section.contentMd,
          ),
          verdict: followUpVerification.verdict,
          verificationNotes: followUpVerification.notes ?? null,
        };
      }
    }

    return {
      ...section,
      contentMd: sanitizeSectionMarkdown(
        verification.rewrittenBody || section.contentMd,
      ),
      verdict: verification.verdict,
      verificationNotes: verification.notes ?? null,
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
    options?: { overrideModel?: string },
  ): Promise<VerificationResponse> {
    try {
      const raw = await extractJsonFromLlmText<VerificationResponse>(
        response,
        isValidVerificationResponse,
      );
      const verdict = (
        typeof raw.verdict === 'string'
          ? raw.verdict.toLowerCase().trim()
          : 'verified'
      ) as 'verified' | 'unverified' | 'removed';
      return {
        verdict,
        rewrittenBody:
          typeof raw.rewrittenBody === 'string' ? raw.rewrittenBody : null,
        notes: typeof raw.notes === 'string' ? raw.notes : null,
      };
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
            { tier: 'strong', overrideModel: options?.overrideModel },
          )
        ).text;

        const rawCorrected =
          await extractJsonFromLlmText<VerificationResponse>(
            corrected,
            isValidVerificationResponse,
          );
        const verdict = (
          typeof rawCorrected.verdict === 'string'
            ? rawCorrected.verdict.toLowerCase().trim()
            : 'verified'
        ) as 'verified' | 'unverified' | 'removed';
        return {
          verdict,
          rewrittenBody:
            typeof rawCorrected.rewrittenBody === 'string'
              ? rawCorrected.rewrittenBody
              : null,
          notes:
            typeof rawCorrected.notes === 'string' ? rawCorrected.notes : null,
        };
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

    const topicMatch = notes.match(
      /(?:about|regarding|for|lacks|missing|evidence\s+on)\s+([^.]+)/i,
    );
    const focusedTopic = topicMatch
      ? topicMatch[1].trim()
      : `${section.title}: ${notes.slice(0, 100).trim()}`;

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
