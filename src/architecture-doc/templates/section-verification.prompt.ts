import { DraftSection } from '../dto/architecture-draft.dto';
import { HybridRetrievalContext } from '../dto/hybrid-retrieval-context.dto';

export function buildSectionVerificationPrompt(
  section: DraftSection,
  context: HybridRetrievalContext,
): string {
  const fileList = context.files
    .map((f) => `- ${f.filePath}${f.description ? `: ${f.description}` : ''}`)
    .join('\n');

  const codeEvidence = context.files
    .filter((f) => f.codeContent || f.codeLoadError)
    .map((f) => {
      const label = `- ${f.filePath}${f.description ? `: ${f.description}` : ''}`;
      if (f.codeLoadError) {
        return `${label}\n[code unavailable: ${f.codeLoadError}]`;
      }
      return `${label}\n\`\`\`\n${f.codeContent}\n\`\`\``;
    })
    .join('\n');

  return `You are an architecture documentation verifier. Independently verify every claim and citation in the section below against the provided evidence.

Section title: ${section.title}
Section content:
${section.contentMd}

Cited files: ${section.sourceFiles.join(', ') || 'None'}

Available evidence files:
${fileList || 'No files available'}

Source code evidence:
${codeEvidence || 'No source code available'}

Instructions:
1. Check every material claim in the section against the evidence.
2. Check every cited file path exists in the evidence file list.
3. Check every material claim and citation against the provided source code; the code is authoritative for symbol names, behaviors, and flows.
4. For each claim, determine if it is supported, unsupported, or unverifiable.
5. If a claim contradicts the provided source code, it must be removed or the section marked unverified.
6. If a citation does not exist in the evidence, it must be rejected.
7. Do not treat [code unavailable] files as evidence of implementation details; rely only on their descriptions.

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
