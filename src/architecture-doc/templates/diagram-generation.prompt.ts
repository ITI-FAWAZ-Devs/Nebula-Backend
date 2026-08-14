import {
  FileRelationship,
  ModuleCluster,
} from '../dto/hybrid-retrieval-context.dto';
import { DraftSection } from '../dto/architecture-draft.dto';

const MAX_RELATIONSHIPS = 80;
const MAX_CLUSTERS = 30;
const MAX_SECTION_SUMMARY_LENGTH = 200;

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, '#quot;').replace(/\n/g, ' ').trim();
}

function truncateWithCount<T>(items: T[], max: number): { items: T[]; omitted: number } {
  if (items.length <= max) return { items, omitted: 0 };
  return { items: items.slice(0, max), omitted: items.length - max };
}

function dedupeRelationships(relationships: FileRelationship[]): FileRelationship[] {
  const seen = new Set<string>();
  const result: FileRelationship[] = [];
  for (const r of relationships) {
    const key = `${r.fromFilePath}::${r.toFilePath}::${r.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

export function buildDiagramGenerationPrompt(
  relationships: FileRelationship[],
  clusters: ModuleCluster[],
  sections: DraftSection[],
  focus?: string,
): string {
  const dedupedRelationships = dedupeRelationships(relationships ?? []);
  const { items: cappedRelationships, omitted: omittedRelationships } =
    truncateWithCount(dedupedRelationships, MAX_RELATIONSHIPS);
  const { items: cappedClusters, omitted: omittedClusters } =
    truncateWithCount(clusters ?? [], MAX_CLUSTERS);

  const relationshipList =
    cappedRelationships
      .map((r) => `- ${r.fromFilePath} -> ${r.toFilePath} (${r.type})`)
      .join('\n') +
    (omittedRelationships > 0
      ? `\n- ...and ${omittedRelationships} more relationship(s), omitted for brevity`
      : '');

  const clusterList =
    cappedClusters
      .map((c) => `- ${c.name}: ${c.filePaths.join(', ')}`)
      .join('\n') +
    (omittedClusters > 0
      ? `\n- ...and ${omittedClusters} more cluster(s), omitted for brevity`
      : '');

  const sectionSummaries = (sections ?? [])
    .map((s) => {
      const excerpt =
        s.contentMd.length > MAX_SECTION_SUMMARY_LENGTH
          ? `${s.contentMd.substring(0, MAX_SECTION_SUMMARY_LENGTH).trim()}...`
          : s.contentMd;
      return `- ${s.title}: ${excerpt}`;
    })
    .join('\n');

  const focusBlock = focus
    ? `\n## Focus\nThis diagram describes only the "${escapeMermaidLabel(
        focus,
      )}" part of the document. Include only modules and relationships relevant to that part; omit everything else, even if it appears in the evidence below.\n`
    : '';

  return `You are an architecture diagram generator. Produce a single Mermaid diagram representing the repository's module architecture, using ONLY the evidenced modules and relationships below. Do not infer, guess, or invent anything not explicitly present in the evidence.
${focusBlock}
## File relationships
${relationshipList || 'No relationships available'}

## Module clusters
${clusterList || 'No clusters available'}

## Section summaries
${sectionSummaries || 'No sections available'}

## Instructions
1. Output a single Mermaid diagram, either "flowchart TD" or "graph TD".
2. Include only modules/nodes and edges that appear explicitly in the evidence above. If the evidence is empty or insufficient, output a minimal valid diagram with a single note node saying "No evidence available" rather than fabricating content.
3. Node IDs must be short, unique, alphanumeric identifiers (e.g. n1, n2, authService) — never use raw file paths or slashes as node IDs.
4. Give each node a human-readable label derived from the file path or module name, wrapped in quotes, e.g. n1["auth/login.ts"]. Escape any double quotes inside labels.
5. Where module clusters are provided, group their member nodes into a Mermaid subgraph named after the cluster.
6. Represent each relationship as a directed edge between the corresponding nodes. If the relationship type is meaningful (e.g. "imports", "extends", "calls"), label the edge with it, e.g. n1 -->|imports| n2.
7. Do not duplicate edges, do not create self-loops unless explicitly evidenced, and do not add styling, colors, click handlers, or comments.
8. Keep the diagram readable: prefer concise labels over full paths, and do not exceed roughly 40 nodes — if there are more evidenced modules than that, include only the most connected ones.
9. Return ONLY the raw Mermaid diagram source code, starting directly with "flowchart TD" or "graph TD".
10. Do NOT wrap the output in markdown code fences (no \`\`\`mermaid blocks) and do NOT add any prose, explanation, or trailing text before or after the diagram.`;
}