import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync({ ...payload } as any, {
      secret: this.configService.get<string>('auth.jwtAccessSecret')!,
      expiresIn: this.configService.get<string>('auth.jwtAccessExpiration')! as any,
    });
  }

  async generateRefreshToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync({ ...payload } as any, {
      secret: this.configService.get<string>('auth.jwtRefreshSecret')!,
      expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration')! as any,
    });
  }

  async generateTokenPair(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(payload),
    ]);

    return { accessToken, refreshToken };
  }

  async hashToken(token: string): Promise<string> {
    return argon2.hash(token);
  }

  async verifyHash(hash: string, plainToken: string): Promise<boolean> {
    return argon2.verify(hash, plainToken);
  }

  generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Returns MaxAge in milliseconds for cookie configuration */
  getAccessTokenMaxAge(): number {
    return this.parseDurationToMs(
      this.configService.get<string>('auth.jwtAccessExpiration')!,
    );
  }

  getRefreshTokenMaxAge(): number {
    return this.parseDurationToMs(
      this.configService.get<string>('auth.jwtRefreshExpiration')!,
    );
  }

  private parseDurationToMs(duration: string): number {
    const match = duration.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 15 * 60 * 1000; // default 15m

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default:  return 15 * 60 * 1000;
    }
  }
}
