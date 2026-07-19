import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { EncryptionService } from '../common/services/encryption.service';

@Module({
  providers: [UsersService, EncryptionService],
  exports: [UsersService, EncryptionService],
})
export class UsersModule {}
