import { SectionPlan } from '../dto/architecture-draft.dto';
import { HybridRetrievalContext } from '../dto/hybrid-retrieval-context.dto';

export function buildSectionGenerationPrompt(
  plan: SectionPlan,
  context: HybridRetrievalContext,
): string {
  const fileList = context.files
    .map((f) => `- ${f.filePath}${f.description ? `: ${f.description}` : ''}`)
    .join('\n');

  const relationshipList = context.relationships
    .map((r) => `- ${r.fromFilePath} → ${r.toFilePath} (${r.type})`)
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

  return `You are an architecture documentation writer. Generate the following section using ONLY the provided evidence.

Section: ${plan.title}
Purpose: ${plan.purpose}

Evidence files:
${fileList || 'No files available'}

File relationships:
${relationshipList || 'No relationships available'}

Module clusters:
${context.moduleClusters.map((c) => `- ${c.name}: ${c.filePaths.join(', ')}`).join('\n') || 'No clusters available'}

Source code evidence:
${codeEvidence || 'No source code available'}

Instructions:
1. Write the section content in Markdown format.
2. Every non-trivial claim MUST cite a repository file path using [filePath] inline syntax.
3. Do NOT invent or hallucinate file paths - only cite paths from the evidence above.
4. If the evidence is insufficient, write minimal content and note the limitation.
5. Do NOT fabricate information not supported by the evidence.
6. Every non-trivial claim and citation MUST be consistent with the provided source code. The code is authoritative for symbol names, behaviors, and flows.
7. Do not invent code that is not shown. For files marked [code unavailable], rely only on the file description and never fabricate implementation details.

Return the section content as Markdown text.`;
}
