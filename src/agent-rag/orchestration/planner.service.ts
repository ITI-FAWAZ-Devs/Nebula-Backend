import { Injectable } from '@nestjs/common';
import { Content } from '@google/generative-ai';
import { GeminiService, GeminiFunctionCall } from '../../gemini/gemini.service';
import { TavilySearchService } from '../retrieval/tavily-search.service';
import { AGENT_TOOL_DECLARATIONS } from './tool-schemas';

export interface PlannerInput {
  question: string;
  recentNodeIds?: string[];
  priorToolResultsSummary?: string;
  conversationHistory?: { q: string; a: string }[];
}

@Injectable()
export class PlannerService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly tavily: TavilySearchService,
  ) {}

  async plan(input: PlannerInput): Promise<{
    text?: string;
    functionCalls: GeminiFunctionCall[];
  }> {
    let historyText = '';
    if (input.conversationHistory && input.conversationHistory.length > 0) {
      const formattedTurns = input.conversationHistory.map(
        (turn) => `User: ${turn.q}\nAssistant: ${turn.a}`,
      );
      historyText = `Prior conversation history:\n${formattedTurns.join('\n\n')}`;
      if (historyText.length > 2000) {
        historyText = `Prior conversation history (truncated):\n${historyText.slice(-2000)}`;
      }
    }

    const recent =
      input.recentNodeIds && input.recentNodeIds.length > 0
        ? `Recently discussed entities (nodeIds): ${input.recentNodeIds.join(', ')}`
        : 'No recently discussed entities.';

    const prior = input.priorToolResultsSummary
      ? `Prior tool results this turn:\n${input.priorToolResultsSummary}`
      : 'No prior tool results this turn.';

    const systemInstruction = [
      'You are the retrieval planner for a repository Q&A agent.',
      'A separate synthesizer will write the final grounded answer from the evidence you gather — your ONLY job is to select tools and craft precise arguments. You never answer the user directly.',
      '',
      '## Decision guide — match the question intent:',
      '- Open-ended "how does X work?", comparisons, architecture walkthroughs → hybrid_search (best default, one call covers a lot).',
      '- Known topic, want candidate files quickly → vector_search with a short keyword phrase.',
      '- "Who calls X?" / "who consumes X?" / "what is affected by X?" → getCallers on X\'s nodeId.',
      '- "What does X call / depend on?" → getCallees.',
      '- "Which classes implement interface X?" / "what does Y extend?" → getImplementations.',
      '- "What is inside file X?" → getFileContext with that exact filePath.',
      '- "How does module/directory X fit in?" / dependency structure → getModuleOverview.',
      '- Turn a bare symbol name into an exact nodeId first → getDefinition (nodeId OR name+type), then traverse.',
      this.tavily.isAvailable
        ? '- External library behavior or public concepts not owned by this repo → web_search. Never for codebase facts.'
        : '- web_search is UNAVAILABLE (no API key configured). Do not call it.',
      '',
      '## Argument quality rules:',
      '- Semantic queries (vector_search, hybrid_search) must be short keyword phrases: "websocket auth guard", NOT the user\'s full sentence.',
      '- Expand pronouns and vague references using conversation history and recently discussed entities before writing a query.',
      '- Graph tools need EXACT nodeIds/filePaths. Take them from user text, recent entities, or earlier tool results — never guess paths.',
      '- Chain steps when needed: hybrid_search/vector_search to discover files → getDefinition/getFileContext/getCallers on those results for structural depth.',
      '',
      '## Efficiency rules:',
      '- Call 1-3 tools per turn; run independent lookups in parallel within the same turn.',
      '- Never repeat a tool call with identical arguments you already ran this turn.',
      '- If prior tool results already cover the question well, return NO function calls so synthesis can proceed.',
    ].join('\n');

    const textParts = [
      historyText,
      `User question: ${input.question}`,
      recent,
      prior,
      'Select retrieval tool calls now (or none if evidence is sufficient).',
    ].filter(Boolean);

    const contents: Content[] = [
      {
        role: 'user',
        parts: [
          {
            text: textParts.join('\n\n'),
          },
        ],
      },
    ];

    return this.gemini.generateWithTools({
      systemInstruction,
      contents,
      tools: AGENT_TOOL_DECLARATIONS,
    });
  }
}
