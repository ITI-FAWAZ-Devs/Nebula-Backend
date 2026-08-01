import { DraftSection } from '../dto/architecture-draft.dto';
import { HybridRetrievalContext } from '../dto/hybrid-retrieval-context.dto';

export function buildSectionVerificationPrompt(
  section: DraftSection,
  context: HybridRetrievalContext,
): string {
  const fileList = context.files
    .map((f) => `- ${f.filePath}${f.description ? `: ${f.description}` : ''}`)
    .join('\n');

  return `You are an architecture documentation verifier. Independently verify every claim and citation in the section below against the provided evidence.

Section title: ${section.title}
Section content:
${section.contentMd}

Cited files: ${section.sourceFiles.join(', ') || 'None'}

Available evidence files:
${fileList || 'No files available'}

Instructions:
1. Check every material claim in the section against the evidence.
2. Check every cited file path exists in the evidence file list.
3. For each claim, determine if it is supported, unsupported, or unverifiable.
4. If a claim is unsupported, it must be removed or the section marked unverified.
5. If a citation does not exist in the evidence, it must be rejected.

Return a JSON object in this exact format:
{
  "verdict": "verified" | "unverified" | "removed",
  "rewrittenBody": "optional rewritten section body with unsupported claims removed",
  "notes": "explanation of verification outcome, null if verified"
}

If all claims are supported, set verdict to "verified" and notes to null.
If some claims are unsupported, you may rewrite the body to remove them and keep verdict "verified", or set verdict to "unverified" with notes explaining which claims lack support.
If the section cannot be grounded at all, set verdict to "removed".`;
}
