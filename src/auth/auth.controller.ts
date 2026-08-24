import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RegisterFromInviteDto } from './dto/register-from-invite.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { ConnectionProvider } from '@prisma/client';
import { GithubConnectPendingStore } from './github-connect-pending.store';
import { SkipResponseIntercept } from '../common/decorators/skip-response-intercept.decorator';

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly connectionsService: ConnectionsService,
    private readonly pendingStore: GithubConnectPendingStore,
  ) {
    this.isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register-from-invite')
  @HttpCode(HttpStatus.OK)
  async registerFromInvite(
    @Body() dto: RegisterFromInviteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.registerFromInvite(dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      success: true,
      message: 'Registration complete. Welcome to Nebula!',
      data: { user: result.user },
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      success: true,
      message: 'Login successful',
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(userId);
    this.clearAuthCookies(res);
    return result;
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    const result = await this.authService.refreshTokens(user);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Get('verify-email')
  async verifyEmailFromLink(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    try {
      await this.authService.verifyEmail({ token });
      const frontendUrl = this.configService.get<string>('app.frontendUrl');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Email Verified</title>
            <meta http-equiv="refresh" content="3;url=${frontendUrl}" />
            <style>
              body {
                background: #0f172a;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                font-family: 'Inter', sans-serif;
                color: white;
              }
              .card {
                background: #1e293b;
                padding: 40px;
                border-radius: 20px;
                text-align: center;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                border: 1px solid #334155;
              }
              h1 {
                color: #10b981;
                margin-top: 0;
                font-size: 2rem;
              }
              p {
                color: #94a3b8;
                font-size: 1.1rem;
                margin: 10px 0;
              }
              .countdown {
                font-weight: bold;
                color: #38bdf8;
                font-size: 1.2rem;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✅ Email Verified</h1>
              <p>Your email has been verified successfully.</p>
              <p>Redirecting to Nebula in <span id="countdown" class="countdown">3</span> seconds...</p>
            </div>
            <script>
              let seconds = 3;
              const countdownEl = document.getElementById('countdown');
              const interval = setInterval(() => {
                seconds--;
                if (countdownEl) {
                  countdownEl.textContent = seconds;
                }
                if (seconds <= 0) {
                  clearInterval(interval);
                  window.location.href = "${frontendUrl}";
                }
              }, 1000);
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      const message = error?.message || 'Invalid or expired verification token';
      res.status(400).send(`
        <html>
          <head><title>Verification Failed</title></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
            <div style="text-align: center; padding: 2rem; border-radius: 12px; background: #1e293b; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
              <h1 style="color: #ef4444;">❌ Verification Failed</h1>
              <p>${message}</p>
            </div>
          </body>
        </html>
      `);
    }
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  // ── GitHub OAuth ──

  @Public()
  @UseGuards(GithubAuthGuard)
  @Get('github')
  async githubLogin() {
    // Guard initiates the OAuth redirect (login flow)
  }

  /**
   * GET /auth/github/connect
   * Initiates the GitHub connect flow by manually constructing the GitHub
   * OAuth authorization URL with broader scopes (repo, read:org) and the
   * SAME registered callbackURL as the login flow.
   * The `state` query param (base64 JSON) carries { purpose, userId, workspace, organizationId }.
   */
  @Public()
  @SkipResponseIntercept()
  @Get('github/connect')
  async githubConnectInitiate(
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const clientId = this.configService.get<string>('github.clientId');
    const callbackUrl = this.configService.get<string>('github.callbackUrl');
    const scopes = 'repo read:org user:email';

    if (state) {
      res.cookie('nebula_github_connect_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.isProduction,
        maxAge: 10 * 60 * 1000,
        path: '/',
      });
    }

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: callbackUrl!,
      scope: scopes,
      state: state ?? '',
    });

    (res as any).redirect(
      `https://github.com/login/oauth/authorize?${params.toString()}`,
    );
  }

  /**
   * GET /auth/github/connect/add-org
   * Authenticated entry point for the "Add GitHub Organization" button.
   * Builds the same connect-flow state consumed by /auth/github/connect and
   * redirects there, so the user is sent to GitHub OAuth and — after
   * authorising — lands on the org-picker page exactly like a normal connect.
   */
  @SkipResponseIntercept()
  @Get('github/connect/add-org')
  async githubConnectAddOrg(
    @CurrentUser('id') userId: string,
    @Query('organizationId') organizationId: string | undefined,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ) {
    const state = Buffer.from(
      JSON.stringify({
        purpose: 'connect',
        flow: 'add-org',
        userId,
        workspace: organizationId ? 'organization' : 'personal',
        organizationId: organizationId ?? null,
        returnTo,
      }),
    ).toString('base64');

    const params = new URLSearchParams({ state });
    return (res as any).redirect(`/api/auth/github/connect?${params.toString()}`);
  }

  /**
   * GET /auth/github/callback
   * Single callback for both login and connect flows.
   *
   * Login flow (no state / state.purpose = 'login'):
   *   Creates or fetches the Nebula user, issues tokens, sets cookies.
   *
   * Connect flow (state.purpose = 'connect'):
   *   Decodes userId from state, stores token, and redirects to the org-picker.
   *   The state must include `{ purpose, userId, workspace, organizationId }`.
   */
  @Public()
  @SkipResponseIntercept()
  @UseGuards(GithubAuthGuard)
  @Get('github/callback')
  async githubCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const profile = (req as any).user as {
      id: string;
      username: string;
      displayName: string;
      email: string | null;
      avatar: string | null;
      accessToken: string;
      state: Record<string, any>;
    };

    const { state: profileState, accessToken, username, id: githubId } = profile;
    const state = this.resolveConnectState(req, profileState);

    if (state?.purpose === 'connect') {
      // ── Connect flow ──
      const frontendUrl = this.configService.get<string>('app.frontendUrl');

      const [{ user: ghUser, orgs }, existingConns] = await Promise.all([
        this.connectionsService.listGithubOrgsForToken(accessToken),
        state.userId
          ? (state.workspace === 'organization' && state.organizationId
              ? this.connectionsService.listOrgConnections(state.organizationId)
              : this.connectionsService.listUserConnections(state.userId))
          : Promise.resolve([]),
      ]);

      const existingLogins: string[] = (existingConns as any[])
        .map((c) => c.providerAccountLogin)
        .filter(Boolean);

      const sid = this.pendingStore.set({
        accessToken,
        githubLogin: username,
        githubId,
        user: ghUser,
        orgs,
        userId: state.userId ?? null,
        workspace: state.workspace ?? 'personal',
        organizationId: state.organizationId ?? null,
        existingLogins,
        returnTo: this.safeReturnTo(state.returnTo),
        flow: state.flow ?? null,
      });

      res.clearCookie('nebula_github_connect_state', { path: '/' });
      return (res as any).redirect(
        `${frontendUrl}/github/connect/select?sid=${sid}`,
      );
    }

    // ── Login flow ──
    await this.handleOAuthCallback(req, res, (u) =>
      this.authService.handleGithubLogin(u),
    );
  }

  /**
   * GET /auth/github/connect/pending
   * Returns the short-lived GitHub connect picker payload stored after OAuth.
   * The `sid` is an unguessable one-time capability id so the access token
   * never has to travel in the redirect URL.
   */
  @Public()
  @Get('github/connect/pending')
  async getGithubConnectPending(@Query('sid') sid: string) {
    const payload = sid ? this.pendingStore.get(sid) : null;
    if (!payload) {
      throw new NotFoundException('GitHub connect session expired. Please try again.');
    }
    return {
      success: true,
      message: 'GitHub connect session retrieved',
      data: payload,
    };
  }

  /**
   * POST /auth/github/connect/select
   * Saves the user's selected GitHub accounts/orgs as Connections.
   * `userId` is taken from the JWT if available, falling back to the body
   * (the connect flow embeds userId in the picker state since the callback is public).
   */
  @Post('github/connect/select')
  @HttpCode(HttpStatus.CREATED)
  async githubConnectSelect(
    @CurrentUser('id') jwtUserId: string | undefined,
    @Body() body: {
      accessToken: string;
      userId?: string;
      selections: Array<{ login: string; id: string; type: 'USER' | 'ORGANIZATION' }>;
      workspace: 'personal' | 'organization';
      organizationId?: string | null;
      sid?: string;
    },
  ) {
    const userId = jwtUserId ?? body.userId;
    if (!userId) throw new Error('User ID is required');

    const { accessToken, selections, workspace, organizationId, sid } = body;
    const scopes = ['repo', 'read:org', 'user:email'];
    const orgId = workspace === 'organization' ? organizationId : null;

    const created = await Promise.all(
      selections.map((sel) =>
        this.connectionsService.storeOAuthToken({
          userId,
          orgId,
          rawToken: accessToken,
          provider: ConnectionProvider.GITHUB,
          login: sel.login,
          githubId: sel.id,
          accountType: sel.type,
          scopes,
        }),
      ),
    );

    if (sid) this.pendingStore.delete(sid);

    return {
      success: true,
      message: 'GitHub connections saved successfully',
      data: created,
    };
  }

  /**
   * GET /auth/github/orgs
   * Lists GitHub orgs accessible by the user's stored connections.
   */
  @Get('github/orgs')
  async listGithubOrgs(@CurrentUser('id') userId: string) {
    const connections = await this.connectionsService.listUserConnections(userId);
    const githubConns = connections.filter((c) => c.provider === 'GITHUB');

    return {
      success: true,
      message: 'GitHub connections retrieved',
      data: githubConns.map((c) => ({
        connectionId: c.id,
        login: (c as any).providerAccountLogin,
        githubId: (c as any).providerAccountId,
        type: (c as any).providerAccountType,
        label: c.label,
      })),
    };
  }

  // ── Google OAuth ──

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  async googleLogin() {
    // Guard initiates the OAuth redirect
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.handleOAuthCallback(req, res, (u) =>
      this.authService.handleGoogleLogin(u),
    );
  }

  private resolveConnectState(
    req: Request,
    profileState: Record<string, any> | undefined,
  ): Record<string, any> {
    if (profileState?.purpose === 'connect') {
      return profileState;
    }

    const raw = (req as any).cookies?.nebula_github_connect_state as
      | string
      | undefined;
    if (!raw) return profileState ?? {};

    try {
      return JSON.parse(
        Buffer.from(decodeURIComponent(raw), 'base64').toString(),
      );
    } catch {
      return profileState ?? {};
    }
  }

  /** Only allow in-app relative paths so connect never bounces to an external URL. */
  private safeReturnTo(path: unknown): string {
    if (typeof path !== 'string') return '/launch';
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      return '/launch';
    }
    return path;
  }

  private async handleOAuthCallback(
    req: Request,
    res: Response,
    loginFn: (
      user: any,
    ) => Promise<{ accessToken: string; refreshToken: string }>,
  ) {
    const user = req.user as any;
    const result = await loginFn(user);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    res.redirect(`${frontendUrl}`);
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const cookieOptions = this.authService.getCookieOptions(this.isProduction);
    res.cookie('nebula_access_token', accessToken, cookieOptions.access);
    res.cookie('nebula_refresh_token', refreshToken, cookieOptions.refresh);
  }

  private clearAuthCookies(res: Response) {
    const cookieOptions = this.authService.getLogoutCookieOptions();
    res.cookie('nebula_access_token', '', cookieOptions.access);
    res.cookie('nebula_refresh_token', '', cookieOptions.refresh);
  }
}
