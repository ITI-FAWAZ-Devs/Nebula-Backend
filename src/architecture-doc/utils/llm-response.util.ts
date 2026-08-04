import { SectionPlan, DraftSection } from '../dto/architecture-draft.dto';

export async function extractJsonFromLlmText<T>(
  text: string,
  validator: (obj: unknown) => obj is T,
  retries = 1,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const json = parseJsonFromText(text);
      if (validator(json)) {
        return json;
      }
      throw new Error('Parsed JSON does not match expected schema');
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        continue;
      }
    }
  }

  throw lastError || new Error('Failed to extract JSON from LLM text');
}

function parseJsonFromText(text: string): unknown {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return parseJsonValue(jsonMatch[1].trim());
  }

  return parseJsonValue(text);
}

/**
 * Locates the first JSON value (object or array) embedded in arbitrary LLM
 * text and parses it. File citations such as `[README.md]` or `[src/auth.ts]`
 * must not be mistaken for JSON arrays, so candidates are delimited by
 * balanced brackets. If strict parsing fails, common LLM JSON quirks
 * (unquoted keys, trailing commas, single-quoted strings, Python-style
 * booleans/null) are repaired before giving up.
 */
function parseJsonValue(text: string): unknown {
  for (const candidate of jsonCandidates(text)) {
    for (const attempt of repairAttempts(candidate)) {
      try {
        return JSON.parse(attempt);
      } catch {
        // try the next repair of this candidate
      }
    }
  }

  throw new Error('No valid JSON value found in LLM output');
}

/**
 * Collects the first balanced `{...}` or `[...]` substring starting at each
 * opening bracket, in order of appearance. Falls back to the trimmed text when
 * no balanced brackets are present.
 */
function jsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') {
      continue;
    }
    const close = open === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j++) {
      const char = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === open) {
        depth++;
      } else if (char === close) {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }

  if (candidates.length === 0) {
    candidates.push(text.trim());
  }

  return candidates;
}

/**
 * Produces ordered repair variants of a JSON candidate: the original, a
 * cleaned variant (trailing commas removed, unquoted keys quoted, Python-style
 * literals lowercased), and a single-quoted→double-quoted variant. Each variant
 * is only added when it differs from the previous one.
 */
function repairAttempts(candidate: string): string[] {
  const attempts: string[] = [candidate];

  const cleaned = candidate
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/g, '$1"$2":')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .trim();

  if (cleaned !== candidate) {
    attempts.push(cleaned);
  }

  const singleQuoted = cleaned.replace(/'/g, '"');
  if (singleQuoted !== cleaned) {
    attempts.push(singleQuoted);
  }

  return attempts;
}

export function validateSectionPlanArray(obj: unknown): obj is SectionPlan[] {
  if (!Array.isArray(obj)) return false;
  return obj.every(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

export function validateDraftSection(obj: unknown): obj is DraftSection {
  if (typeof obj !== 'object' || obj === null) return false;
  const section = obj as DraftSection;
  return (
    typeof section.key === 'string' &&
    section.key.length > 0 &&
    typeof section.title === 'string' &&
    typeof section.contentMd === 'string' &&
    Array.isArray(section.sourceFiles) &&
    section.sourceFiles.every((f) => typeof f === 'string' && f.length > 0) &&
    (section.verdict === 'verified' ||
      section.verdict === 'unverified' ||
      section.verdict === 'removed')
  );
}

export function validateDiagramResponse(
  obj: unknown,
): obj is { mermaidSource: string; modules: string[] } {
  if (typeof obj !== 'object' || obj === null) return false;
  const diagram = obj as { mermaidSource: string; modules: string[] };
  return (
    typeof diagram.mermaidSource === 'string' &&
    diagram.mermaidSource.length > 0 &&
    (diagram.mermaidSource.startsWith('flowchart') ||
      diagram.mermaidSource.startsWith('graph')) &&
    Array.isArray(diagram.modules) &&
    diagram.modules.every((m) => typeof m === 'string' && m.length > 0)
  );
}
