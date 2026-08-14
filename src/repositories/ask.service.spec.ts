import { Test, TestingModule } from '@nestjs/testing';
import { AskService } from './ask.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';
import { NotFoundException } from '@nestjs/common';

describe('AskService', () => {
  let service: AskService;
  let prismaMock: jest.Mocked<Partial<PrismaService>>;
  let agentLoopMock: jest.Mocked<Partial<AgentLoopService>>;

  beforeEach(async () => {
    prismaMock = {
      repository: {
        findUnique: jest.fn(),
      } as any,
    };

    agentLoopMock = {
      run: jest.fn().mockResolvedValue({
        answer: 'Delegated answer',
        citations: [{ filePath: 'src/main.ts' }, { filePath: 'src/app.ts' }],
        citedNodeIds: ['node-1'],
        toolsUsed: ['hybrid_search'],
        contextNodeIds: ['node-1'],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AskService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AgentLoopService, useValue: agentLoopMock },
      ],
    }).compile();

    service = module.get<AskService>(AskService);
  });

  it('throws NotFoundException if repository does not exist', async () => {
    (prismaMock.repository?.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.ask('missing-repo', 'What is this?')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delegates to AgentLoopService and returns backward-compatible answer and citations', async () => {
    (prismaMock.repository?.findUnique as jest.Mock).mockResolvedValue({
      id: 'repo-1',
      name: 'TestRepo',
    });

    const result = await service.ask('repo-1', 'Explain the entry point');

    expect(agentLoopMock.run).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      question: 'Explain the entry point',
    });

    expect(result).toEqual({
      answer: 'Delegated answer',
      citations: ['src/main.ts', 'src/app.ts'],
    });
  });
});
