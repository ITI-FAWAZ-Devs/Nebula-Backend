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
    return JSON.parse(jsonMatch[1].trim());
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return JSON.parse(arrayMatch[0]);
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  return JSON.parse(text.trim());
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
