import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Delete,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
}
