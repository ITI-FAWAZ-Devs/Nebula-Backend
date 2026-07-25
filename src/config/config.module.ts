import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import mailConfig from './mail.config';
import githubConfig from './github.config';
import googleConfig from './google.config';
import encryptionConfig from './encryption.config';
import redisConfig from './redis.config';
import workspaceConfig from './workspace.config';
import graphifyConfig from './graphify.config';
import neo4jConfig from './neo4j.config';
import geminiConfig from './gemini.config';
import chromaConfig from './chroma.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        mailConfig,
        githubConfig,
        googleConfig,
        encryptionConfig,
        redisConfig,
        workspaceConfig,
        graphifyConfig,
        neo4jConfig,
        geminiConfig,
        chromaConfig,
      ],
      envFilePath: ['.env'],
    }),
  ],
})
export class ConfigModule {}
