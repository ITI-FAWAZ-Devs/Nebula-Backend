import { Test, TestingModule } from '@nestjs/testing';
import { AgentLoopService } from './agent-loop.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';
import { ContextBuilderService } from './context-builder.service';
import { SynthesizerService } from './synthesizer.service';
import { FollowupGeneratorService } from './followup-generator.service';
import { AnswerCacheService } from '../retrieval/answer-cache.service';
import { FastAnswerService } from './fast-answer.service';
import { CitationSnippetService } from '../retrieval/citation-snippet.service';

const hit = {
  nodeId: 'node-1',
  type: 'Function' as const,
  filePath: 'src/auth.ts',
  lineRange: '3-5',
  content: 'function authenticate() {}',
  score: 0.9,
  source: 'vector' as const,
};

describe('AgentLoopService', () => {
  let service: AgentLoopService;
  let plannerMock: { plan: jest.Mock };
  let executorMock: { execute: jest.Mock };
  let contextBuilderMock: { build: jest.Mock };
  let synthesizerMock: { synthesizeStream: jest.Mock };
  let followupMock: { generate: jest.Mock };
  let answerCacheMock: { get: jest.Mock; set: jest.Mock };
  let fastAnswerMock: { findFastAnswer: jest.Mock };
  let snippetsMock: { enrich: jest.Mock; merge: jest.Mock };

  beforeEach(async () => {
    plannerMock = {
      plan: jest.fn().mockResolvedValue({
        functionCalls: [{ name: 'hybrid_search', args: { query: 'auth' } }],
      }),
    };
    executorMock = {
      execute: jest.fn().mockResolvedValue({
        hits: [hit],
        toolsUsed: ['hybrid_search'],
        webResults: [],
      }),
    };
    contextBuilderMock = {
      build: jest.fn().mockReturnValue({
        contextText: 'Formatted context',
        selectedHits: [hit],
      }),
    };
    synthesizerMock = {
      synthesizeStream: jest.fn().mockImplementation(async function* () {
        yield { type: 'token', data: 'Hello ' };
        yield { type: 'token', data: 'world' };
        yield {
          type: 'done',
          data: {
            answer: 'Hello world',
            citations: [
              {
                filePath: 'src/auth.ts',
                lineRange: '3-5',
                nodeId: 'node-1',
              },
            ],
          },
        };
      }),
    };
    followupMock = { generate: jest.fn().mockResolvedValue(['Next?']) };
    answerCacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    fastAnswerMock = { findFastAnswer: jest.fn().mockResolvedValue(null) };
    snippetsMock = {
      enrich: jest.fn().mockImplementation(async (_id, citations) => citations),
      merge: jest.fn().mockImplementation((fromSynth, enriched) =>
        fromSynth.map((c: { nodeId: string }, i: number) => ({
          ...c,
          snippet: enriched[i]?.snippet,
        })),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentLoopService,
        { provide: PlannerService, useValue: plannerMock },
        { provide: ExecutorService, useValue: executorMock },
        { provide: ContextBuilderService, useValue: contextBuilderMock },
        { provide: SynthesizerService, useValue: synthesizerMock },
        { provide: FollowupGeneratorService, useValue: followupMock },
        { provide: AnswerCacheService, useValue: answerCacheMock },
        { provide: FastAnswerService, useValue: fastAnswerMock },
        { provide: CitationSnippetService, useValue: snippetsMock },
      ],
    }).compile();

    service = module.get(AgentLoopService);
  });

  it('emits scanning, then citation, then token events', async () => {
    plannerMock.plan
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'hybrid_search', args: { query: 'auth' } }],
      })
      .mockResolvedValue({ functionCalls: [] });

    const events: Array<{ event: string; data: unknown }> = [];
    for await (const chunk of service.runStream({
      repositoryId: 'repo-1',
      question: 'How does auth work?',
    })) {
      events.push(chunk);
    }

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes.indexOf('scanning')).toBeGreaterThan(-1);
    expect(eventTypes.indexOf('citation')).toBeGreaterThan(
      eventTypes.indexOf('scanning'),
    );
    expect(eventTypes.indexOf('token')).toBeGreaterThan(
      eventTypes.indexOf('citation'),
    );

    const scanning = events.find((e) => e.event === 'scanning');
    expect(scanning?.data).toEqual({
      filePath: 'src/auth.ts',
      tool: 'hybrid_search',
    });
  });

  it('emits web_source events when Tavily results are returned', async () => {
    plannerMock.plan
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'web_search', args: { query: 'electron' } }],
      })
      .mockResolvedValue({ functionCalls: [] });
    executorMock.execute.mockResolvedValue({
      hits: [hit],
      toolsUsed: ['web_search'],
      webResults: [
        {
          title: 'Electron',
          url: 'https://www.electronjs.org',
          snippet: 'multi-process',
          score: 0.9,
        },
      ],
    });

    const events: Array<{ event: string; data: unknown }> = [];
    for await (const chunk of service.runStream({
      repositoryId: 'repo-1',
      question: 'What is the multi-process model?',
    })) {
      events.push(chunk);
    }

    const web = events.find((e) => e.event === 'web_source');
    expect(web?.data).toEqual(
      expect.objectContaining({ url: 'https://www.electronjs.org' }),
    );
  });
});
