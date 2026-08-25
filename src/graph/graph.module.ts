import { Module } from '@nestjs/common';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { GraphNormalizerService } from './graph-normalizer.service';
import { GraphBuilderService } from './graph-builder.service';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';

@Module({
  imports: [Neo4jModule],
  controllers: [GraphController],
  providers: [GraphNormalizerService, GraphBuilderService, GraphService],
  exports: [GraphNormalizerService, GraphBuilderService, GraphService],
})
export class GraphModule {}
