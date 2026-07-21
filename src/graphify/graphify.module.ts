import { Module } from '@nestjs/common';
import { GraphifyService } from './graphify.service';

@Module({
  providers: [GraphifyService],
  exports: [GraphifyService],
})
export class GraphifyModule {}
