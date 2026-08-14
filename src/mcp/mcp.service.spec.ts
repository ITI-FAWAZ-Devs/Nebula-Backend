import { Test, TestingModule } from '@nestjs/testing';
import { McpService } from './mcp.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';
import { NotFoundException } from '@nestjs/common';

describe('McpService', () => {
  let service: McpService;
  let prismaMock: any;
  let agentLoopMock: jest.Mocked<Partial<AgentLoopService>>;

  beforeEach(async () => {
    prismaMock = {
      generatedDoc: {
        findFirst: jest.fn(),
      },
    };

    agentLoopMock = {
      run: jest.fn().mockResolvedValue({
        answer: 'MCP answer',
        citations: [{ filePath: 'src/main.ts' }],
        toolsUsed: ['hybrid_search'],
        followups: ['Followup?'],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AgentLoopService, useValue: agentLoopMock },
      ],
    }).compile();

    service = module.get<McpService>(McpService);
  });

  it('returns tool definitions matching MCP protocol', () => {
    const definitions = service.getToolDefinitions();
    expect(definitions).toHaveLength(3);
    expect(definitions.map((d) => d.name)).toEqual([
      'read_wiki_structure',
      'read_wiki_contents',
      'ask_question',
    ]);
  });

  it('executes ask_question via AgentLoopService', async () => {
    const result = await service.executeTool('ask_question', {
      repositoryId: 'repo-1',
      question: 'How is state managed?',
    });

    expect(agentLoopMock.run).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      question: 'How is state managed?',
    });
    expect(result).toEqual({
      answer: 'MCP answer',
      citations: [{ filePath: 'src/main.ts' }],
      toolsUsed: ['hybrid_search'],
      followups: ['Followup?'],
    });
  });

  it('throws NotFoundException for unrecognized tool', async () => {
    await expect(
      service.executeTool('unknown_tool', { repositoryId: 'repo-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
