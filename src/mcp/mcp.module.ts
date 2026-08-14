import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentRagModule } from '../agent-rag/agent-rag.module';
import { McpService } from './mcp.service';

@Module({
  imports: [PrismaModule, AgentRagModule],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
