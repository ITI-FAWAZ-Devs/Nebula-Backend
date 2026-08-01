import { Injectable } from '@nestjs/common';
import { AGENT_CONTEXT_TOKEN_BUDGET } from '../agent-rag.constants';
import { RetrievalHit } from '../dto/retrieval-hit.dto';

@Injectable()
export class ContextBuilderService {
  /**
   * Dedupe by nodeId, sort by score, truncate to token budget.
   * No LLM call — pure service.
   */
  build(
    hits: RetrievalHit[],
    tokenBudget = AGENT_CONTEXT_TOKEN_BUDGET,
  ): { contextText: string; selectedHits: RetrievalHit[] } {
    const deduped = this.dedupe(hits).sort((a, b) => b.score - a.score);
    const selected: RetrievalHit[] = [];
    let tokens = 0;

    for (const hit of deduped) {
      const block = this.formatHit(hit);
      const blockTokens = this.estimateTokens(block);
      if (selected.length > 0 && tokens + blockTokens > tokenBudget) {
        break;
      }
      selected.push(hit);
      tokens += blockTokens;
    }

    const contextText = selected.map((h) => this.formatHit(h)).join('\n\n');
    return { contextText, selectedHits: selected };
  }

  private dedupe(hits: RetrievalHit[]): RetrievalHit[] {
    const byId = new Map<string, RetrievalHit>();
    for (const hit of hits) {
      const existing = byId.get(hit.nodeId);
      if (!existing || hit.score > existing.score) {
        byId.set(hit.nodeId, hit);
      }
    }
    return [...byId.values()];
  }

  private formatHit(hit: RetrievalHit): string {
    const cite = hit.filePath
      ? hit.lineRange
        ? `${hit.filePath}:${hit.lineRange}`
        : hit.filePath
      : hit.nodeId;
    return `[${cite}] (${hit.type}, score=${hit.score.toFixed(2)}, source=${hit.source})\n${hit.content}`;
  }

  /** ~4 characters per token heuristic. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
