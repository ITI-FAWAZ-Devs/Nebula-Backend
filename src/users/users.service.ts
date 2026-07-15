import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProvider, Prisma, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByIdWithAccounts(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { accounts: true },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async updateRefreshToken(
    userId: string,
    hashedRefreshToken: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    });
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  // ── OAuth Account Management ──

  async findAccountByProvider(provider: AuthProvider, providerId: string) {
    return this.prisma.account.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });
  }

  async findAccountByUserAndProvider(userId: string, provider: AuthProvider) {
    return this.prisma.account.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  async createAccountForUser(
    userId: string,
    data: {
      provider: AuthProvider;
      providerId: string;
      providerUsername?: string;
      providerAvatar?: string;
      accessToken?: string;
    },
  ) {
    return this.prisma.account.create({
      data: {
        userId,
        ...data,
      },
    });
  }

  async updateAccount(
    accountId: string,
    data: Prisma.AccountUpdateInput,
  ) {
    return this.prisma.account.update({
      where: { id: accountId },
      data,
    });
  }

  // ── Verification Tokens ──

  async createVerificationToken(userId: string, token: string, expiresAt: Date) {
    return this.prisma.verificationToken.create({
      data: { userId, token, expiresAt },
    });
  }

  async findVerificationToken(token: string) {
    return this.prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async deleteVerificationToken(id: string) {
    return this.prisma.verificationToken.delete({ where: { id } });
  }

  async deleteUserVerificationTokens(userId: string) {
    return this.prisma.verificationToken.deleteMany({
      where: { userId },
    });
  }

  // ── Password Reset Tokens ──

  async createPasswordResetToken(userId: string, token: string, expiresAt: Date) {
    return this.prisma.passwordResetToken.create({
      data: { userId, token, expiresAt },
    });
  }

  async findPasswordResetToken(token: string) {
    return this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async markPasswordResetTokenUsed(id: string) {
    return this.prisma.passwordResetToken.update({
      where: { id },
      data: { used: true },
    });
  }
}
