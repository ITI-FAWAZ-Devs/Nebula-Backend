import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressEventsService } from './progress-events.service';

@Module({
  controllers: [ProgressController],
  providers: [ProgressEventsService],
  exports: [ProgressEventsService],
})
export class ProgressModule {}
