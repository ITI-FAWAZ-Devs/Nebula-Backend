import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepositoriesService } from './admin-repositories.service';
import { AdminDocumentationJobsService } from './admin-documentation-jobs.service';
import { ArchitectureDocModule } from '../architecture-doc/architecture-doc.module';
import { ChromaModule } from '../chroma/chroma.module';
import { GitModule } from '../git/git.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { ProgressModule } from '../progress/progress.module';
import { DOCUMENTATION_QUEUE } from '../repositories/documentation.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: DOCUMENTATION_QUEUE }),
    ProgressModule,
    ArchitectureDocModule,
    ChromaModule,
    GitModule,
    Neo4jModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminRepositoriesService,
    AdminDocumentationJobsService,
  ],
  exports: [
    AdminService,
    AdminRepositoriesService,
    AdminDocumentationJobsService,
  ],
})
export class AdminModule {}
