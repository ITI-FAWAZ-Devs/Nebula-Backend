import { Module } from '@nestjs/common';
import { GraphifyService } from './graphify.service';
import { AstExtractorService } from './ast-extractor.service';

@Module({
  providers: [GraphifyService, AstExtractorService],
  exports: [GraphifyService, AstExtractorService],
})
export class GraphifyModule {}
