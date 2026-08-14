import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
}

export interface CreateSessionResponse {
  sessionId: string;
  repositoryId: string;
}

export interface SessionMetadataResponse {
  sessionId: string;
  repositoryId: string;
  turnCount: number;
  updatedAt: string;
}
