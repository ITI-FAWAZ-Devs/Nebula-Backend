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
      turnCount: session.turns.length,
      updatedAt: session.updatedAt,
    };
  }

  async *streamMessage(params: {
    userId: string;
    repositoryId: string;
    sessionId: string;
    question: string;
    mode?: 'standard' | 'fast' | 'deep';
    model?: string;
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

      await this.persistence.persistTurn({
        userId: params.userId,
        repositoryId: params.repositoryId,
        question: params.question,
        answer: finalAnswer,
        citations: citationsPayload,
      });
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
        throw new ForbiddenException('You do not have access to this repository');
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
