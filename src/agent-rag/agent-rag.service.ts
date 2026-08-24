import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from './orchestration/agent-loop.service';
import { DeepResearchService } from './orchestration/deep-research.service';
import { AgentSessionStore } from './session/agent-session.store';
import { ConversationPersistenceService } from './persistence/conversation-persistence.service';
import {
  CreateSessionResponse,
  SessionMessagesResponse,
  SessionMetadataResponse,
} from './dto/agent-session.dto';

@Injectable()
export class AgentRagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AgentSessionStore,
    private readonly agentLoop: AgentLoopService,
    private readonly deepResearch: DeepResearchService,
    private readonly persistence: ConversationPersistenceService,
  ) {}

  async createSession(
    userId: string,
    repositoryId: string,
  ): Promise<CreateSessionResponse> {
    await this.findOwnedRepository(userId, repositoryId);
    const session = await this.sessions.create(repositoryId, userId);
    return {
      sessionId: session.sessionId,
      repositoryId: session.repositoryId,
      threadId: session.threadId ?? null,
    };
  }

  async getSession(
    userId: string,
    repositoryId: string,
    sessionId: string,
  ): Promise<SessionMetadataResponse> {
    await this.findOwnedRepository(userId, repositoryId);
    const session = await this.requireSession(sessionId, userId, repositoryId);
    return {
      sessionId: session.sessionId,
      repositoryId: session.repositoryId,
      threadId: session.threadId ?? null,
      turnCount: session.turns.length,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * All messages recorded for an active agent session (in-memory turn window).
   * For the full durable history of a conversation use the thread endpoints.
   */
  async getSessionMessages(
    userId: string,
    repositoryId: string,
    sessionId: string,
  ): Promise<SessionMessagesResponse> {
    await this.findOwnedRepository(userId, repositoryId);
    const session = await this.requireSession(sessionId, userId, repositoryId);

    const messages = session.turns.flatMap((turn, index) => [
      {
        id: `${sessionId}:turn-${index}:user`,
        role: 'user' as const,
        content: turn.q,
        turnIndex: index,
      },
      {
        id: `${sessionId}:turn-${index}:assistant`,
        role: 'assistant' as const,
        content: turn.a,
        turnIndex: index,
      },
    ]);

    return {
      sessionId: session.sessionId,
      repositoryId: session.repositoryId,
      threadId: session.threadId ?? null,
      messages,
    };
  }

  async *streamMessage(params: {
    userId: string;
    repositoryId: string;
    sessionId: string;
    question: string;
    mode?: 'standard' | 'fast' | 'deep';
    model?: string;
    /** Existing conversation thread to append to (client-provided). */
    threadId?: string;
  }): AsyncGenerator<{ event: string; data: unknown }> {
    await this.findOwnedRepository(params.userId, params.repositoryId);
    const session = await this.requireSession(
      params.sessionId,
      params.userId,
      params.repositoryId,
    );

    if (params.model && params.model !== session.model) {
      await this.sessions.updateModel(params.sessionId, params.model);
    }

    const resolvedModel = params.model || session.model;
    // Reuse the session's bound thread, or the client-requested one. Only the
    // very first persisted turn (no binding anywhere) creates a new thread.
    const activeThreadId = session.threadId ?? params.threadId;
    const recentNodeIds = this.sessions.recentCitedNodeIds(session);
    const conversationHistory = session.turns.map((t) => ({ q: t.q, a: t.a }));
    let finalAnswer = '';
    let citedNodeIds: string[] = [];
    let citationsPayload: unknown = null;

    const stream =
      params.mode === 'deep'
        ? this.deepResearch.runStream({
            repositoryId: params.repositoryId,
            question: params.question,
            recentNodeIds,
            conversationHistory,
            model: resolvedModel,
          })
        : this.agentLoop.runStream({
            repositoryId: params.repositoryId,
            question: params.question,
            recentNodeIds,
            conversationHistory,
            model: resolvedModel,
          });

    for await (const chunk of stream) {
      if (chunk.event === 'done') {
        const done = chunk.data as {
          answer: string;
          citedNodeIds: string[];
          citations: unknown;
          toolsUsed: string[];
        };
        finalAnswer = done.answer;
        citedNodeIds = done.citedNodeIds;
        citationsPayload = done.citations;
      }
      yield chunk;
    }

    if (finalAnswer) {
      await this.sessions.appendTurn(params.sessionId, {
        q: params.question,
        a: finalAnswer,
        citedNodeIds,
      });

      const { threadId } = await this.persistence.persistTurn({
        userId: params.userId,
        repositoryId: params.repositoryId,
        threadId: activeThreadId,
        question: params.question,
        answer: finalAnswer,
        citations: citationsPayload,
      });

      // Remember the thread on the session so every subsequent message in
      // this session is appended to the same conversation history.
      if (threadId !== session.threadId) {
        await this.sessions.setThread(params.sessionId, threadId);
      }

      // Let the client learn/track the bound thread id.
      yield {
        event: 'session',
        data: { sessionId: params.sessionId, threadId },
      };
    }
  }

  private async findOwnedRepository(userId: string, repositoryId: string) {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found');
    }
    if (repository.organizationId) {
      const isMember = await this.prisma.organizationMember.findFirst({
        where: {
          orgId: repository.organizationId,
          userId,
        },
      });
      if (!isMember) {
        throw new ForbiddenException(
          'You do not have access to this repository',
        );
      }
    } else if (repository.userId !== userId) {
      throw new ForbiddenException('You do not own this repository');
    }
    return repository;
  }

  private async requireSession(
    sessionId: string,
    userId: string,
    repositoryId: string,
  ) {
    const session = await this.sessions.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.repositoryId !== repositoryId
    ) {
      throw new NotFoundException('Agent session not found');
    }
    return session;
  }
}
