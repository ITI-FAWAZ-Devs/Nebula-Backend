import { FileRelationship, ModuleCluster } from '../dto/hybrid-retrieval-context.dto';
import { DraftSection } from '../dto/architecture-draft.dto';

export function buildDiagramGenerationPrompt(
  relationships: FileRelationship[],
  clusters: ModuleCluster[],
  sections: DraftSection[],
): string {
  const relationshipList = relationships
    .map((r) => `- ${r.fromFilePath} → ${r.toFilePath} (${r.type})`)
    .join('\n');

  const clusterList = clusters
    .map((c) => `- ${c.name}: ${c.filePaths.join(', ')}`)
    .join('\n');

  const sectionSummaries = sections
    .map((s) => `- ${s.title}: ${s.contentMd.substring(0, 200)}...`)
    .join('\n');

  return `You are an architecture diagram generator. Create a Mermaid diagram representing the repository's module architecture using ONLY the evidenced modules and relationships.

File relationships:
${relationshipList || 'No relationships available'}

Module clusters:
${clusterList || 'No clusters available'}

Section summaries:
${sectionSummaries || 'No sections available'}

Instructions:
1. Generate a Mermaid flowchart TD or graph TD diagram.
2. Only include modules/nodes that appear in the evidence above.
3. Use meaningful labels for each node.
4. Show relationships between modules using arrows.
5. Do NOT invent modules or relationships not present in the evidence.

Return ONLY the Mermaid diagram source code, starting with "flowchart TD" or "graph TD".`;
}
