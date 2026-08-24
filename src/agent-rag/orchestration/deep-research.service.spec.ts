import { Test, TestingModule } from '@nestjs/testing';
import { DeepResearchService } from './deep-research.service';
import { GeminiService } from '../../gemini/gemini.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';
import { ContextBuilderService } from './context-builder.service';
import { SynthesizerService } from './synthesizer.service';
import { FollowupGeneratorService } from './followup-generator.service';
import { CitationSnippetService } from '../retrieval/citation-snippet.service';

describe('DeepResearchService', () => {
  let service: DeepResearchService;
  let geminiMock: jest.Mocked<Partial<GeminiService>>;
  let plannerMock: jest.Mocked<Partial<PlannerService>>;
  let executorMock: jest.Mocked<Partial<ExecutorService>>;
  let contextBuilderMock: jest.Mocked<Partial<ContextBuilderService>>;
  let synthesizerMock: jest.Mocked<Partial<SynthesizerService>>;
  let followupGeneratorMock: jest.Mocked<Partial<FollowupGeneratorService>>;
  let snippetsMock: jest.Mocked<Partial<CitationSnippetService>>;

  beforeEach(async () => {
    geminiMock = {
      generateContent: jest
        .fn()
        .mockResolvedValue(
          '["How is auth started?", "How are tokens generated?"]',
        ),
    };
    plannerMock = {
      plan: jest.fn().mockResolvedValue({ functionCalls: [] }),
    };
    executorMock = {
      execute: jest.fn().mockResolvedValue({
        hits: [
          {
            nodeId: 'node-1',
            type: 'Function',
            filePath: 'src/auth.ts',
            lineRange: null,
            content: 'function authenticate() {}',
            score: 0.9,
            source: 'vector',
          },
        ],
        toolsUsed: ['hybrid_search'],
        webResults: [],
      }),
    };
    contextBuilderMock = {
      build: jest.fn().mockReturnValue({
        contextText: 'Formatted context',
        selectedHits: [
          {
            nodeId: 'node-1',
            type: 'Function',
            filePath: 'src/auth.ts',
            lineRange: null,
            content: 'function authenticate() {}',
            score: 0.9,
            source: 'vector',
          },
        ],
      }),
    };
    synthesizerMock = {
      synthesizeStream: jest.fn().mockImplementation(async function* () {
        yield { type: 'token', data: 'Deep ' };
        yield { type: 'token', data: 'answer' };
        yield {
          type: 'done',
          data: {
            answer: 'Deep answer',
            citations: [
              { filePath: 'src/auth.ts', lineRange: null, nodeId: 'node-1' },
            ],
          },
        };
      }),
    };
    followupGeneratorMock = {
      generate: jest.fn().mockResolvedValue(['Next step 1?', 'Next step 2?']),
    };
    snippetsMock = {
      enrich: jest.fn().mockImplementation(async (_id, citations) => citations),
      merge: jest.fn().mockImplementation((fromSynth) => fromSynth),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepResearchService,
        { provide: GeminiService, useValue: geminiMock },
        { provide: PlannerService, useValue: plannerMock },
        { provide: ExecutorService, useValue: executorMock },
        { provide: ContextBuilderService, useValue: contextBuilderMock },
        { provide: SynthesizerService, useValue: synthesizerMock },
        { provide: FollowupGeneratorService, useValue: followupGeneratorMock },
        { provide: CitationSnippetService, useValue: snippetsMock },
      ],
    }).compile();

    service = module.get<DeepResearchService>(DeepResearchService);
  });

  it('decomposes questions and emits mode, progress, citation, token, done, and followups SSE events', async () => {
    const events: Array<{ event: string; data: unknown }> = [];

    for await (const chunk of service.runStream({
      repositoryId: 'repo-1',
      question: 'Explain auth flow deeply',
    })) {
      events.push(chunk);
    }

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('mode');
    expect(eventTypes).toContain('progress');
    expect(eventTypes).toContain('scanning');
    expect(eventTypes).toContain('citation');
    expect(eventTypes).toContain('token');
    expect(eventTypes).toContain('done');
    expect(eventTypes).toContain('followups');

    const modeEvent = events.find((e) => e.event === 'mode');
    expect(modeEvent?.data).toBe('deep');

    const progressEvents = events.filter((e) => e.event === 'progress');
    expect(progressEvents).toHaveLength(2);
  });
});
