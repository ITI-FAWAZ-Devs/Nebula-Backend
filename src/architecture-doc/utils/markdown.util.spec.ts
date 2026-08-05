import { sanitizeSectionMarkdown } from './markdown.util';

describe('sanitizeSectionMarkdown', () => {
  it('demotes top-level headings to H2', () => {
    const result = sanitizeSectionMarkdown(
      '# Authentication\n\n## Subsection\n\n### Detail',
    );
    expect(result).toContain('## Authentication');
    expect(result).toContain('## Subsection');
    expect(result).toContain('### Detail');
  });

  it('strips a single enclosing markdown code fence', () => {
    const result = sanitizeSectionMarkdown(
      '```markdown\n## Overview\n\nText here.\n```',
    );
    expect(result).toContain('## Overview');
    expect(result).not.toContain('```markdown');
  });

  it('balances an unclosed code fence', () => {
    const result = sanitizeSectionMarkdown(
      '### Login flow\n\n```typescript\nexport const login = () => {};\n',
    );
    const fences = result.match(/^```/gm) ?? [];
    expect(fences).toHaveLength(2);
  });

  it('strips conversational lead-in filler', () => {
    const result = sanitizeSectionMarkdown(
      'Here is the section content:\n\n### Overview\n\nText.',
    );
    expect(result).not.toContain('Here is the section content');
    expect(result).toContain('### Overview');
  });

  it('collapses runs of blank lines', () => {
    const result = sanitizeSectionMarkdown('## Overview\n\n\n\n\nText.');
    expect(result).toBe('## Overview\n\nText.\n');
  });

  it('trims trailing whitespace and normalizes the ending newline', () => {
    const result = sanitizeSectionMarkdown('## Overview\nText.   \n\n  \n');
    expect(result).toBe('## Overview\nText.\n');
  });

  it('keeps inline citations and fenced snippets intact', () => {
    const result = sanitizeSectionMarkdown(
      '### Login flow\n\nThe login flow is defined in [src/auth.ts].\n\n```typescript\nexport const login = () => {};\n```\n',
    );
    expect(result).toContain('[src/auth.ts]');
    expect(result).toContain('```typescript');
    expect(result).toContain('export const login = () => {};');
  });
});
