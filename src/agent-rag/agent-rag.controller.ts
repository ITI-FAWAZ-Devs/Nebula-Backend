import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipResponseIntercept } from '../common/decorators/skip-response-intercept.decorator';
import { AgentRagService } from './agent-rag.service';
import { AgentMessageDto } from './dto/agent-session.dto';

@Controller('repositories/:repositoryId/agent')
export class AgentRagController {
  constructor(private readonly agentRagService: AgentRagService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const data = await this.agentRagService.createSession(userId, repositoryId);
    return {
      success: true,
      message: 'Agent session created',
      data,
    };
  }

  @Get('sessions/:sessionId')
  async getSession(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const data = await this.agentRagService.getSession(
      userId,
      repositoryId,
      sessionId,
    );
    return {
      success: true,
      message: 'Agent session retrieved',
      data,
    };
  }

  /**
   * Plan/execute server-side, then SSE-stream synthesizer tokens.
   * Events: token | citation | done | error
   */
  @Post('sessions/:sessionId/messages')
  @SkipResponseIntercept()
  @HttpCode(HttpStatus.OK)
  async postMessage(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AgentMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      for await (const chunk of this.agentRagService.streamMessage({
        userId,
        repositoryId,
        sessionId,
        question: dto.question,
      })) {
        res.write(`event: ${chunk.event}\n`);
        res.write(`data: ${JSON.stringify(chunk.data)}\n\n`);
      }
    } catch (error) {
      res.write(`event: error\n`);
      res.write(
        `data: ${JSON.stringify({ message: (error as Error).message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
