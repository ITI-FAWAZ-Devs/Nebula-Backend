import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MailModule } from './mail/mail.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { AnalysisModule } from './analysis/analysis.module';
import { ArchitectureDocModule } from './architecture-doc/architecture-doc.module';
import { AiProviderModule } from './ai-provider/ai-provider.module';
import { ProgressModule } from './progress/progress.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AgentRagModule } from './agent-rag/agent-rag.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ConnectionsModule } from './connections/connections.module';
import { VoiceModule } from './voice/voice.module';
import { McpModule } from './mcp/mcp.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AdminModule } from './admin/admin.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host') || 'localhost',
          port: configService.get<number>('redis.port') || 6379,
          password: configService.get<string>('redis.password') || undefined,
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 30,
      },
    ]),
    AuthModule,
    UsersModule,
    MailModule,
    RepositoriesModule,
    AnalysisModule,
    ArchitectureDocModule,
    ProgressModule,
    AiProviderModule,
    IntegrationsModule,
    OrganizationsModule,
    AgentRagModule,
    SubscriptionModule,
    ConnectionsModule,
    VoiceModule,
    McpModule,
    AuthorizationModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global JWT guard — all routes require auth unless @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global role guard — enforces @Roles() metadata on admin routes
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
