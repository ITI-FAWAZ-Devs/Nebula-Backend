import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = this.configService.get<string>('mail.from')!;
    this.frontendUrl = this.configService.get<string>('app.frontendUrl')!;
    const port = this.configService.get<number>('app.port') || 4000;
    this.backendUrl = `http://localhost:${port}`;

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: this.configService.get<number>('mail.port') === 465,
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });
  }

  private loadTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      'mail',
      'templates',
      `${templateName}.hbs`,
    );
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);
    return template(context);
  }

  async sendVerificationEmail(
    email: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const verificationUrl = `${this.backendUrl}/api/auth/verify-email?token=${token}`;

    const html = this.loadTemplate('verification', {
      fullName: fullName || 'there',
      verificationUrl,
    });

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: 'Verify your Nebula account',
        html,
      });
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
    }
  }

  async sendPasswordResetEmail(
    email: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${token}`;

    const html = this.loadTemplate('reset-password', {
      fullName: fullName || 'there',
      resetUrl,
    });

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: 'Reset your Nebula password',
        html,
      });
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        error,
      );
    }
  }

  async sendOrgInviteEmail(
    email: string,
    inviterName: string,
    orgName: string,
    inviteToken: string,
  ): Promise<void> {
    const acceptUrl = `${this.frontendUrl}/organizations/invite?token=${inviteToken}`;

    const html = this.loadTemplate('org-invite', {
      inviterName,
      orgName,
      acceptUrl,
    });

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: `You've been invited to join ${orgName} on Nebula`,
        html,
      });
      this.logger.log(`Organization invite email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send organization invite email to ${email}`,
        error,
      );
    }
  }

  async sendJobCompletedEmail(params: {
    email: string;
    fullName?: string;
    repositoryName: string;
    repositoryId: string;
    pipeline: string;
  }): Promise<void> {
    const { email, fullName, repositoryName, repositoryId, pipeline } = params;

    const viewResultsUrl = this.frontendUrl
      ? `${this.frontendUrl}/workspace?repoId=${repositoryId}&repo=${encodeURIComponent(repositoryName)}`
      : null;

    const html = this.loadTemplate('job-complete', {
      fullName: fullName || 'there',
      repositoryName,
      pipeline,
      viewResultsUrl,
    });

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: `${pipeline} completed for ${repositoryName} — Nebula`,
        html,
      });
      this.logger.log(
        `Job completion email sent to ${email} (${pipeline} / ${repositoryName})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send job completion email to ${email}`,
        error,
      );
      throw error;
    }
  }
}
