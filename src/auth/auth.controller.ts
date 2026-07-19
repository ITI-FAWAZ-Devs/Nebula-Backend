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
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
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
    // Guard initiates the OAuth redirect
  }

  @Public()
  @UseGuards(GithubAuthGuard)
  @Get('github/callback')
  async githubCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.handleOAuthCallback(req, res, (u) =>
      this.authService.handleGithubLogin(u),
    );
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
