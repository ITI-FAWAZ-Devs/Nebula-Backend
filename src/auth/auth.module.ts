import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConnectionsModule } from '../connections/connections.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubConnectPendingStore } from './github-connect-pending.store';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    UsersModule,
    MailModule,
    forwardRef(() => OrganizationsModule),
    ConnectionsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GithubConnectPendingStore,
    TokenService,
    JwtStrategy,
    JwtRefreshStrategy,
    GithubStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
