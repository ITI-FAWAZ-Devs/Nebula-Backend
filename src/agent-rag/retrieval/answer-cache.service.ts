import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  AGENT_ANSWER_CACHE_KEY_PREFIX,
  ANSWER_CACHE_TTL_SECONDS,
} from '../agent-rag.constants';
import { AgentLoopResult } from '../orchestration/agent-loop.service';

@Injectable()
export class AnswerCacheService {
  private readonly logger = new Logger(AnswerCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private key(repositoryId: string, question: string): string {
    const normalized = question.trim().toLowerCase();
    const hash = createHash('sha256')
      .update(normalized)
      .digest('hex')
      .slice(0, 16);
    return `${AGENT_ANSWER_CACHE_KEY_PREFIX}${repositoryId}:${hash}`;
  }

  async get(
    repositoryId: string,
    question: string,
  ): Promise<AgentLoopResult | null> {
    try {
      const raw = await this.redis.get(this.key(repositoryId, question));
      if (!raw) return null;
      return JSON.parse(raw) as AgentLoopResult;
    } catch (error) {
      this.logger.warn(
        `Answer cache get failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(
    repositoryId: string,
    question: string,
    result: AgentLoopResult,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.key(repositoryId, question),
        JSON.stringify(result),
        ANSWER_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Answer cache set failed: ${(error as Error).message}`,
      );
    }
  }
}
