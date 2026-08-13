import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';

/**
 * Handles the GitHub OAuth callback for the login flow.
 * The connect flow uses the same callbackURL but is initiated manually
 * via /auth/github/connect, which embeds { purpose: 'connect', ... } in
 * the OAuth state. The callback reads that state to branch accordingly.
 */
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>('github.clientId')!,
      clientSecret: configService.get<string>('github.clientSecret')!,
      callbackURL: configService.get<string>('github.callbackUrl')!,
      scope: ['user:email', 'repo', 'read:org'],
      passReqToCallback: true,
    });
  }

  async validate(
    req: any,
    accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user: any) => void,
  ) {
    const { id, username, displayName, emails, photos } = profile;

    // The OAuth state is passed back by GitHub in the query string.
    // Decode it so the callback handler can determine login vs connect purpose.
    let state: Record<string, any> = {};
    try {
      const raw = req.query?.state as string | undefined;
      if (raw) {
        state = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString());
      }
    } catch {
      // ignore malformed state
    }

    done(null, {
      id: String(id),
      username,
      displayName,
      email: emails?.[0]?.value || null,
      avatar: photos?.[0]?.value || null,
      accessToken,
      state,
    });
  }
}
