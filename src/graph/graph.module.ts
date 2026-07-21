import { Module } from '@nestjs/common';
import { GraphNormalizerService } from './graph-normalizer.service';
import { GraphBuilderService } from './graph-builder.service';

@Module({
  providers: [GraphNormalizerService, GraphBuilderService],
  exports: [GraphNormalizerService, GraphBuilderService],
})
export class GraphModule {}
