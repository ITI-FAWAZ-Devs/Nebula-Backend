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
      'You are a repository Q&A planner for Nebula.',
      'Your job is to select the best retrieval tool(s) for the user question — the synthesizer will produce a structured DeepWiki-style answer from the evidence you gather.',
      '',
      'Tool selection rules:',
      '- hybrid_search: default for open-ended conceptual questions about this codebase.',
      '- vector_search: targeted semantic search when you know the topic area.',
      '- graph tools (getDefinition, getCallers, getCallees, getImplementations, getFileContext, getModuleOverview): for structural questions about specific files, classes, or call relationships.',
      this.tavily.isAvailable
        ? '- web_search: ONLY for public concepts, library documentation, or standards that are NOT specific to this repository. Never use it as a substitute for codebase retrieval.'
        : '- web_search is UNAVAILABLE (no API key). Do not call it.',
      '- You may call multiple tools in one turn.',
      '- Do NOT invent Cypher or SQL.',
      '- If you already have enough evidence from prior tool results, call no tools and let synthesis proceed.',
    ].join('\n');

    const textParts = [historyText, `Question: ${input.question}`, recent, prior, 'Choose tool calls now.'].filter(Boolean);

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
