import { DraftSection } from '../dto/architecture-draft.dto';

export interface SectionGraphReference {
  key: string;
  title: string;
  mermaidSource: string | null;
}

/**
 * Builds the markdown body for the dedicated "Dependency Graph" section.
 * The section's own `diagramMermaid` holds the repository-wide overview
 * diagram, while the body aggregates the per-section diagrams as mermaid
 * code blocks.
 */
export function buildDependencyGraphSectionContent(
  sections: DraftSection[],
): string {
  const lines: string[] = [];

  lines.push('## Dependency Graph');
  lines.push('');
  lines.push(
    '> This section aggregates the module dependency graphs produced for each part of the document. Each graph below corresponds to a section above and only uses evidenced modules and relationships.',
  );

  const graphSections = sections.filter(
    (s) =>
      s.verdict !== 'removed' &&
      s.diagramMermaid &&
      s.key !== 'dependency-graph',
  );

  if (graphSections.length === 0) {
    lines.push('');
    lines.push(
      '_No dependency graphs could be produced from the available evidence._',
    );
    return lines.join('\n');
  }

  for (const section of graphSections) {
    lines.push('');
    lines.push(`### ${section.title}`);
    lines.push('');
    lines.push('```mermaid');
    lines.push(section.diagramMermaid!.trim());
    lines.push('```');
  }

  return lines.join('\n');
}
