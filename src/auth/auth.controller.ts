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
    this.isProduction = this.configService.get<string>('app.nodeEnv') === 'production';
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
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
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
      res.send(`
        <html>
          <head><title>Email Verified</title></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
            <div style="text-align: center; padding: 2rem; border-radius: 12px; background: #1e293b; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
              <h1 style="color: #22c55e;">✅ Email Verified!</h1>
              <p>Your email has been verified successfully.</p>
              <p style="color: #94a3b8;">You can now close this tab and log in.</p>
            </div>
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
    const user = req.user as any;
    const result = await this.authService.handleGithubLogin(user);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    // Redirect to frontend with tokens (for OAuth callback handling)
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${result.accessToken}&refreshToken=${result.refreshToken}`,
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
    const user = req.user as any;
    const result = await this.authService.handleGoogleLogin(user);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    // Redirect to frontend with tokens (for OAuth callback handling)
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${result.accessToken}&refreshToken=${result.refreshToken}`,
    );
  }

  // ── Private Helpers ──

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
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
