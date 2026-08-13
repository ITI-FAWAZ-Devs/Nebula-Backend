import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEVELOPER_PERMISSIONS,
  VIEWER_PERMISSIONS,
  PermissionValue,
  normalizePermission,
} from './permissions';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Organization CRUD ──

  /**
   * Creates an organization. The creator becomes the owner with the Owner role.
   * Seeds four built-in roles: Owner, Admin, Developer, Viewer.
   */
  async createOrganization(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, ownerId: userId },
      });

      const ownerRole = await tx.role.create({
        data: { orgId: org.id, name: 'Owner', permissions: [...ALL_PERMISSIONS] },
      });

      await tx.role.create({
        data: { orgId: org.id, name: 'Admin', permissions: [...ADMIN_PERMISSIONS] },
      });

      await tx.role.create({
        data: { orgId: org.id, name: 'Developer', permissions: [...DEVELOPER_PERMISSIONS] },
      });

      await tx.role.create({
        data: { orgId: org.id, name: 'Viewer', permissions: [...VIEWER_PERMISSIONS] },
      });

      await tx.organizationMember.create({
        data: {
          orgId: org.id,
          userId,
          roleId: ownerRole.id,
          status: MemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });

      await this.writeAuditLog(tx, {
        actorId: userId,
        orgId: org.id,
        action: 'ORGANIZATION_CREATED',
        resourceType: 'organization',
        resourceId: org.id,
        metadata: { name },
      });

      this.logger.log(`Organization "${name}" created by user ${userId}`);
      return { ...org, ownerRole };
    });
  }

  /** Lists all organizations where the user is an ACTIVE member. */
  async listUserOrganizations(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE },
      include: {
        organization: {
          include: { _count: { select: { members: true } } },
        },
        role: true,
      },
      orderBy: { organization: { createdAt: 'desc' } },
    });

    return memberships.map((m) => ({
      ...m.organization,
      memberCount: m.organization._count.members,
      userRole: m.role,
    }));
  }

  /** Gets a single organization by ID (verifies the user is a member). */
  async getOrganization(orgId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        roles: true,
        _count: { select: { members: true } },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');

    return { ...org, memberCount: org._count.members };
  }

  /** Renames an organization (org:manage_settings). */
  async renameOrganization(orgId: string, userId: string, name: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { name },
    });

    await this.writeAuditLog(this.prisma, {
      actorId: userId,
      orgId,
      action: 'ORGANIZATION_RENAMED',
      resourceType: 'organization',
      resourceId: orgId,
      metadata: { oldName: org.name, newName: name },
    });

    return updated;
  }

  /**
   * Deletes an organization. Only the org owner may do this.
   */
  async deleteOrganization(orgId: string, userId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    if (org.ownerId !== userId) {
      throw new ForbiddenException('Only the organization owner can delete the organization');
    }

    await this.prisma.organization.delete({ where: { id: orgId } });
    this.logger.log(`Organization ${orgId} deleted by user ${userId}`);
    return { id: orgId };
  }

  // ── Role Management ──

  /** Creates a custom role within an organization. */
  async createRole(orgId: string, name: string, permissions: string[]) {
    this.validatePermissions(permissions);

    const existing = await this.prisma.role.findUnique({
      where: { orgId_name: { orgId, name } },
    });
    if (existing) {
      throw new ConflictException(`A role named "${name}" already exists in this organization`);
    }

    return this.prisma.role.create({ data: { orgId, name, permissions } });
  }

  /** Lists all roles in an organization. */
  async listRoles(orgId: string) {
    return this.prisma.role.findMany({
      where: { orgId },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Updates a custom role. Built-in roles (Owner/Admin/Developer/Viewer) cannot be modified. */
  async updateRole(roleId: string, data: { name?: string; permissions?: string[] }) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const BUILT_IN = ['Owner', 'Admin', 'Developer', 'Viewer'];
    if (BUILT_IN.includes(role.name)) {
      throw new ForbiddenException(`The ${role.name} role cannot be modified`);
    }

    if (data.permissions) this.validatePermissions(data.permissions);

    if (data.name && data.name !== role.name) {
      const duplicate = await this.prisma.role.findUnique({
        where: { orgId_name: { orgId: role.orgId, name: data.name } },
      });
      if (duplicate) throw new ConflictException(`A role named "${data.name}" already exists`);
    }

    return this.prisma.role.update({ where: { id: roleId }, data });
  }

  /** Deletes a role. Built-in roles cannot be deleted. */
  async deleteRole(roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { _count: { select: { members: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');

    const BUILT_IN = ['Owner', 'Admin', 'Developer', 'Viewer'];
    if (BUILT_IN.includes(role.name)) {
      throw new ForbiddenException(`The ${role.name} role cannot be deleted`);
    }

    if (role._count.members > 0) {
      throw new ConflictException('Cannot delete a role that has members assigned. Reassign them first.');
    }

    await this.prisma.role.delete({ where: { id: roleId } });
    return { id: roleId };
  }

  // ── Member Management ──

  /** Invites a user to the organization by email.
   *  If the user does not yet have a Nebula account the invite is stored
   *  as email-only (userId = null, inviteEmail = email) and resolved
   *  automatically when they register. */
  async inviteMember(orgId: string, email: string, roleId: string, invitedByUserId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.orgId !== orgId) {
      throw new BadRequestException('The specified role does not belong to this organization');
    }

    const invitee = await this.prisma.user.findUnique({ where: { email } });

    if (invitee) {
      // ── Known user ──
      const existingMember = await this.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: invitee.id } },
      });

      if (existingMember) {
        if (existingMember.status === MemberStatus.ACTIVE) {
          throw new ConflictException('This user is already an active member of the organization');
        }
        return this.prisma.organizationMember.update({
          where: { id: existingMember.id },
          data: { roleId, inviteToken: crypto.randomUUID(), invitedBy: invitedByUserId },
        });
      }

      const inviteToken = crypto.randomUUID();
      const member = await this.prisma.organizationMember.create({
        data: { orgId, userId: invitee.id, roleId, status: MemberStatus.PENDING, inviteToken, invitedBy: invitedByUserId },
      });

      await this.writeAuditLog(this.prisma, {
        actorId: invitedByUserId, orgId, action: 'MEMBER_INVITED',
        resourceType: 'user', resourceId: invitee.id, metadata: { email, roleId },
      });

      this.logger.log(`Existing user ${email} invited to org ${orgId}`);
      return member;
    }

    // ── Unknown email — create a pending email-only invite ──
    const existing = await this.prisma.organizationMember.findFirst({
      where: { orgId, inviteEmail: email },
    });

    if (existing) {
      if (existing.status === MemberStatus.ACTIVE) {
        throw new ConflictException('An invitation for this email already exists and has been accepted');
      }
      return this.prisma.organizationMember.update({
        where: { id: existing.id },
        data: { roleId, inviteToken: crypto.randomUUID(), invitedBy: invitedByUserId },
      });
    }

    const inviteToken = crypto.randomUUID();
    const member = await this.prisma.organizationMember.create({
      data: {
        orgId,
        userId: null,
        inviteEmail: email,
        roleId,
        status: MemberStatus.PENDING,
        inviteToken,
        invitedBy: invitedByUserId,
      },
    });

    await this.writeAuditLog(this.prisma, {
      actorId: invitedByUserId, orgId, action: 'MEMBER_INVITED',
      resourceType: 'user', resourceId: 'pending:' + email, metadata: { email, roleId, pending: true },
    });

    this.logger.log(`Email-only invite created for ${email} in org ${orgId}`);
    return { ...member, pending: true, message: 'Invitation created. The user will be added when they register with this email.' };
  }

  /** Accepts an invite. */
  async acceptInvite(inviteToken: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { inviteToken },
    });
    if (!member) throw new NotFoundException('Invalid or expired invite token');
    if (member.userId !== userId) throw new ForbiddenException('This invitation is not for you');
    if (member.status === MemberStatus.ACTIVE) {
      throw new ConflictException('You have already accepted this invitation');
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: member.id },
      data: { status: MemberStatus.ACTIVE, joinedAt: new Date(), inviteToken: null },
    });

    await this.writeAuditLog(this.prisma, {
      actorId: userId,
      orgId: member.orgId,
      action: 'MEMBER_JOINED',
      resourceType: 'user',
      resourceId: userId,
    });

    this.logger.log(`User ${userId} accepted invite to org ${member.orgId}`);
    return updated;
  }

  /** Lists members of an organization. */
  async listMembers(orgId: string) {
    return this.prisma.organizationMember.findMany({
      where: { orgId },
      include: {
        user: { select: { id: true, email: true, fullName: true, avatar: true } },
        role: { select: { id: true, name: true, permissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Changes a member's role. */
  async changeMemberRole(memberId: string, roleId: string, orgId: string) {
    const member = await this.prisma.organizationMember.findUnique({ where: { id: memberId } });
    if (!member || member.orgId !== orgId) {
      throw new NotFoundException('Member not found in this organization');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (org && member.userId === org.ownerId) {
      throw new ForbiddenException("Cannot change the organization owner's role");
    }

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.orgId !== orgId) {
      throw new BadRequestException('The specified role does not belong to this organization');
    }

    return this.prisma.organizationMember.update({ where: { id: memberId }, data: { roleId } });
  }

  /** Removes a member from the organization. Cannot remove the owner. */
  async removeMember(memberId: string, orgId: string) {
    const member = await this.prisma.organizationMember.findUnique({ where: { id: memberId } });
    if (!member || member.orgId !== orgId) {
      throw new NotFoundException('Member not found in this organization');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (org && member.userId === org.ownerId) {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    await this.prisma.organizationMember.delete({ where: { id: memberId } });
    return { id: memberId };
  }

  // ── Team Management ──

  /** Creates a team within an organization. */
  async createTeam(orgId: string, name: string, createdByUserId: string) {
    const existing = await this.prisma.team.findUnique({
      where: { orgId_name: { orgId, name } },
    });
    if (existing) throw new ConflictException(`A team named "${name}" already exists`);

    const team = await this.prisma.team.create({ data: { orgId, name } });

    await this.writeAuditLog(this.prisma, {
      actorId: createdByUserId,
      orgId,
      action: 'TEAM_CREATED',
      resourceType: 'team',
      resourceId: team.id,
      metadata: { name },
    });

    return team;
  }

  /** Lists teams in an organization. */
  async listTeams(orgId: string) {
    return this.prisma.team.findMany({
      where: { orgId },
      include: {
        _count: { select: { members: true, repositories: true } },
        members: {
          include: {
            user: { select: { id: true, email: true, fullName: true, avatar: true } },
          },
        },
        repositories: {
          include: {
            repository: { select: { id: true, name: true, owner: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adds a user to a team. */
  async addTeamMember(teamId: string, userId: string, orgId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.orgId !== orgId) throw new NotFoundException('Team not found in this organization');

    const isMember = await this.isMember(userId, orgId);
    if (!isMember) throw new BadRequestException('User is not a member of the organization');

    return this.prisma.teamMember.create({ data: { teamId, userId } }).catch(() => {
      throw new ConflictException('User is already in this team');
    });
  }

  /** Removes a user from a team. */
  async removeTeamMember(teamId: string, userId: string, orgId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.orgId !== orgId) throw new NotFoundException('Team not found');

    await this.prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
    return { teamId, userId };
  }

  /** Attaches a repo to a team with specific permissions. */
  async addTeamRepository(teamId: string, repositoryId: string, permissions: string[], orgId: string) {
    this.validatePermissions(permissions);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.orgId !== orgId) throw new NotFoundException('Team not found');

    return this.prisma.teamRepository.upsert({
      where: { teamId_repositoryId: { teamId, repositoryId } },
      create: { teamId, repositoryId, permissions },
      update: { permissions },
    });
  }

  /** Removes a repo from a team. */
  async removeTeamRepository(teamId: string, repositoryId: string, orgId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.orgId !== orgId) throw new NotFoundException('Team not found');

    await this.prisma.teamRepository.delete({
      where: { teamId_repositoryId: { teamId, repositoryId } },
    });
    return { teamId, repositoryId };
  }

  /** Deletes a team. */
  async deleteTeam(teamId: string, orgId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.orgId !== orgId) throw new NotFoundException('Team not found');

    await this.prisma.team.delete({ where: { id: teamId } });
    return { id: teamId };
  }

  // ── Repository Member Access ──

  /** Sets direct per-repo permissions for a user. */
  async setRepositoryMember(repositoryId: string, userId: string, permissions: string[], orgId: string) {
    this.validatePermissions(permissions);

    const repo = await this.prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!repo || repo.organizationId !== orgId) throw new NotFoundException('Repository not found in this organization');

    return this.prisma.repositoryMember.upsert({
      where: { repositoryId_userId: { repositoryId, userId } },
      create: { repositoryId, userId, permissions },
      update: { permissions },
    });
  }

  /** Lists per-repo member access for a repository. */
  async listRepositoryMembers(repositoryId: string, orgId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!repo || repo.organizationId !== orgId) throw new NotFoundException('Repository not found');

    return this.prisma.repositoryMember.findMany({
      where: { repositoryId },
      include: {
        user: { select: { id: true, email: true, fullName: true, avatar: true } },
      },
    });
  }

  /** Removes per-repo access for a user. */
  async removeRepositoryMember(repositoryId: string, userId: string, orgId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!repo || repo.organizationId !== orgId) throw new NotFoundException('Repository not found');

    await this.prisma.repositoryMember.delete({
      where: { repositoryId_userId: { repositoryId, userId } },
    });
    return { repositoryId, userId };
  }

  // ── Audit Logs ──

  /** Retrieves audit logs for an organization (paginated). */
  async getAuditLogs(orgId: string, limit = 50, cursor?: string) {
    return this.prisma.auditLog.findMany({
      where: { orgId },
      include: {
        actor: { select: { id: true, email: true, fullName: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  // ── Permission Helpers ──

  /**
   * Returns the permission array for a user's role in an org.
   * Returns ALL_PERMISSIONS for the org owner.
   * Returns null if the user is not an active member.
   */
  async getMemberPermissions(userId: string, orgId: string): Promise<string[] | null> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return null;
    if (org.ownerId === userId) return [...ALL_PERMISSIONS];

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { role: true },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) return null;
    return membership.role.permissions;
  }

  /** Checks if a user is an ACTIVE member (or owner) of an org. */
  async isMember(userId: string, orgId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return false;
    if (org.ownerId === userId) return true;

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    return !!membership && membership.status === MemberStatus.ACTIVE;
  }

  /**
   * Resolves any pending email-only invitations for a newly registered user.
   * Called automatically after successful registration.
   */
  /** Looks up a pending email-only invite by its token (for the quick-register flow). */
  async findEmailInviteByToken(inviteToken: string) {
    return this.prisma.organizationMember.findUnique({
      where: { inviteToken },
    });
  }

  /** Activates a resolved invite after the invited user has been created. */
  async activateInviteForUser(inviteId: string, userId: string): Promise<void> {
    await this.prisma.organizationMember.update({
      where: { id: inviteId },
      data: { userId, status: MemberStatus.ACTIVE, joinedAt: new Date(), inviteToken: null, inviteEmail: null },
    });
  }

  async resolvePendingEmailInvites(userId: string, email: string): Promise<void> {
    const pendingInvites = await this.prisma.organizationMember.findMany({
      where: { inviteEmail: email, userId: null },
    });

    for (const invite of pendingInvites) {
      await this.prisma.organizationMember.update({
        where: { id: invite.id },
        data: { userId, inviteEmail: null },
      });
      this.logger.log(`Resolved pending invite for ${email} in org ${invite.orgId}`);
    }
  }

  // ── Private Helpers ──

  private validatePermissions(permissions: string[]): void {
    const invalid = permissions.filter((p) => {
      const norm = normalizePermission(p);
      return norm === null;
    });
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid permissions: ${invalid.join(', ')}. Valid permissions: ${ALL_PERMISSIONS.join(', ')}`,
      );
    }
  }

  /** Writes an audit log entry. Accepts any Prisma transaction context. */
  async writeAuditLog(
    tx: any,
    params: {
      actorId: string;
      orgId?: string;
      action: string;
      resourceType?: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    try {
      await tx.auditLog.create({ data: params });
    } catch {
      // Audit log failure must never break the main operation
      this.logger.warn(`Failed to write audit log: ${params.action}`);
    }
  }
}
