import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from './orchestration/agent-loop.service';
import { AgentSessionStore } from './session/agent-session.store';
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
  }): AsyncGenerator<{ event: string; data: unknown }> {
    await this.findOwnedRepository(params.userId, params.repositoryId);
    const session = await this.requireSession(
      params.sessionId,
      params.userId,
      params.repositoryId,
    );

    const recentNodeIds = this.sessions.recentCitedNodeIds(session);
    let finalAnswer = '';
    let citedNodeIds: string[] = [];

    for await (const chunk of this.agentLoop.runStream({
      repositoryId: params.repositoryId,
      question: params.question,
      recentNodeIds,
    })) {
      if (chunk.event === 'done') {
        const done = chunk.data as {
          answer: string;
          citedNodeIds: string[];
          citations: unknown;
          toolsUsed: string[];
        };
        finalAnswer = done.answer;
        citedNodeIds = done.citedNodeIds;
      }
      yield chunk;
    }

    if (finalAnswer) {
      await this.sessions.appendTurn(params.sessionId, {
        q: params.question,
        a: finalAnswer,
        citedNodeIds,
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
    if (repository.userId !== userId) {
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
