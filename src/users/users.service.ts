import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProvider, Prisma, User } from '@prisma/client';
import { EncryptionService } from '../common/services/encryption.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByIdWithAccounts(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { accounts: true },
    });
    if (user && user.accounts) {
      user.accounts = user.accounts.map((acc) => this.decryptAccount(acc));
    }
    return user;
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
    const account = await this.prisma.account.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });
    return account ? this.decryptAccount(account) : null;
  }

  async findAccountByUserAndProvider(userId: string, provider: AuthProvider) {
    const account = await this.prisma.account.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    return account ? this.decryptAccount(account) : null;
  }

  async createAccountForUser(
    userId: string,
    data: {
      provider: AuthProvider;
      providerId: string;
      providerUsername?: string;
      providerAvatar?: string;
      accessToken?: string;
      refreshToken?: string;
    },
  ) {
    const encryptedData = { ...data };
    if (data.accessToken) {
      encryptedData.accessToken = this.encryptionService.encrypt(
        data.accessToken,
      );
    }
    if (data.refreshToken) {
      encryptedData.refreshToken = this.encryptionService.encrypt(
        data.refreshToken,
      );
    }
    const account = await this.prisma.account.create({
      data: {
        userId,
        ...encryptedData,
      },
    });
    return this.decryptAccount(account);
  }

  async updateAccount(accountId: string, data: Prisma.AccountUpdateInput) {
    const encryptedData = { ...data };
    if (data.accessToken && typeof data.accessToken === 'string') {
      encryptedData.accessToken = this.encryptionService.encrypt(
        data.accessToken,
      );
    }
    if (data.refreshToken && typeof data.refreshToken === 'string') {
      encryptedData.refreshToken = this.encryptionService.encrypt(
        data.refreshToken,
      );
    }
    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: encryptedData,
    });
    return this.decryptAccount(account);
  }

  private decryptAccount<
    T extends { accessToken?: string | null; refreshToken?: string | null },
  >(account: T): T {
    const decrypted = { ...account };
    if (account.accessToken) {
      decrypted.accessToken = this.encryptionService.decrypt(
        account.accessToken,
      );
    }
    if (account.refreshToken) {
      decrypted.refreshToken = this.encryptionService.decrypt(
        account.refreshToken,
      );
    }
    return decrypted;
  }

  // ── Verification Tokens ──

  async createVerificationToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ) {
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

  async createPasswordResetToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ) {
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
