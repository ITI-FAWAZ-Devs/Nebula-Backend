import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-rag/orchestration/agent-loop.service';

/**
 * @deprecated Legacy stateless Q&A service. Delegated to AgentLoopService.
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLoop: AgentLoopService,
  ) {}

  /**
   * Delegates legacy stateless Q&A requests to the agent-rag loop pipeline.
   */
  async ask(
    repositoryId: string,
    question: string,
  ): Promise<{ answer: string; citations: string[] }> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    this.logger.log(
      `[Deprecated AskService] Delegating question for repository ${repositoryId} to AgentLoopService: "${question}"`,
    );

    const result = await this.agentLoop.run({
      repositoryId,
      question,
    });

    const fileCitations = [
      ...new Set(
        result.citations
          .map((c) => c.filePath)
          .filter((f): f is string => Boolean(f)),
      ),
    ];

    return {
      answer: result.answer,
      citations: fileCitations,
    };
  }
}
