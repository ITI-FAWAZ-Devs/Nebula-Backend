import { ContextBuilderService } from './context-builder.service';
import { RetrievalHit } from '../dto/retrieval-hit.dto';

describe('ContextBuilderService', () => {
  const builder = new ContextBuilderService();

  const hit = (
    overrides: Partial<RetrievalHit> & { nodeId: string },
  ): RetrievalHit => ({
    type: 'Chunk',
    filePath: 'a.ts',
    lineRange: null,
    content: 'x'.repeat(40),
    score: 0.5,
    source: 'vector',
    ...overrides,
  });

  it('dedupes by nodeId keeping higher score', () => {
    const { selectedHits } = builder.build(
      [
        hit({ nodeId: '1', score: 0.2, content: 'low' }),
        hit({ nodeId: '1', score: 0.9, content: 'high' }),
        hit({ nodeId: '2', score: 0.5, content: 'other' }),
      ],
      8000,
    );
    expect(selectedHits).toHaveLength(2);
    expect(selectedHits.find((h) => h.nodeId === '1')?.content).toBe('high');
  });

  it('truncates to token budget', () => {
    const hits = Array.from({ length: 20 }, (_, i) =>
      hit({
        nodeId: String(i),
        score: 1 - i * 0.01,
        content: 'word '.repeat(200),
      }),
    );
    const { selectedHits, contextText } = builder.build(hits, 100);
    expect(selectedHits.length).toBeLessThan(20);
    expect(contextText.length).toBeGreaterThan(0);
  });
});
