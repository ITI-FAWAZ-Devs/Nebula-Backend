import { Injectable } from '@nestjs/common';
import { Content } from '@google/generative-ai';
import { GeminiService, GeminiFunctionCall } from '../../gemini/gemini.service';
import { AGENT_TOOL_DECLARATIONS } from './tool-schemas';

export interface PlannerInput {
  question: string;
  recentNodeIds?: string[];
  priorToolResultsSummary?: string;
  conversationHistory?: { q: string; a: string }[];
}

@Injectable()
export class PlannerService {
  constructor(private readonly gemini: GeminiService) {}

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
      'Select the best retrieval tool(s) for the user question.',
      'Prefer hybrid_search for open-ended questions; use graph tools for structural questions (callers, callees, implementations).',
      'You may call multiple tools. Do not invent Cypher or SQL.',
      'If you already have enough evidence from prior tool results, answer briefly that synthesis can proceed and call no tools.',
    ].join(' ');

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
