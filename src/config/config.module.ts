import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import mailConfig from './mail.config';
import githubConfig from './github.config';
import googleConfig from './google.config';
import encryptionConfig from './encryption.config';

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
      ],
      envFilePath: ['.env'],
    }),
  ],
})
export class ConfigModule {}
