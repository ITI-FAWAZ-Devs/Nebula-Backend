import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [UsersModule, MailModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
