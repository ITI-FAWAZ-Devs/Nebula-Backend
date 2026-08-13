import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import { OrgPermissionGuard } from './guards/org-permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { Permission } from './permissions';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { CreateConnectionDto } from '../connections/dto/create-connection.dto';
import { IsString, IsNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

class CreateTeamDto {
  @IsString() @IsNotEmpty() name: string;
}

class AddTeamMemberDto {
  @IsUUID() userId: string;
}

class TeamRepositoryDto {
  @IsUUID() repositoryId: string;
  @IsArray() @IsString({ each: true }) permissions: string[];
}

class SetRepoMemberDto {
  @IsUUID() userId: string;
  @IsArray() @IsString({ each: true }) permissions: string[];
}

class RenameOrgDto {
  @IsString() @IsNotEmpty() name: string;
}

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  // ── Organization CRUD ──

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrganization(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    const org = await this.organizationsService.createOrganization(userId, dto.name);
    return { success: true, message: 'Organization created successfully', data: org };
  }

  @Get()
  async listOrganizations(@CurrentUser('id') userId: string) {
    const orgs = await this.organizationsService.listUserOrganizations(userId);
    return { success: true, message: 'Organizations retrieved successfully', data: orgs };
  }

  @Get(':id')
  async getOrganization(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const org = await this.organizationsService.getOrganization(id, userId);
    return { success: true, message: 'Organization retrieved successfully', data: org };
  }

  @Patch(':id')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_SETTINGS)
  async renameOrganization(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameOrgDto,
  ) {
    const org = await this.organizationsService.renameOrganization(id, userId, dto.name);
    return { success: true, message: 'Organization updated successfully', data: org };
  }

  @Delete(':id')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_DELETE)
  async deleteOrganization(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.organizationsService.deleteOrganization(id, userId);
    return { success: true, message: 'Organization deleted successfully', data: result };
  }

  // ── Role Management ──

  @Post(':id/roles')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createRole(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateRoleDto,
  ) {
    const role = await this.organizationsService.createRole(orgId, dto.name, dto.permissions);
    return { success: true, message: 'Role created successfully', data: role };
  }

  @Get(':id/roles')
  async listRoles(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const roles = await this.organizationsService.listRoles(orgId);
    return { success: true, message: 'Roles retrieved successfully', data: roles };
  }

  @Patch(':id/roles/:roleId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_ROLES)
  async updateRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.organizationsService.updateRole(roleId, dto);
    return { success: true, message: 'Role updated successfully', data: role };
  }

  @Delete(':id/roles/:roleId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_ROLES)
  async deleteRole(@Param('roleId', ParseUUIDPipe) roleId: string) {
    const result = await this.organizationsService.deleteRole(roleId);
    return { success: true, message: 'Role deleted successfully', data: result };
  }

  // ── Member Management ──

  @Post(':id/members/invite')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_INVITE)
  @HttpCode(HttpStatus.CREATED)
  async inviteMember(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: InviteMemberDto,
  ) {
    const member = await this.organizationsService.inviteMember(orgId, dto.email, dto.roleId, userId);

    try {
      const inviter = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, email: true },
      });
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true },
      });
      if (inviter && org && member.inviteToken) {
        await this.mailService.sendOrgInviteEmail(
          dto.email,
          inviter.fullName || inviter.email,
          org.name,
          member.inviteToken,
        );
      }
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      message: 'Invitation sent',
      data: { id: member.id, status: member.status, inviteToken: member.inviteToken },
    };
  }

  @Post('invites/:token/accept')
  async acceptInvite(
    @CurrentUser('id') userId: string,
    @Param('token') token: string,
  ) {
    const member = await this.organizationsService.acceptInvite(token, userId);
    return {
      success: true,
      message: 'You have joined the organization',
      data: { orgId: member.orgId, status: member.status, joinedAt: member.joinedAt },
    };
  }

  @Get(':id/members')
  async listMembers(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const members = await this.organizationsService.listMembers(orgId);
    return { success: true, message: 'Members retrieved successfully', data: members };
  }

  @Patch(':id/members/:memberId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_ROLES)
  async changeMemberRole(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    const member = await this.organizationsService.changeMemberRole(memberId, dto.roleId, orgId);
    return { success: true, message: 'Member role updated successfully', data: member };
  }

  @Delete(':id/members/:memberId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE_ROLES)
  async removeMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const result = await this.organizationsService.removeMember(memberId, orgId);
    return { success: true, message: 'Member removed successfully', data: result };
  }

  // ── Teams ──

  @Post(':id/teams')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createTeam(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateTeamDto,
  ) {
    const team = await this.organizationsService.createTeam(orgId, dto.name, userId);
    return { success: true, message: 'Team created successfully', data: team };
  }

  @Get(':id/teams')
  async listTeams(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const teams = await this.organizationsService.listTeams(orgId);
    return { success: true, message: 'Teams retrieved successfully', data: teams };
  }

  @Delete(':id/teams/:teamId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  async deleteTeam(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    const result = await this.organizationsService.deleteTeam(teamId, orgId);
    return { success: true, message: 'Team deleted', data: result };
  }

  @Post(':id/teams/:teamId/members')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async addTeamMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    const member = await this.organizationsService.addTeamMember(teamId, dto.userId, orgId);
    return { success: true, message: 'Member added to team', data: member };
  }

  @Delete(':id/teams/:teamId/members/:userId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  async removeTeamMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const result = await this.organizationsService.removeTeamMember(teamId, userId, orgId);
    return { success: true, message: 'Member removed from team', data: result };
  }

  @Post(':id/teams/:teamId/repositories')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async addTeamRepository(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: TeamRepositoryDto,
  ) {
    const result = await this.organizationsService.addTeamRepository(
      teamId, dto.repositoryId, dto.permissions, orgId,
    );
    return { success: true, message: 'Repository attached to team', data: result };
  }

  @Delete(':id/teams/:teamId/repositories/:repositoryId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.TEAM_MANAGE)
  async removeTeamRepository(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    const result = await this.organizationsService.removeTeamRepository(teamId, repositoryId, orgId);
    return { success: true, message: 'Repository removed from team', data: result };
  }

  // ── Repository Member Access ──

  @Get(':id/repositories/:repoId/members')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.REPO_MANAGE_ACCESS)
  async listRepositoryMembers(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('repoId', ParseUUIDPipe) repoId: string,
  ) {
    const members = await this.organizationsService.listRepositoryMembers(repoId, orgId);
    return { success: true, message: 'Repository members retrieved', data: members };
  }

  @Post(':id/repositories/:repoId/members')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.REPO_MANAGE_ACCESS)
  @HttpCode(HttpStatus.CREATED)
  async setRepositoryMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('repoId', ParseUUIDPipe) repoId: string,
    @Body() dto: SetRepoMemberDto,
  ) {
    const result = await this.organizationsService.setRepositoryMember(repoId, dto.userId, dto.permissions, orgId);
    return { success: true, message: 'Repository access updated', data: result };
  }

  @Delete(':id/repositories/:repoId/members/:userId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.REPO_MANAGE_ACCESS)
  async removeRepositoryMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('repoId', ParseUUIDPipe) repoId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const result = await this.organizationsService.removeRepositoryMember(repoId, userId, orgId);
    return { success: true, message: 'Repository access removed', data: result };
  }

  // ── Organization Repositories ──

  @Get(':id/repositories')
  async listOrgRepositories(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const repos = await this.prisma.repository.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, message: 'Organization repositories retrieved successfully', data: repos };
  }

  // ── Organization Connections ──

  @Post(':id/connections')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.CONNECTION_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createOrgConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    const connection = await this.connectionsService.createOrgConnection(userId, orgId, dto);
    const { encryptedToken, ...safeData } = connection;
    return { success: true, message: 'Organization connection created successfully', data: safeData };
  }

  @Get(':id/connections')
  async listOrgConnections(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const connections = await this.connectionsService.listOrgConnections(orgId);
    return { success: true, message: 'Organization connections retrieved successfully', data: connections };
  }

  @Delete(':id/connections/:connId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.CONNECTION_MANAGE)
  async deleteOrgConnection(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('connId', ParseUUIDPipe) connId: string,
  ) {
    await this.connectionsService.deleteOrgConnection(connId, orgId);
    return { success: true, message: 'Organization connection deleted successfully' };
  }

  // ── Audit Logs ──

  @Get(':id/audit-logs')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.AUDIT_READ)
  async getAuditLogs(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    await this.organizationsService.getOrganization(orgId, userId);
    const logs = await this.organizationsService.getAuditLogs(orgId, limit, cursor);
    return { success: true, message: 'Audit logs retrieved', data: logs };
  }
}
