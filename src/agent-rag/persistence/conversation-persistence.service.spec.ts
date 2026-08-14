import { Test, TestingModule } from '@nestjs/testing';
import { ConversationPersistenceService } from './conversation-persistence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('ConversationPersistenceService', () => {
  let service: ConversationPersistenceService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      conversationThread: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      conversationMessage: {
        createMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationPersistenceService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ConversationPersistenceService>(
      ConversationPersistenceService,
    );
  });

  it('creates new thread and persists turn when threadId is not provided', async () => {
    prismaMock.conversationThread.create.mockResolvedValue({ id: 'thread-1' });

    const result = await service.persistTurn({
      userId: 'user-1',
      repositoryId: 'repo-1',
      question: 'How does routing work?',
      answer: 'Routing is handled by NestJS controllers.',
      citations: [{ filePath: 'src/app.controller.ts' }],
    });

    expect(result.threadId).toBe('thread-1');
    expect(prismaMock.conversationThread.create).toHaveBeenCalled();
    expect(prismaMock.conversationMessage.createMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'thread-1', role: 'user', content: 'How does routing work?' },
        {
          threadId: 'thread-1',
          role: 'assistant',
          content: 'Routing is handled by NestJS controllers.',
          citations: [{ filePath: 'src/app.controller.ts' }],
        },
      ],
    });
  });

  it('gets thread details with messages', async () => {
    prismaMock.conversationThread.findFirst.mockResolvedValue({
      id: 'thread-1',
      repositoryId: 'repo-1',
      title: 'How does routing work?',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        { id: 'm1', role: 'user', content: 'Q', citations: null, createdAt: new Date() },
        { id: 'm2', role: 'assistant', content: 'A', citations: [], createdAt: new Date() },
      ],
    });

    const thread = await service.getThreadDetails('user-1', 'repo-1', 'thread-1');
    expect(thread.id).toBe('thread-1');
    expect(thread.messages).toHaveLength(2);
  });

  it('throws NotFoundException on missing thread details', async () => {
    prismaMock.conversationThread.findFirst.mockResolvedValue(null);

    await expect(
      service.getThreadDetails('user-1', 'repo-1', 'missing-thread'),
    ).rejects.toThrow(NotFoundException);
  });
});
