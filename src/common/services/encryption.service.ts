import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('encryption.key');
    if (!rawKey) {
      throw new Error('ENCRYPTION_KEY environment variable is not defined');
    }

    // Check if key is a 64-char hex string (32 bytes) or 32-char plain string
    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      this.key = Buffer.from(rawKey, 'hex');
    } else if (rawKey.length === 32) {
      this.key = Buffer.from(rawKey, 'utf8');
    } else {
      throw new Error(
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes) or a 32-character plain text string.',
      );
    }
  }

  /**
   * Encrypts plaintext string using AES-256-GCM
   */
  encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(12); // Standard 12-byte IV for GCM
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag().toString('hex');

      // Return iv, auth tag, and encrypted content in standard colon separated format
      return `${iv.toString('hex')}:${tag}:${encrypted}`;
    } catch (error) {
      throw new InternalServerErrorException('Token encryption failed');
    }
  }

  /**
   * Decrypts encrypted string format (iv:tag:encryptedContent) using AES-256-GCM
   */
  decrypt(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
      }

      const [ivHex, tagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new InternalServerErrorException('Token decryption failed');
    }
  }
}
