import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * GET /admin/users
   * Lists all users with pagination and optional search.
   * ADMIN only.
   */
  @Get('users')
  async listUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const result = await this.adminService.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      search,
    });
    return {
      success: true,
      message: 'Users retrieved successfully',
      data: result,
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
