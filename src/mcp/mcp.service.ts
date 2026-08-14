import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';
import { DocStatus } from '@prisma/client';

export interface McpToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLoop: AgentLoopService,
  ) {}

  getToolDefinitions(): McpToolDeclaration[] {
    return [
      {
        name: 'read_wiki_structure',
        description:
          'Reads the table of contents and section keys of the codebase architecture wiki.',
        parameters: {
          type: 'object',
          properties: {
            repositoryId: {
              type: 'string',
              description: 'The unique ID of the repository.',
            },
          },
          required: ['repositoryId'],
        },
      },
      {
        name: 'read_wiki_contents',
        description:
          'Reads the full markdown content and diagrams for a specific wiki section.',
        parameters: {
          type: 'object',
          properties: {
            repositoryId: {
              type: 'string',
              description: 'The unique ID of the repository.',
            },
            sectionKey: {
              type: 'string',
              description: 'The section key (e.g. system_architecture, data_flow).',
            },
          },
          required: ['repositoryId', 'sectionKey'],
        },
      },
      {
        name: 'ask_question',
        description:
          'Queries the codebase using the full hybrid graph-rag agent loop.',
        parameters: {
          type: 'object',
          properties: {
            repositoryId: {
              type: 'string',
              description: 'The unique ID of the repository.',
            },
            question: {
              type: 'string',
              description: 'The technical question to answer about the code.',
            },
          },
          required: ['repositoryId', 'question'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, any>): Promise<unknown> {
    this.logger.log(`Executing MCP tool "${name}" with args: ${JSON.stringify(args)}`);

    switch (name) {
      case 'read_wiki_structure':
        return this.readWikiStructure(String(args.repositoryId));
      case 'read_wiki_contents':
        return this.readWikiContents(
          String(args.repositoryId),
          String(args.sectionKey),
        );
      case 'ask_question':
        return this.askQuestion(
          String(args.repositoryId),
          String(args.question),
        );
      default:
        throw new NotFoundException(`MCP tool "${name}" not recognized.`);
    }
  }

  async readWikiStructure(repositoryId: string) {
    const doc = await this.prisma.generatedDoc.findFirst({
      where: { repositoryId, status: DocStatus.COMPLETED },
      orderBy: { version: 'desc' },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          select: { key: true, title: true, order: true, sourceFiles: true },
        },
      },
    });

    if (!doc) {
      return {
        repositoryId,
        message: 'No completed architecture wiki documentation found for this repository.',
        sections: [],
      };
    }

    return {
      repositoryId,
      version: doc.version,
      commitSha: doc.commitSha,
      generatedAt: doc.generatedAt,
      sections: doc.sections,
    };
  }

  async readWikiContents(repositoryId: string, sectionKey: string) {
    const doc = await this.prisma.generatedDoc.findFirst({
      where: { repositoryId, status: DocStatus.COMPLETED },
      orderBy: { version: 'desc' },
      include: {
        sections: {
          where: { key: sectionKey },
        },
      },
    });

    if (!doc || doc.sections.length === 0) {
      throw new NotFoundException(
        `Wiki section "${sectionKey}" not found for repository ${repositoryId}.`,
      );
    }

    const section = doc.sections[0];
    return {
      repositoryId,
      sectionKey: section.key,
      title: section.title,
      contentMarkdown: section.contentMd,
      diagramMermaid: section.diagramMermaid,
      sourceFiles: section.sourceFiles,
    };
  }

  async askQuestion(repositoryId: string, question: string) {
    const result = await this.agentLoop.run({
      repositoryId,
      question,
    });

    return {
      answer: result.answer,
      citations: result.citations,
      toolsUsed: result.toolsUsed,
      followups: result.followups,
    };
  }
}
