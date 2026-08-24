import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export interface AgentSessionTurn {
  q: string;
  a: string;
  citedNodeIds: string[];
}

export interface AgentSessionRecord {
  sessionId: string;
  repositoryId: string;
  userId: string;
  turns: AgentSessionTurn[];
  updatedAt: string;
  model?: string;
  /** Persisted conversation thread this session appends to (once known). */
  threadId?: string;
}

export class AgentMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question!: string;

  @IsOptional()
  @IsIn(['standard', 'fast', 'deep'])
  mode?: 'standard' | 'fast' | 'deep';

  @IsOptional()
  @IsString()
  model?: string;

  /**
   * Existing conversation thread to append to. Allows a client resuming an
   * old conversation (e.g. after the Redis session expired) to keep all
   * messages in the same thread instead of forking a new one.
   */
  @IsOptional()
  @IsUUID()
  threadId?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  repositoryId: string;
  threadId: string | null;
}

export interface SessionMetadataResponse {
  sessionId: string;
  repositoryId: string;
  threadId: string | null;
  turnCount: number;
  updatedAt: string;
}

export interface SessionMessagesResponse {
  sessionId: string;
  repositoryId: string;
  threadId: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    turnIndex: number;
  }>;
}
