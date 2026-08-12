import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto } from './dto/create-connection.dto';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createConnection(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    const connection = await this.connectionsService.createConnection(
      userId,
      dto,
    );
    const { encryptedToken, ...safeData } = connection;
    return {
      success: true,
      message: 'Connection created successfully',
      data: safeData,
    };
  }

  @Get()
  async listConnections(@CurrentUser('id') userId: string) {
    const connections =
      await this.connectionsService.listUserConnections(userId);
    return {
      success: true,
      message: 'Connections retrieved successfully',
      data: connections,
    };
  }

  @Get(':id')
  async getConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const connection = await this.connectionsService.getConnectionById(
      id,
      userId,
    );
    const { encryptedToken, ...safeData } = connection;
    return {
      success: true,
      message: 'Connection retrieved successfully',
      data: safeData,
    };
  }

  @Delete(':id')
  async deleteConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.connectionsService.deleteConnection(id, userId);
    return {
      success: true,
      message: 'Connection deleted successfully',
    };
  }
}
