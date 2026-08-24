/**
 * Converts a grounded text answer into a version suitable for TTS playback.
 *
 * Rules:
 * - Strip inline citation markers like [path/to/file.ts:10-20] or [path/to/file.ts]
 * - Strip markdown bold/italic/code fences
 * - Replace code blocks with a short spoken label
 * - Collapse excessive whitespace
 */
export function toSpokenText(markdown: string): string {
  return (
    markdown
      // Remove fenced code blocks — say "code omitted" so the listener knows
      .replace(/```[\s\S]*?```/g, ' (see code) ')
      // Inline code: keep the text, strip backticks
      .replace(/`([^`]+)`/g, '$1')
      // Strip citation markers [file:range] or [file]
      .replace(/\[([^\]]*?)\]/g, '')
      // Strip markdown headers
      .replace(/^#{1,6}\s+/gm, '')
      // Strip bold / italic markers
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
      // Strip bullet/number list markers at line start
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Collapse blank lines / extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}
