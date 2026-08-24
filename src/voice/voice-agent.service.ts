import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';
import { AgentSessionStore } from '../agent-rag/session/agent-session.store';
import { AgentCitation } from '../agent-rag/dto/retrieval-hit.dto';
import { WhisperSTTProvider } from './providers/whisper-stt.provider';
import { PiperTTSProvider } from './providers/piper-tts.provider';
import { toSpokenText } from './spoken-text.util';

export type VoiceUiState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceMessage {
  role: 'user' | 'assistant';
  text: string;
  citations: AgentCitation[];
}

/** Callbacks the gateway registers to receive events from a session */
export interface VoiceSessionCallbacks {
  onState(state: VoiceUiState): void;
  onSttPartial(text: string): void;
  onSttFinal(text: string): void;
  onAgentToken(token: string): void;
  onAgentDone(payload: {
    answer: string;
    citations: AgentCitation[];
    citedNodeIds: string[];
    toolsUsed: string[];
  }): void;
  onTtsAudio(chunk: Buffer): void;
  onError(message: string): void;
}

/** One voice session lives for one WebSocket connection */
export class VoiceSession {
  private readonly logger = new Logger(VoiceSession.name);

  state: VoiceUiState = 'idle';
  agentSessionId: string | null = null;

  stt: WhisperSTTProvider;
  tts: PiperTTSProvider;

  /** AbortController for in-flight agent runs */
  private agentAbort: AbortController | null = null;

  constructor(
    public readonly socketId: string,
    public readonly userId: string,
    public readonly repositoryId: string,
    private readonly agentLoop: AgentLoopService,
    private readonly sessions: AgentSessionStore,
    private readonly callbacks: VoiceSessionCallbacks,
    whisperBin: string,
    whisperModel: string,
    sampleRate: number,
    piperBin: string,
    piperModel: string,
  ) {
    this.stt = new WhisperSTTProvider(whisperBin, whisperModel, sampleRate);
    this.tts = new PiperTTSProvider(piperBin, piperModel);

    this.stt.onPartial((text) => callbacks.onSttPartial(text));
    this.stt.onFinal((text) => void this.handleFinalTranscript(text));
    this.tts.onAudio((chunk) => callbacks.onTtsAudio(chunk));
  }

  async startListening(): Promise<void> {
    await this.stt.start();
    this.setState('listening');
  }

  pushAudio(chunk: Buffer): void {
    if (this.state === 'listening') {
      this.stt.pushAudio(chunk);
    }
  }

  async commitUtterance(): Promise<void> {
    if (this.state !== 'listening') return;
    await this.stt.commitUtterance();
  }

  /** Accept typed text directly, bypassing STT — routes through the same agent pipeline */
  async processTextInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.handleFinalTranscript(trimmed);
  }

  async interrupt(): Promise<void> {
    // Stop TTS immediately
    await this.tts.stop();
    // Cancel any in-flight agent stream
    this.agentAbort?.abort();
    this.agentAbort = null;
    // Go back to listening
    this.setState('listening');
  }

  async destroy(): Promise<void> {
    this.agentAbort?.abort();
    await this.tts.stop();
    await this.stt.stop();
  }

  private setState(state: VoiceUiState): void {
    this.state = state;
    this.callbacks.onState(state);
  }

  private async handleFinalTranscript(question: string): Promise<void> {
    if (!question.trim()) return;

    this.callbacks.onSttFinal(question);
    this.setState('processing');

    const abort = new AbortController();
    this.agentAbort = abort;

    try {
      // Resolve recent context from existing session turns
      let recentNodeIds: string[] = [];
      if (this.agentSessionId) {
        const session = await this.sessions.get(this.agentSessionId);
        if (session) {
          recentNodeIds = this.sessions.recentCitedNodeIds(session);
        }
      }

      let finalAnswer = '';
      let finalCitations: AgentCitation[] = [];
      let finalCitedNodeIds: string[] = [];
      let finalToolsUsed: string[] = [];

      const stream = this.agentLoop.runStream({
        repositoryId: this.repositoryId,
        question,
        recentNodeIds,
        responseStyle: 'voice',
      });

      for await (const chunk of stream) {
        if (abort.signal.aborted) break;

        if (chunk.event === 'token') {
          this.callbacks.onAgentToken(chunk.data as string);
        } else if (chunk.event === 'done') {
          const done = chunk.data as {
            answer: string;
            citations: AgentCitation[];
            citedNodeIds: string[];
            toolsUsed: string[];
          };
          finalAnswer = done.answer;
          finalCitations = done.citations;
          finalCitedNodeIds = done.citedNodeIds;
          finalToolsUsed = done.toolsUsed;
        }
      }

      if (abort.signal.aborted) return;

      // Persist turn
      if (this.agentSessionId && finalAnswer) {
        await this.sessions.appendTurn(this.agentSessionId, {
          q: question,
          a: finalAnswer,
          citedNodeIds: finalCitedNodeIds,
        });
      }

      this.callbacks.onAgentDone({
        answer: finalAnswer,
        citations: finalCitations,
        citedNodeIds: finalCitedNodeIds,
        toolsUsed: finalToolsUsed,
      });

      // Speak the sanitized response
      if (!abort.signal.aborted && finalAnswer) {
        this.setState('speaking');
        const spoken = toSpokenText(finalAnswer);
        await this.tts.speak(spoken);
        if (!abort.signal.aborted) {
          this.setState('listening');
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(`Agent error: ${(err as Error).message}`);
        this.callbacks.onError((err as Error).message);
        this.setState('listening');
      }
    } finally {
      if (this.agentAbort === abort) {
        this.agentAbort = null;
      }
    }
  }
}

/** Factory service — creates and tracks sessions per socket */
@Injectable()
export class VoiceAgentService {
  private readonly logger = new Logger(VoiceAgentService.name);
  private readonly sessions = new Map<string, VoiceSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLoop: AgentLoopService,
    private readonly sessionStore: AgentSessionStore,
    private readonly config: ConfigService,
  ) {}

  async createSession(
    socketId: string,
    userId: string,
    repositoryId: string,
    callbacks: VoiceSessionCallbacks,
  ): Promise<VoiceSession> {
    // Validate repo ownership
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    if (repo.organizationId) {
      const isMember = await this.prisma.organizationMember.findFirst({
        where: {
          orgId: repo.organizationId,
          userId,
        },
      });
      if (!isMember) {
        throw new ForbiddenException('You do not own this repository');
      }
    } else if (repo.userId !== userId) {
      throw new ForbiddenException('You do not own this repository');
    }

    // Create (or reuse) an agent session for conversation history
    const agentSession = await this.sessionStore.create(repositoryId, userId);

    const session = new VoiceSession(
      socketId,
      userId,
      repositoryId,
      this.agentLoop,
      this.sessionStore,
      callbacks,
      this.config.get<string>('voice.whisperBin')!,
      this.config.get<string>('voice.whisperModel')!,
      this.config.get<number>('voice.sampleRate')!,
      this.config.get<string>('voice.piperBin')!,
      this.config.get<string>('voice.piperModel')!,
    );
    session.agentSessionId = agentSession.sessionId;

    this.sessions.set(socketId, session);
    return session;
  }

  getSession(socketId: string): VoiceSession | undefined {
    return this.sessions.get(socketId);
  }

  async destroySession(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId);
    if (session) {
      await session.destroy();
      this.sessions.delete(socketId);
      this.logger.log(`Voice session destroyed: ${socketId}`);
    }
  }
}
