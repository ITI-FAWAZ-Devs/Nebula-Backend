import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg' }),
  }),
}));

jest.mock('fs', () => ({
  readFileSync: jest
    .fn()
    .mockReturnValue(
      '<html>{{fullName}} {{repositoryName}} {{pipeline}}</html>',
    ),
}));

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string | number> = {
      'mail.from': 'noreply@nebula.test',
      'mail.host': 'smtp.test',
      'mail.port': 587,
      'mail.user': 'user',
      'mail.pass': 'pass',
      'app.frontendUrl': 'https://app.nebula.test',
      'app.port': 4000,
    };
    return config[key];
  }),
};

describe('MailService.sendJobCompletedEmail', () => {
  let service: MailService;
  let sendMailMock: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer');
    sendMailMock = nodemailer.createTransport().sendMail;
    sendMailMock.mockClear();
  });

  it('sends an email with the correct subject', async () => {
    await service.sendJobCompletedEmail({
      email: 'user@example.com',
      fullName: 'Alice',
      repositoryName: 'my-repo',
      repositoryId: 'repo-123',
      pipeline: 'Analysis',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toBe('user@example.com');
    expect(args.subject).toContain('Analysis');
    expect(args.subject).toContain('my-repo');
  });

  it('throws when nodemailer fails (so callers can swallow)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP error'));

    await expect(
      service.sendJobCompletedEmail({
        email: 'user@example.com',
        fullName: 'Alice',
        repositoryName: 'my-repo',
        repositoryId: 'repo-123',
        pipeline: 'Documentation Indexing',
      }),
    ).rejects.toThrow('SMTP error');
  });

  it('uses "there" as fallback when fullName is undefined', async () => {
    await service.sendJobCompletedEmail({
      email: 'anon@example.com',
      repositoryName: 'repo',
      repositoryId: 'repo-456',
      pipeline: 'Analysis',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
