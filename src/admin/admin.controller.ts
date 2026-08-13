import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Delete,
  Post,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { AdminRepositoriesService } from './admin-repositories.service';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminListRepositoriesQueryDto } from './dto/admin-list-repositories-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminRepositoriesService: AdminRepositoriesService,
  ) {}

  /**
   * GET /admin/users
   * Lists all users with pagination, optional search and role filter.
   * ADMIN only.
   */
  @Get('users')
  async listUsers(@Query() query: AdminListUsersQueryDto) {
    const result = await this.adminService.listUsers(query);
    return {
      success: true,
      message: 'Users retrieved successfully',
      data: result,
    };
  }

  /**
   * GET /admin/users/:id
   * Returns aggregated, non-sensitive details for a single user. ADMIN only.
   */
  @Get('users/:id')
  async getUserById(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.adminService.getUserById(id);
    return {
      success: true,
      message: 'User retrieved successfully',
      data: user,
    };
  }

  /**
   * DELETE /admin/users/:id
   * Deletes a user account. Refuses when the user owns repositories or
   * organizations, or when the target is the caller or the last admin.
   * ADMIN only.
   */
  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') requestingAdminId: string,
  ) {
    await this.adminService.deleteUser(id, requestingAdminId);
    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  /**
   * GET /admin/stats
   * Returns high-level platform stats. ADMIN only.
   */
  @Get('stats')
  async getStats() {
    const stats = await this.adminService.getStats();
    return {
      success: true,
      message: 'Stats retrieved successfully',
      data: stats,
    };
  }

  /**
   * GET /admin/dashboard/stats
   * Returns platform-level statistics for the Admin Dashboard. ADMIN only.
   */
  @Get('dashboard/stats')
  async getDashboardStats() {
    const stats = await this.adminService.getDashboardStats();
    return {
      success: true,
      message: 'Dashboard statistics retrieved successfully',
      data: stats,
    };
  }

  /**
   * PATCH /admin/users/:id/role
   * Promotes or demotes a user's role. ADMIN only.
   */
  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  async updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    const user = await this.adminService.updateUserRole(id, dto.role);
    return {
      success: true,
      message: 'User role updated successfully',
      data: user,
    };
  }

  /**
   * GET /admin/repositories
   * Lists all repositories platform-wide with pagination, search, filtering
   * (documentation status, repository status, owner, user) and sorting by
   * creation/import date. ADMIN only.
   */
  @Get('repositories')
  async listRepositories(@Query() query: AdminListRepositoriesQueryDto) {
    const result = await this.adminRepositoriesService.listRepositories(query);
    return {
      success: true,
      message: 'Repositories retrieved successfully',
      data: result,
    };
  }

  /**
   * GET /admin/repositories/:id
   * Returns detailed, non-sensitive information for a single repository
   * including documentation/analysis activity. ADMIN only.
   */
  @Get('repositories/:id')
  async getRepositoryById(@Param('id', ParseUUIDPipe) id: string) {
    const repository =
      await this.adminRepositoriesService.getRepositoryById(id);
    return {
      success: true,
      message: 'Repository retrieved successfully',
      data: repository,
    };
  }

  /**
   * DELETE /admin/repositories/:id
   * Deletes a repository and its derived data (documentation, embeddings,
   * knowledge graph, local clone). Refuses while jobs are in flight. ADMIN only.
   */
  @Delete('repositories/:id')
  @HttpCode(HttpStatus.OK)
  async deleteRepository(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') requestingAdminId: string,
  ) {
    const result = await this.adminRepositoriesService.deleteRepository(
      id,
      requestingAdminId,
    );
    return {
      success: true,
      message: 'Repository deleted successfully',
      data: result,
    };
  }

  /**
   * POST /admin/repositories/:id/documentation/regenerate
   * Triggers regeneration of the latest architecture document for a repository
   * through the existing drafting pipeline. ADMIN only.
   */
  @Post('repositories/:id/documentation/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateRepositoryDocumentation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') requestingAdminId: string,
  ) {
    const result = await this.adminRepositoriesService.regenerateDocumentation(
      id,
      requestingAdminId,
    );
    return {
      success: true,
      message: 'Documentation regeneration request processed',
      data: result,
    };
  }
}
