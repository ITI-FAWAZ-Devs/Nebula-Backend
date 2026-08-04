/**
 * Builds a corrective prompt that asks the LLM to re-emit a previously
 * malformed response as a single valid JSON value. Used as a self-healing
 * retry when JSON extraction fails, so the drafting pipeline keeps receiving
 * machine-parseable responses instead of dropping sections.
 */
export function buildJsonCorrectionPrompt(
  shapeDescription: string,
  invalidOutput: string,
): string {
  return `Your previous response was not valid JSON and could not be parsed. Please fix it.

Your previous response:
"""
${invalidOutput}
"""

Reproduce the same content as ${shapeDescription}.
Output ONLY the JSON value itself. Do not wrap it in markdown code fences.
Do not include any prose, explanations, or file citations such as [README.md] outside the JSON value.
Ensure every key is double-quoted, every string uses double quotes, there are no trailing commas, and booleans/null are lowercase.`;
}
