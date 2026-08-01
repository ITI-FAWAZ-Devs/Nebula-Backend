/**
 * Maps Graphify opaque `sourceLocation` values into a citation-safe lineRange.
 * Accepts forms like "L42", "42", "10-20", "L10-L20". Returns null if unparseable.
 */
export function normalizeSourceLocation(
  sourceLocation?: string | null,
): string | null {
  if (!sourceLocation || typeof sourceLocation !== 'string') {
    return null;
  }

  const trimmed = sourceLocation.trim();
  if (!trimmed) {
    return null;
  }

  const rangeMatch = trimmed.match(/^L?(\d+)\s*[-–:]\s*L?(\d+)$/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start > 0 && end >= start) {
      return start === end ? String(start) : `${start}-${end}`;
    }
    return null;
  }

  const singleMatch = trimmed.match(/^L?(\d+)$/i);
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    return line > 0 ? String(line) : null;
  }

  return null;
}

export function buildGraphSummary(params: {
  type: string;
  name: string;
  filePath: string | null;
  lineRange: string | null;
}): string {
  const location = params.filePath
    ? params.lineRange
      ? `${params.filePath}:${params.lineRange}`
      : params.filePath
    : 'unknown';
  return `${params.type} ${params.name} @ ${location}`;
}
