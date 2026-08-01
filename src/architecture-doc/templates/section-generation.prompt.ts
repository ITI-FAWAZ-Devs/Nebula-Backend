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

  return `You are an architecture documentation writer. Generate the following section using ONLY the provided evidence.

Section: ${plan.title}
Purpose: ${plan.purpose}

Evidence files:
${fileList || 'No files available'}

File relationships:
${relationshipList || 'No relationships available'}

Module clusters:
${context.moduleClusters.map((c) => `- ${c.name}: ${c.filePaths.join(', ')}`).join('\n') || 'No clusters available'}

Instructions:
1. Write the section content in Markdown format.
2. Every non-trivial claim MUST cite a repository file path using [filePath] inline syntax.
3. Do NOT invent or hallucinate file paths - only cite paths from the evidence above.
4. If the evidence is insufficient, write minimal content and note the limitation.
5. Do NOT fabricate information not supported by the evidence.

Return the section content as Markdown text.`;
}
