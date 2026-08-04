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
1. Write the section in Markdown. Open with a 1-3 sentence introduction, then use "###" for subsections, bullet/numbered lists, and bold for key terms. Use tables only when they genuinely clarify.
2. Ground every non-trivial claim with an inline citation using [filePath] syntax. Only cite paths from the evidence above.
3. Embed short, verbatim code snippets from the source code evidence to illustrate key APIs, flows, entry points, and data structures:
   - Copy snippet lines VERBATIM from the provided code. Never invent, reword, or synthesize code.
   - Keep each snippet to the most relevant 1-20 lines; if you skip lines in the middle, insert a comment line with "..." to indicate elision.
   - Wrap each snippet in a fenced code block. Add a language identifier matching the file extension when it is obvious (for example, \`\`\`typescript, \`\`\`python, \`\`\`go); otherwise use \`\`\`text.
   - Cite the file path with [filePath] on the line directly above or below each snippet.
   - Never include code from files marked [code unavailable].
4. Do NOT invent or hallucinate file paths or code. The source code evidence is authoritative for symbol names, behaviors, and flows.
5. If the evidence is insufficient, write minimal content and note the limitation instead of fabricating details.
6. Keep the section focused and readable (roughly 200-500 words excluding code snippets).

Return ONLY the section content as Markdown text. Do not wrap it in a markdown code fence and do not add any commentary before or after.`;
}
