import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'encryption.key') {
                // Return a valid 32-byte hex key (64 hex characters)
                return 'e2c842b083ff1c801e05a8f4c284762cf8068779695ea721c5fdf68972e3d36b';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should encrypt and decrypt text correctly', () => {
    const plainText = 'gho_mySuperSecretGithubOAuthAccessToken12345';
    const encrypted = service.encrypt(plainText);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toEqual(plainText);
    expect(encrypted.split(':').length).toBe(3); // iv:authTag:encryptedContent

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toEqual(plainText);
  });

  it('should throw error when decrypting invalid formats', () => {
    expect(() => service.decrypt('invalid-string-no-colons')).toThrow();
    expect(() => service.decrypt('iv:tag')).toThrow(); // missing encrypted content
  });
});
