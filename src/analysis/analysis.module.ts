import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ANALYSIS_QUEUE } from './analysis.constants';
import { AnalysisService } from './analysis.service';
import { AnalysisPipeline } from './analysis.pipeline';
import { AnalysisProcessor } from './analysis.processor';
import { ProgressModule } from '../progress/progress.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { GitModule } from '../git/git.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { GraphifyModule } from '../graphify/graphify.module';
import { GraphModule } from '../graph/graph.module';
import { Neo4jModule } from '../neo4j/neo4j.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
    }),
    ProgressModule,
    WorkspaceModule,
    GitModule,
    DiscoveryModule,
    GraphifyModule,
    GraphModule,
    Neo4jModule,
  ],
  providers: [AnalysisService, AnalysisPipeline, AnalysisProcessor],
  exports: [AnalysisService, BullModule],
})
export class AnalysisModule {}
