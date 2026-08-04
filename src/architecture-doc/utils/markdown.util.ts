/**
 * Normalizes a generated section's Markdown so it renders consistently inside
 * the assembled architecture document: demotes top-level headings (the section
 * title owns H1), balances code fences, strips LLM lead-in filler, and cleans
 * whitespace.
 */
export function sanitizeSectionMarkdown(content: string): string {
  let md = content.replace(/\r\n/g, '\n').trim();

  const enclosedFence = md.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (enclosedFence) {
    md = enclosedFence[1].trim();
  }

  md = md.replace(
    /^(?:here(?:'s| is)|below is|the following is)\s+(?:the\s+)?[^\n]{0,60}[:：]\s*\n/im,
    '',
  );

  md = md.replace(/^# +/gm, '## ');

  const fenceCount = (md.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    md += '\n```';
  }

  md = md.replace(/\n{3,}/g, '\n\n');

  md = md
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();

  return `${md}\n`;
}
