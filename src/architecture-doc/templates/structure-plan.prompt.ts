import { HybridRetrievalContext } from '../dto/hybrid-retrieval-context.dto';

export function buildStructurePlanPrompt(
  repositoryName: string,
  repositoryOwner: string,
  context: HybridRetrievalContext,
): string {
  const fileList = context.files
    .map((f) => `- ${f.filePath}${f.description ? `: ${f.description}` : ''}`)
    .join('\n');

  const relationshipList = context.relationships
    .map((r) => `- ${r.fromFilePath} → ${r.toFilePath} (${r.type})`)
    .join('\n');

  return `You are an architecture documentation planner. Analyze the repository evidence below and propose a repository-specific set of documentation sections.

Repository: ${repositoryOwner}/${repositoryName}

Evidence files:
${fileList || 'No files available'}

File relationships:
${relationshipList || 'No relationships available'}

Module clusters:
${context.moduleClusters.map((c) => `- ${c.name}: ${c.filePaths.join(', ')}`).join('\n') || 'No clusters available'}

Instructions:
1. Analyze the evidence to identify the repository's key architectural concerns.
2. Propose a set of sections that would best document this specific repository's architecture.
3. Each section must have a unique kebab-case key, a human-readable title, a one-line purpose, and a focused retrieval topic.
4. Do NOT propose template-only sections that are not supported by the evidence.
5. Return a JSON array of SectionPlan objects.

Return ONLY a JSON array in this exact format:
[
  {
    "key": "section-key",
    "title": "Section Title",
    "purpose": "One-line description of what this section covers",
    "retrievalTopic": "focused topic for per-section retrieval"
  }
]

If no evidence is available, return an empty array: []`;
}
