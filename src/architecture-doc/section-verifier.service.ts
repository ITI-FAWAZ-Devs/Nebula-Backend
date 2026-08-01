import { Injectable, Logger } from '@nestjs/common';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { GeminiService } from '../gemini/gemini.service';
import { DraftSection } from './dto/architecture-draft.dto';
import { HybridRetrievalContext } from './dto/hybrid-retrieval-context.dto';
import { buildSectionVerificationPrompt } from './templates/section-verification.prompt';
import { extractJsonFromLlmText } from './utils/llm-response.util';

interface VerificationResponse {
  verdict: 'verified' | 'unverified' | 'removed';
  rewrittenBody: string | null;
  notes: string | null;
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
    private readonly gemini: GeminiService,
  ) {}

  async verify(
    section: DraftSection,
    context: HybridRetrievalContext,
    repositoryId: string,
  ): Promise<DraftSection> {
    const prompt = buildSectionVerificationPrompt(section, context);
    const response = await this.gemini.generateContent(prompt);

    const verification = await extractJsonFromLlmText<VerificationResponse>(
      response,
      (obj): obj is VerificationResponse => {
        if (typeof obj !== 'object' || obj === null) return false;
        const v = obj as VerificationResponse;
        return (
          (v.verdict === 'verified' || v.verdict === 'unverified' || v.verdict === 'removed') &&
          (v.rewrittenBody === null || typeof v.rewrittenBody === 'string') &&
          (v.notes === null || typeof v.notes === 'string')
        );
      },
    );

    if (verification.verdict === 'verified' && verification.rewrittenBody) {
      return {
        ...section,
        contentMd: verification.rewrittenBody,
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
      );

      if (followUpContext) {
        const followUpPrompt = buildSectionVerificationPrompt(
          section,
          followUpContext,
        );
        const followUpResponse = await this.gemini.generateContent(followUpPrompt);

        const followUpVerification = await extractJsonFromLlmText<VerificationResponse>(
          followUpResponse,
          (obj): obj is VerificationResponse => {
            if (typeof obj !== 'object' || obj === null) return false;
            const v = obj as VerificationResponse;
            return (
              (v.verdict === 'verified' || v.verdict === 'unverified' || v.verdict === 'removed') &&
              (v.rewrittenBody === null || typeof v.rewrittenBody === 'string') &&
              (v.notes === null || typeof v.notes === 'string')
            );
          },
        );

        return {
          ...section,
          contentMd: followUpVerification.rewrittenBody || section.contentMd,
          verdict: followUpVerification.verdict,
          verificationNotes: followUpVerification.notes,
        };
      }
    }

    return {
      ...section,
      contentMd: verification.rewrittenBody || section.contentMd,
      verdict: verification.verdict,
      verificationNotes: verification.notes,
    };
  }

  private async attemptFollowUp(
    section: DraftSection,
    context: HybridRetrievalContext,
    repositoryId: string,
    notes: string | null,
  ): Promise<HybridRetrievalContext | null> {
    if (!notes) return null;

    const topicMatch = notes.match(/(?:about|regarding|for)\s+([^.]+)/i);
    if (!topicMatch) return null;

    const focusedTopic = topicMatch[1].trim();

    try {
      return await this.hybridRetriever.retrieve(repositoryId, {
        topic: focusedTopic,
      });
    } catch (error) {
      this.logger.warn(
        `Follow-up retrieval failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
