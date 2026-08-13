import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepositoriesService } from './admin-repositories.service';
import { ArchitectureDocModule } from '../architecture-doc/architecture-doc.module';
import { ChromaModule } from '../chroma/chroma.module';
import { GitModule } from '../git/git.module';
import { Neo4jModule } from '../neo4j/neo4j.module';

@Module({
  imports: [ArchitectureDocModule, ChromaModule, GitModule, Neo4jModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRepositoriesService],
  exports: [AdminService, AdminRepositoriesService],
})
export class AdminModule {}
