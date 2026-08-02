import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
}

export class AgentMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question!: string;
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
