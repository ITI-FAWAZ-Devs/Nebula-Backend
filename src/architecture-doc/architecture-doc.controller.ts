import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ArchitectureDocService } from './architecture-doc.service';
import { CreateArchitectureDocDto } from './dto/architecture-doc.dto';

@Controller('repositories/:repositoryId/architecture-doc')
export class ArchitectureDocController {
  constructor(private readonly architectureDocService: ArchitectureDocService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() dto: CreateArchitectureDocDto,
  ) {
    const data = await this.architectureDocService.start(
      userId,
      repositoryId,
      dto,
    );
    return {
      success: true,
      message: 'Architecture document generation accepted',
      data,
    };
  }

  @Get()
  async getLatestCompleted(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const data = await this.architectureDocService.getLatestCompleted(
      userId,
      repositoryId,
    );
    return {
      success: true,
      message: 'Latest completed architecture document retrieved successfully',
      data,
    };
  }

  @Get('jobs/:jobId')
  async getJob(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const data = await this.architectureDocService.getJob(
      userId,
      repositoryId,
      jobId,
    );
    return {
      success: true,
      message: 'Architecture document job retrieved successfully',
      data,
    };
  }

  @Get('versions')
  async listVersions(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const data = await this.architectureDocService.listVersions(
      userId,
      repositoryId,
    );
    return {
      success: true,
      message: 'Architecture document version history retrieved successfully',
      data,
    };
  }

  @Get('versions/:version')
  async getVersion(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const data = await this.architectureDocService.getVersion(
      userId,
      repositoryId,
      version,
    );
    return {
      success: true,
      message: 'Architecture document version retrieved successfully',
      data,
    };
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerate(
    @CurrentUser('id') userId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() dto: CreateArchitectureDocDto,
  ) {
    const data = await this.architectureDocService.start(
      userId,
      repositoryId,
      dto,
    );
    return {
      success: true,
      message: 'Architecture document regeneration accepted',
      data,
    };
  }
}
