import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { TokenService } from '../token.service';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.['nebula_refresh_token'] || null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('auth.jwtRefreshSecret')!,
      passReqToCallback: true,
    } as any);
  }

  async validate(req: Request, payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Extract the raw refresh token to verify against stored hash
    const refreshToken =
      req.cookies?.['nebula_refresh_token'] ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not provided');
    }

    const isValid = await this.tokenService.verifyHash(
      user.refreshToken,
      refreshToken,
    );

    if (!isValid) {
      // Possible token reuse attack — invalidate all sessions
      await this.usersService.updateRefreshToken(user.id, null);
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    return user;
  }
}
