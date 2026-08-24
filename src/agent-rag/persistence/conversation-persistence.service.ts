import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface PersistTurnInput {
  userId: string;
  repositoryId: string;
  threadId?: string;
  question: string;
  answer: string;
  citations?: unknown;
}

@Injectable()
export class ConversationPersistenceService {
  private readonly logger = new Logger(ConversationPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async persistTurn(input: PersistTurnInput): Promise<{ threadId: string }> {
    let threadId = input.threadId;

    if (threadId) {
      const existing = await this.prisma.conversationThread.findFirst({
        where: {
          id: threadId,
          userId: input.userId,
          repositoryId: input.repositoryId,
        },
      });
      if (!existing) {
        threadId = undefined;
      }
    }

    if (!threadId) {
      const title =
        input.question.length > 60
          ? `${input.question.slice(0, 57)}...`
          : input.question;

      const newThread = await this.prisma.conversationThread.create({
        data: {
          repositoryId: input.repositoryId,
          userId: input.userId,
          title,
        },
      });
      threadId = newThread.id;
    }

    await this.prisma.conversationMessage.createMany({
      data: [
        {
          threadId,
          role: 'user',
          content: input.question,
        },
        {
          threadId,
          role: 'assistant',
          content: input.answer,
          citations: input.citations ? (input.citations as any) : undefined,
        },
      ],
    });

    await this.prisma.conversationThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    this.logger.log(
      `Persisted conversation turn for thread ${threadId} (repo: ${input.repositoryId})`,
    );

    return { threadId };
  }

  async getThreads(userId: string, repositoryId: string) {
    const threads = await this.prisma.conversationThread.findMany({
      where: { userId, repositoryId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    return threads.map((t) => ({
      id: t.id,
      repositoryId: t.repositoryId,
      title: t.title || 'Untitled Conversation',
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async getThreadDetails(
    userId: string,
    repositoryId: string,
    threadId: string,
  ) {
    const thread = await this.prisma.conversationThread.findFirst({
      where: { id: threadId, userId, repositoryId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!thread) {
      throw new NotFoundException('Conversation thread not found');
    }

    return {
      id: thread.id,
      repositoryId: thread.repositoryId,
      title: thread.title || 'Untitled Conversation',
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations,
        createdAt: m.createdAt,
      })),
    };
  }

  async deleteThread(userId: string, repositoryId: string, threadId: string) {
    const thread = await this.prisma.conversationThread.findFirst({
      where: { id: threadId, userId, repositoryId },
    });

    if (!thread) {
      throw new NotFoundException('Conversation thread not found');
    }

    await this.prisma.conversationThread.delete({
      where: { id: threadId },
    });

    return { success: true };
  }
}
