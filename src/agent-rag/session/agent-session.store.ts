import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../../redis/redis.service';
import {
  AGENT_SESSION_KEY_PREFIX,
  SESSION_TTL_SECONDS,
  SESSION_TURN_WINDOW,
} from '../agent-rag.constants';
import {
  AgentSessionRecord,
  AgentSessionTurn,
} from '../dto/agent-session.dto';

@Injectable()
export class AgentSessionStore {
  private readonly logger = new Logger(AgentSessionStore.name);

  constructor(private readonly redis: RedisService) {}

  private key(sessionId: string): string {
    return `${AGENT_SESSION_KEY_PREFIX}${sessionId}`;
  }

  async create(
    repositoryId: string,
    userId: string,
  ): Promise<AgentSessionRecord> {
    const sessionId = uuidv4();
    const record: AgentSessionRecord = {
      sessionId,
      repositoryId,
      userId,
      turns: [],
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify(record),
      SESSION_TTL_SECONDS,
    );
    return record;
  }

  async get(sessionId: string): Promise<AgentSessionRecord | null> {
    try {
      const raw = await this.redis.get(this.key(sessionId));
      if (!raw) return null;
      return JSON.parse(raw) as AgentSessionRecord;
    } catch (error) {
      this.logger.warn(`Session get failed: ${(error as Error).message}`);
      return null;
    }
  }

  async appendTurn(
    sessionId: string,
    turn: AgentSessionTurn,
  ): Promise<AgentSessionRecord | null> {
    const record = await this.get(sessionId);
    if (!record) return null;

    record.turns = [...record.turns, turn].slice(-SESSION_TURN_WINDOW);
    record.updatedAt = new Date().toISOString();
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify(record),
      SESSION_TTL_SECONDS,
    );
    return record;
  }

  recentCitedNodeIds(record: AgentSessionRecord): string[] {
    const last = record.turns[record.turns.length - 1];
    return last?.citedNodeIds || [];
  }
}
