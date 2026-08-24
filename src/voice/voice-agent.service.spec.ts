import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PiperTTSProvider } from './providers/piper-tts.provider';
import { VoiceAgentService, VoiceSessionCallbacks } from './voice-agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';
import { AgentSessionStore } from '../agent-rag/session/agent-session.store';
import {
  ConversationPersistenceService,
} from '../agent-rag/persistence/conversation-persistence.service';

// uuid ships ESM-only; stub it so the transitive import in
// agent-session.store.ts stays CommonJS-parseable under Jest
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('VoiceAgentService — conversation thread persistence', () => {
  let service: VoiceAgentService;
  let sessionStoreMock: any;
  let persistenceMock: any;
  let agentLoopMock: any;
  let callbacks: VoiceSessionCallbacks;

  const doneChunk = (answer: string) => ({
    event: 'done',
    data: {
      answer,
      citations: [],
      citedNodeIds: [],
      toolsUsed: [],
    },
  });

  beforeEach(async () => {
    // Never spawn the real piper binary
    jest
      .spyOn(PiperTTSProvider.prototype, 'speak')
      .mockResolvedValue(undefined);

    sessionStoreMock = {
      create: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        repositoryId: 'repo-1',
        userId: 'user-1',
        turns: [],
        updatedAt: new Date().toISOString(),
      }),
      get: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        repositoryId: 'repo-1',
        userId: 'user-1',
        turns: [],
        updatedAt: new Date().toISOString(),
      }),
      appendTurn: jest.fn().mockResolvedValue(null),
      setThread: jest.fn().mockResolvedValue(null),
      recentCitedNodeIds: jest.fn().mockReturnValue([]),
    };

    persistenceMock = {
      persistTurn: jest
        .fn()
        .mockImplementation((input: { threadId?: string }) =>
          Promise.resolve({ threadId: input.threadId ?? 'thread-1' }),
        ),
    };

    agentLoopMock = {
      runStream: jest.fn().mockImplementation(() =>
        (function* generate() {
          yield { event: 'token', data: 'Answer' };
          yield doneChunk('First answer.');
        })(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceAgentService,
        {
          provide: PrismaService,
          useValue: {
            repository: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'repo-1',
                userId: 'user-1',
                organizationId: null,
              }),
            },
            organizationMember: { findFirst: jest.fn() },
          },
        },
        { provide: AgentLoopService, useValue: agentLoopMock },
        { provide: AgentSessionStore, useValue: sessionStoreMock },
        {
          provide: ConversationPersistenceService,
          useValue: persistenceMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({
                  'voice.whisperBin': 'whisper-cli',
                  'voice.whisperModel': 'model',
                  'voice.sampleRate': 16000,
                  'voice.piperBin': 'piper',
                  'voice.piperModel': 'voice.onnx',
                })[key],
            ),
          },
        },
      ],
    }).compile();

    service = module.get<VoiceAgentService>(VoiceAgentService);

    callbacks = {
      onState: jest.fn(),
      onSttPartial: jest.fn(),
      onSttFinal: jest.fn(),
      onAgentToken: jest.fn(),
      onAgentDone: jest.fn(),
      onTtsAudio: jest.fn(),
      onError: jest.fn(),
      onPersisted: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists the first voice turn into a new conversation thread', async () => {
    const session = await service.createSession(
      'sock-1',
      'user-1',
      'repo-1',
      callbacks,
    );

    await session.processTextInput('What does auth do?');

    expect(persistenceMock.persistTurn).toHaveBeenCalledTimes(1);
    expect(persistenceMock.persistTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        repositoryId: 'repo-1',
        threadId: undefined,
        question: 'What does auth do?',
        answer: 'First answer.',
      }),
    );
    expect(session.threadId).toBe('thread-1');
    expect(sessionStoreMock.setThread).toHaveBeenCalledWith(
      'session-1',
      'thread-1',
    );
    expect(callbacks.onPersisted).toHaveBeenCalledWith({
      agentSessionId: 'session-1',
      threadId: 'thread-1',
    });
  });

  it('appends later turns to the SAME thread instead of forking new ones', async () => {
    const session = await service.createSession(
      'sock-1',
      'user-1',
      'repo-1',
      callbacks,
    );

    await session.processTextInput('First question?');
    await session.processTextInput('Second question?');

    expect(persistenceMock.persistTurn).toHaveBeenCalledTimes(2);
    const secondCall =
      persistenceMock.persistTurn.mock.calls[1][0] as Record<string, unknown>;
    expect(secondCall.threadId).toBe('thread-1');
    expect(session.threadId).toBe('thread-1');
    expect(sessionStoreMock.appendTurn).toHaveBeenCalledTimes(2);
  });

  it('continues an existing thread when one is provided at start', async () => {
    const session = await service.createSession(
      'sock-1',
      'user-1',
      'repo-1',
      callbacks,
      { threadId: 'existing-thread' },
    );

    await session.processTextInput('Continue this conversation?');

    expect(session.threadId).toBe('existing-thread');
    expect(persistenceMock.persistTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'existing-thread' }),
    );
    // No rebind needed — thread was already bound
    expect(callbacks.onPersisted).toHaveBeenCalledWith({
      agentSessionId: 'session-1',
      threadId: 'existing-thread',
    });
  });
});
