import {
  extractJsonFromLlmText,
  validateSectionPlanArray,
  validateDraftSection,
  validateDiagramResponse,
} from './llm-response.util';

describe('llm-response.util', () => {
  describe('extractJsonFromLlmText', () => {
    it('should parse a JSON object wrapped in a json code fence', async () => {
      const result = await extractJsonFromLlmText(
        'Here you go:\n```json\n{"verdict": "verified", "notes": null}\n```',
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
    });

    it('should parse JSON embedded in prose with file citations like [README.md]', async () => {
      const text = [
        'The section is verified.',
        'Relevant files: [README.md], [src/auth.ts], and [package.json].',
        'Please see {"verdict": "unverified", "notes": "OAuth claim lacks support."}',
      ].join('\n');
      const result = await extractJsonFromLlmText(
        text,
        (obj): obj is { verdict: string; notes: string | null } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('unverified');
      expect(result.notes).toBe('OAuth claim lacks support.');
    });

    it('should parse a JSON array appearing after file citations', async () => {
      const text =
        '[README.md], [src/main.ts] ... here is the plan: [{"key":"overview","title":"Overview","purpose":"Overview","retrievalTopic":"overview"}]';
      const result = await extractJsonFromLlmText(
        text,
        validateSectionPlanArray,
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('overview');
    });

    it('should parse a JSON object appearing before trailing file citations', async () => {
      const text =
        '{"verdict": "verified", "rewrittenBody": null, "notes": null}\n\nChecked [README.md] and [src/app.ts].';
      const result = await extractJsonFromLlmText(
        text,
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
    });

    it('should reject candidate arrays that are not valid JSON', async () => {
      await expect(
        extractJsonFromLlmText(
          'Only [README.md] and [src/auth.ts] referenced, no JSON at all.',
          validateSectionPlanArray,
        ),
      ).rejects.toThrow();
    });

    it('should repair unquoted keys', async () => {
      const result = await extractJsonFromLlmText(
        '{verdict: "verified", notes: null}',
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
    });

    it('should repair trailing commas', async () => {
      const result = await extractJsonFromLlmText(
        '{"verdict": "unverified", "notes": "x",}',
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('unverified');
    });

    it('should repair single-quoted strings', async () => {
      const result = await extractJsonFromLlmText(
        "{'verdict': 'verified', 'notes': null}",
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
    });

    it('should repair Python-style null', async () => {
      const result = await extractJsonFromLlmText(
        '{"verdict": "verified", "notes": None}',
        (obj): obj is { verdict: string; notes: string | null } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
      expect(result.notes).toBeNull();
    });

    it('should repair prose-wrapped JSON with unquoted keys and single quotes', async () => {
      const result = await extractJsonFromLlmText(
        "Checked [README.md] and [src/main.ts]. Result: {verdict: 'verified', notes: null}.",
        (obj): obj is { verdict: string } =>
          typeof obj === 'object' &&
          obj !== null &&
          typeof (obj as { verdict: string }).verdict === 'string',
      );
      expect(result.verdict).toBe('verified');
    });

    it('should reject when the parsed JSON does not match the schema', async () => {
      await expect(
        extractJsonFromLlmText(
          '{"verdict": "unknown", "notes": null}',
          (obj): obj is { verdict: string } =>
            typeof obj === 'object' &&
            obj !== null &&
            (obj as { verdict: string }).verdict === 'verified',
        ),
      ).rejects.toThrow('does not match expected schema');
    });
  });

  describe('validators', () => {
    it('validateSectionPlanArray accepts a valid plan array', () => {
      expect(
        validateSectionPlanArray([
          {
            key: 'overview',
            title: 'Overview',
            purpose: 'x',
            retrievalTopic: 'y',
          },
        ]),
      ).toBe(true);
    });

    it('validateSectionPlanArray rejects non-arrays', () => {
      expect(validateSectionPlanArray({ key: 'overview' })).toBe(false);
    });

    it('validateDraftSection accepts a valid section', () => {
      expect(
        validateDraftSection({
          key: 'overview',
          title: 'Overview',
          contentMd: '# Overview',
          sourceFiles: ['README.md'],
          verdict: 'verified',
        }),
      ).toBe(true);
    });

    it('validateDraftSection rejects a section with an invalid verdict', () => {
      expect(
        validateDraftSection({
          key: 'overview',
          title: 'Overview',
          contentMd: '# Overview',
          sourceFiles: [],
          verdict: 'mystery',
        }),
      ).toBe(false);
    });

    it('validateDiagramResponse accepts a valid diagram', () => {
      expect(
        validateDiagramResponse({
          mermaidSource: 'flowchart TD\n    A --> B',
          modules: ['A', 'B'],
        }),
      ).toBe(true);
    });

    it('validateDiagramResponse rejects a non-flowchart source', () => {
      expect(
        validateDiagramResponse({
          mermaidSource: 'sequenceDiagram\n    A->>B',
          modules: ['A'],
        }),
      ).toBe(false);
    });
  });
});
