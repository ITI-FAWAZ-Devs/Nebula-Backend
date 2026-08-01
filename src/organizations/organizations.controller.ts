import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
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

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Organization CRUD ──

  /**
   * POST /organizations
   * Creates a new organization. The caller becomes the owner.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrganization(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    const org = await this.organizationsService.createOrganization(
      userId,
      dto.name,
    );
    return {
      success: true,
      message: 'Organization created successfully',
      data: org,
    };
  }

  /**
   * GET /organizations
   * Lists organizations the user belongs to.
   */
  @Get()
  async listOrganizations(@CurrentUser('id') userId: string) {
    const orgs =
      await this.organizationsService.listUserOrganizations(userId);
    return {
      success: true,
      message: 'Organizations retrieved successfully',
      data: orgs,
    };
  }

  /**
   * GET /organizations/:id
   * Returns details for a specific organization.
   */
  @Get(':id')
  async getOrganization(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const org = await this.organizationsService.getOrganization(
      id,
      userId,
    );
    return {
      success: true,
      message: 'Organization retrieved successfully',
      data: org,
    };
  }

  // ── Role Management ──

  /**
   * POST /organizations/:id/roles
   * Creates a custom role with selected permissions.
   */
  @Post(':id/roles')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createRole(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateRoleDto,
  ) {
    const role = await this.organizationsService.createRole(
      orgId,
      dto.name,
      dto.permissions,
    );
    return {
      success: true,
      message: 'Role created successfully',
      data: role,
    };
  }

  /**
   * GET /organizations/:id/roles
   * Lists all roles in the organization.
   */
  @Get(':id/roles')
  async listRoles(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    // Verify membership first
    await this.organizationsService.getOrganization(orgId, userId);
    const roles = await this.organizationsService.listRoles(orgId);
    return {
      success: true,
      message: 'Roles retrieved successfully',
      data: roles,
    };
  }

  /**
   * PATCH /organizations/:id/roles/:roleId
   * Updates a role's name and/or permissions.
   */
  @Patch(':id/roles/:roleId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE)
  async updateRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.organizationsService.updateRole(roleId, dto);
    return {
      success: true,
      message: 'Role updated successfully',
      data: role,
    };
  }

  /**
   * DELETE /organizations/:id/roles/:roleId
   * Deletes a role (fails if members are assigned to it).
   */
  @Delete(':id/roles/:roleId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE)
  async deleteRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    const result = await this.organizationsService.deleteRole(roleId);
    return {
      success: true,
      message: 'Role deleted successfully',
      data: result,
    };
  }

  // ── Member Management ──

  /**
   * POST /organizations/:id/members/invite
   * Invites a user by email with a role assignment.
   */
  @Post(':id/members/invite')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.MEMBER_INVITE)
  @HttpCode(HttpStatus.CREATED)
  async inviteMember(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
    @Body() dto: InviteMemberDto,
  ) {
    const member = await this.organizationsService.inviteMember(
      orgId,
      dto.email,
      dto.roleId,
      userId,
    );

    // Send invite email (stub — logs if mail is not configured)
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
      // Non-fatal: invite is still created even if email fails
    }

    return {
      success: true,
      message: 'Invitation sent',
      data: {
        id: member.id,
        status: member.status,
        inviteToken: member.inviteToken,
      },
    };
  }

  /**
   * POST /organizations/invites/:token/accept
   * Accepts an organization invite. This is a public-ish route but requires auth.
   */
  @Post('invites/:token/accept')
  async acceptInvite(
    @CurrentUser('id') userId: string,
    @Param('token') token: string,
  ) {
    const member = await this.organizationsService.acceptInvite(
      token,
      userId,
    );
    return {
      success: true,
      message: 'You have joined the organization',
      data: {
        orgId: member.orgId,
        status: member.status,
        joinedAt: member.joinedAt,
      },
    };
  }

  /**
   * GET /organizations/:id/members
   * Lists all members of the organization.
   */
  @Get(':id/members')
  async listMembers(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orgId: string,
  ) {
    // Verify membership
    await this.organizationsService.getOrganization(orgId, userId);
    const members = await this.organizationsService.listMembers(orgId);
    return {
      success: true,
      message: 'Members retrieved successfully',
      data: members,
    };
  }

  /**
   * PATCH /organizations/:id/members/:memberId
   * Changes a member's role.
   */
  @Patch(':id/members/:memberId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE)
  async changeMemberRole(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    const member = await this.organizationsService.changeMemberRole(
      memberId,
      dto.roleId,
      orgId,
    );
    return {
      success: true,
      message: 'Member role updated successfully',
      data: member,
    };
  }

  /**
   * DELETE /organizations/:id/members/:memberId
   * Removes a member from the organization.
   */
  @Delete(':id/members/:memberId')
  @UseGuards(OrgPermissionGuard)
  @RequirePermission(Permission.ORG_MANAGE)
  async removeMember(
    @Param('id', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const result = await this.organizationsService.removeMember(
      memberId,
      orgId,
    );
    return {
      success: true,
      message: 'Member removed successfully',
      data: result,
    };
  }
}
