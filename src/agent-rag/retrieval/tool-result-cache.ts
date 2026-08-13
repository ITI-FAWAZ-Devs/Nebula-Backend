import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  AGENT_TOOL_CACHE_KEY_PREFIX,
  TOOL_CACHE_TTL_SECONDS,
} from '../agent-rag.constants';
import { RetrievalHit } from '../dto/retrieval-hit.dto';

@Injectable()
export class ToolResultCache {
  private readonly logger = new Logger(ToolResultCache.name);

  constructor(private readonly redis: RedisService) {}

  private key(
    repositoryId: string,
    tool: string,
    args: Record<string, unknown>,
  ): string {
    const hash = createHash('sha256')
      .update(JSON.stringify(args))
      .digest('hex')
      .slice(0, 16);
    return `${AGENT_TOOL_CACHE_KEY_PREFIX}${repositoryId}:${tool}:${hash}`;
  }

  async get(
    repositoryId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<RetrievalHit[] | null> {
    try {
      const raw = await this.redis.get(this.key(repositoryId, tool, args));
      if (!raw) return null;
      return JSON.parse(raw) as RetrievalHit[];
    } catch (error) {
      this.logger.warn(`Tool cache get failed: ${(error as Error).message}`);
      return null;
    }
  }

  async set(
    repositoryId: string,
    tool: string,
    args: Record<string, unknown>,
    hits: RetrievalHit[],
  ): Promise<void> {
    try {
      await this.redis.set(
        this.key(repositoryId, tool, args),
        JSON.stringify(hits),
        TOOL_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Tool cache set failed: ${(error as Error).message}`);
    }
  }
}
