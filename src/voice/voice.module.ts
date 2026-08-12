import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentRagModule } from '../agent-rag/agent-rag.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VoiceAgentService } from './voice-agent.service';
import { VoiceGateway } from './voice.gateway';
import { VoiceModelCheckService } from './voice-model-check.service';

@Module({
  imports: [
    AgentRagModule,
    PrismaModule,
    // JwtModule with no options — the gateway verifies tokens manually via
    // ConfigService to avoid a circular dependency with AuthModule
    JwtModule.register({}),
  ],
  providers: [VoiceAgentService, VoiceGateway, VoiceModelCheckService],
})
export class VoiceModule {}
