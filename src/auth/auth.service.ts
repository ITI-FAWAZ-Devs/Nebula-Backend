import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, AuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ApiResponse } from '../common/interfaces/api-response.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  // ── Register ──

  async register(dto: RegisterDto): Promise<ApiResponse> {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const hashedPassword = await argon2.hash(dto.password);

    const user = await this.usersService.create({
      email: dto.email,
      password: hashedPassword,
      fullName: dto.fullName,
    });

    // Generate email verification token
    const verificationToken = this.tokenService.generateSecureToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.usersService.createVerificationToken(
      user.id,
      verificationToken,
      expiresAt,
    );

    // Send verification email (non-blocking)
    this.mailService
      .sendVerificationEmail(user.email, user.fullName ?? '', verificationToken)
      .catch((err) => this.logger.error('Failed to send verification email', err));

    return {
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      data: { userId: user.id },
    };
  }

  // ── Login ──

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.password, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  // ── Logout ──

  async logout(userId: string): Promise<ApiResponse> {
    await this.usersService.updateRefreshToken(userId, null);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  // ── Refresh Tokens ──

  async refreshTokens(user: User) {
    return this.issueTokens(user);
  }

  // ── Email Verification ──

  async verifyEmail(dto: VerifyEmailDto): Promise<ApiResponse> {
    const record = await this.usersService.findVerificationToken(dto.token);

    if (!record) {
      throw new BadRequestException('Invalid verification token');
    }

    if (record.expiresAt < new Date()) {
      await this.usersService.deleteVerificationToken(record.id);
      throw new BadRequestException('Verification token has expired');
    }

    await this.usersService.markEmailVerified(record.userId);
    await this.usersService.deleteUserVerificationTokens(record.userId);

    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  // ── Forgot Password ──

  async forgotPassword(dto: ForgotPasswordDto): Promise<ApiResponse> {
    const user = await this.usersService.findByEmail(dto.email);

    // Always return success to prevent email enumeration
    if (!user) {
      return {
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
    }

    const resetToken = this.tokenService.generateSecureToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.usersService.createPasswordResetToken(
      user.id,
      resetToken,
      expiresAt,
    );

    this.mailService
      .sendPasswordResetEmail(user.email, user.fullName ?? '', resetToken)
      .catch((err) => this.logger.error('Failed to send password reset email', err));

    return {
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  // ── Reset Password ──

  async resetPassword(dto: ResetPasswordDto): Promise<ApiResponse> {
    const record = await this.usersService.findPasswordResetToken(dto.token);

    if (!record || record.used) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    const hashedPassword = await argon2.hash(dto.newPassword);
    await this.usersService.updatePassword(record.userId, hashedPassword);
    await this.usersService.markPasswordResetTokenUsed(record.id);

    // Invalidate all sessions by clearing refresh token
    await this.usersService.updateRefreshToken(record.userId, null);

    return {
      success: true,
      message: 'Password has been reset successfully',
    };
  }

  // ── Change Password ──

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<ApiResponse> {
    const user = await this.usersService.findById(userId);

    if (!user || !user.password) {
      throw new BadRequestException(
        'Cannot change password for accounts without a password. Use OAuth to sign in.',
      );
    }

    const passwordValid = await argon2.verify(user.password, dto.currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await argon2.hash(dto.newPassword);
    await this.usersService.updatePassword(userId, hashedPassword);

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  // ── Get Profile ──

  async getProfile(userId: string) {
    const user = await this.usersService.findByIdWithAccounts(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Strip sensitive fields
    const { password, refreshToken, ...profile } = user;

    return {
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        ...profile,
        accounts: profile.accounts.map(({ accessToken, refreshToken, ...acc }) => acc),
      },
    };
  }

  // ── GitHub OAuth ──

  async handleGithubLogin(githubProfile: {
    id: string;
    username: string;
    displayName: string;
    email: string;
    avatar: string;
    accessToken: string;
  }) {
    const { id: githubId, username, displayName, email, avatar, accessToken } = githubProfile;

    // Check if this GitHub account is already linked
    const existingAccount = await this.usersService.findAccountByProvider(
      AuthProvider.GITHUB,
      githubId,
    );

    if (existingAccount) {
      // Update the stored access token and profile info
      await this.usersService.updateAccount(existingAccount.id, {
        accessToken,
        providerUsername: username,
        providerAvatar: avatar,
      });

      return this.issueTokens(existingAccount.user);
    }

    // Check if a user with this email already exists (link accounts)
    let user = email ? await this.usersService.findByEmail(email) : null;

    if (user) {
      // Link GitHub to existing user
      await this.usersService.createAccountForUser(user.id, {
        provider: AuthProvider.GITHUB,
        providerId: githubId,
        providerUsername: username,
        providerAvatar: avatar,
        accessToken,
      });

      // Update avatar if user doesn't have one
      if (!user.avatar && avatar) {
        await this.usersService.update(user.id, { avatar });
      }
    } else {
      // Create a new user + account
      user = await this.usersService.create({
        email: email || `${githubId}@github.nebula.dev`,
        fullName: displayName || username,
        avatar,
        isEmailVerified: !!email, // GitHub emails are pre-verified
        accounts: {
          create: {
            provider: AuthProvider.GITHUB,
            providerId: githubId,
            providerUsername: username,
            providerAvatar: avatar,
            accessToken,
          },
        },
      });
    }

    return this.issueTokens(user);
  }

  // ── Google OAuth ──

  async handleGoogleLogin(googleProfile: {
    id: string;
    displayName: string;
    email: string;
    avatar: string;
    accessToken: string;
  }) {
    const { id: googleId, displayName, email, avatar, accessToken } = googleProfile;

    // Check if this Google account is already linked
    const existingAccount = await this.usersService.findAccountByProvider(
      AuthProvider.GOOGLE,
      googleId,
    );

    if (existingAccount) {
      // Update the stored access token and profile info
      await this.usersService.updateAccount(existingAccount.id, {
        accessToken,
        providerAvatar: avatar,
      });

      return this.issueTokens(existingAccount.user);
    }

    // Check if a user with this email already exists (link accounts)
    let user = email ? await this.usersService.findByEmail(email) : null;

    if (user) {
      // Link Google to existing user
      await this.usersService.createAccountForUser(user.id, {
        provider: AuthProvider.GOOGLE,
        providerId: googleId,
        providerAvatar: avatar,
        accessToken,
      });

      // Update avatar if user doesn't have one
      if (!user.avatar && avatar) {
        await this.usersService.update(user.id, { avatar });
      }
    } else {
      // Create a new user + account
      user = await this.usersService.create({
        email: email || `${googleId}@google.nebula.dev`,
        fullName: displayName,
        avatar,
        isEmailVerified: !!email, // Google emails are pre-verified
        accounts: {
          create: {
            provider: AuthProvider.GOOGLE,
            providerId: googleId,
            providerAvatar: avatar,
            accessToken,
          },
        },
      });
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: User) {
    const tokens = await this.tokenService.generateTokenPair(user.id, user.email);

    // Hash and store the refresh token
    const hashedRefreshToken = await this.tokenService.hashToken(tokens.refreshToken);
    await this.usersService.updateRefreshToken(user.id, hashedRefreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  getCookieOptions(isProduction: boolean) {
    return {
      access: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: this.tokenService.getAccessTokenMaxAge(),
      },
      refresh: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/auth/refresh',
        maxAge: this.tokenService.getRefreshTokenMaxAge(),
      },
    };
  }

  getLogoutCookieOptions() {
    return {
      access: {
        httpOnly: true,
        path: '/',
        maxAge: 0,
      },
      refresh: {
        httpOnly: true,
        path: '/auth/refresh',
        maxAge: 0,
      },
    };
  }
}
