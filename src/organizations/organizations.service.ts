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
import { ALL_PERMISSIONS, PermissionValue } from './permissions';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Organization CRUD ──

  /**
   * Creates an organization. The creator becomes the owner with a full-permission "Owner" role.
   */
  async createOrganization(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, ownerId: userId },
      });

      const ownerRole = await tx.role.create({
        data: {
          orgId: org.id,
          name: 'Owner',
          permissions: [...ALL_PERMISSIONS],
        },
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

      this.logger.log(
        `Organization "${name}" created by user ${userId}`,
      );

      return { ...org, ownerRole };
    });
  }

  /**
   * Lists all organizations where the user is an ACTIVE member.
   */
  async listUserOrganizations(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE },
      include: {
        organization: {
          include: {
            _count: { select: { members: true } },
          },
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

  /**
   * Gets a single organization by ID (verifies the user is a member).
   */
  async getOrganization(orgId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) {
      throw new ForbiddenException(
        'You are not a member of this organization',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        roles: true,
        _count: { select: { members: true } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return { ...org, memberCount: org._count.members };
  }

  // ── Role Management ──

  /**
   * Creates a custom role within an organization.
   */
  async createRole(orgId: string, name: string, permissions: string[]) {
    // Validate permissions against the catalog
    this.validatePermissions(permissions);

    // Check for duplicate role name
    const existing = await this.prisma.role.findUnique({
      where: { orgId_name: { orgId, name } },
    });
    if (existing) {
      throw new ConflictException(
        `A role named "${name}" already exists in this organization`,
      );
    }

    return this.prisma.role.create({
      data: { orgId, name, permissions },
    });
  }

  /**
   * Lists all roles in an organization.
   */
  async listRoles(orgId: string) {
    return this.prisma.role.findMany({
      where: { orgId },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Updates a role's name and/or permissions. Prevents editing the "Owner" role.
   */
  async updateRole(
    roleId: string,
    data: { name?: string; permissions?: string[] },
  ) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.name === 'Owner') {
      throw new ForbiddenException('The Owner role cannot be modified');
    }
    if (data.permissions) {
      this.validatePermissions(data.permissions);
    }
    if (data.name && data.name !== role.name) {
      const duplicate = await this.prisma.role.findUnique({
        where: { orgId_name: { orgId: role.orgId, name: data.name } },
      });
      if (duplicate) {
        throw new ConflictException(
          `A role named "${data.name}" already exists`,
        );
      }
    }

    return this.prisma.role.update({
      where: { id: roleId },
      data,
    });
  }

  /**
   * Deletes a role. Fails if any members are assigned to it.
   */
  async deleteRole(roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { _count: { select: { members: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.name === 'Owner') {
      throw new ForbiddenException('The Owner role cannot be deleted');
    }
    if (role._count.members > 0) {
      throw new ConflictException(
        'Cannot delete a role that has members assigned to it. Reassign them first.',
      );
    }

    await this.prisma.role.delete({ where: { id: roleId } });
    return { id: roleId };
  }

  // ── Member Management ──

  /**
   * Invites a user to the organization by email. Creates a PENDING membership
   * and generates a unique invite token.
   */
  async inviteMember(
    orgId: string,
    email: string,
    roleId: string,
    invitedByUserId: string,
  ) {
    // Verify role belongs to this org
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });
    if (!role || role.orgId !== orgId) {
      throw new BadRequestException(
        'The specified role does not belong to this organization',
      );
    }

    // Find the user by email
    const invitee = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!invitee) {
      throw new NotFoundException(
        'No user found with this email address. They must create a Nebula account first.',
      );
    }

    // Check if already a member
    const existingMember =
      await this.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: invitee.id } },
      });
    if (existingMember) {
      if (existingMember.status === MemberStatus.ACTIVE) {
        throw new ConflictException(
          'This user is already an active member of the organization',
        );
      }
      // Re-send invite: update the existing PENDING record
      const updated = await this.prisma.organizationMember.update({
        where: { id: existingMember.id },
        data: {
          roleId,
          inviteToken: crypto.randomUUID(),
          invitedBy: invitedByUserId,
        },
      });
      return updated;
    }

    const inviteToken = crypto.randomUUID();
    const member = await this.prisma.organizationMember.create({
      data: {
        orgId,
        userId: invitee.id,
        roleId,
        status: MemberStatus.PENDING,
        inviteToken,
        invitedBy: invitedByUserId,
      },
    });

    this.logger.log(
      `User ${email} invited to org ${orgId} by ${invitedByUserId}`,
    );

    return member;
  }

  /**
   * Accepts an invite. The member becomes ACTIVE.
   */
  async acceptInvite(inviteToken: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { inviteToken },
    });
    if (!member) {
      throw new NotFoundException('Invalid or expired invite token');
    }
    if (member.userId !== userId) {
      throw new ForbiddenException('This invitation is not for you');
    }
    if (member.status === MemberStatus.ACTIVE) {
      throw new ConflictException('You have already accepted this invitation');
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: member.id },
      data: {
        status: MemberStatus.ACTIVE,
        joinedAt: new Date(),
        inviteToken: null, // Consume the token
      },
    });

    this.logger.log(
      `User ${userId} accepted invite to org ${member.orgId}`,
    );

    return updated;
  }

  /**
   * Lists members of an organization.
   */
  async listMembers(orgId: string) {
    return this.prisma.organizationMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, avatar: true },
        },
        role: {
          select: { id: true, name: true, permissions: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Changes a member's role.
   */
  async changeMemberRole(memberId: string, roleId: string, orgId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.orgId !== orgId) {
      throw new NotFoundException('Member not found in this organization');
    }

    // Prevent changing the org owner's role
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (org && member.userId === org.ownerId) {
      throw new ForbiddenException(
        'Cannot change the organization owner\'s role',
      );
    }

    // Verify the target role belongs to this org
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });
    if (!role || role.orgId !== orgId) {
      throw new BadRequestException(
        'The specified role does not belong to this organization',
      );
    }

    return this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { roleId },
    });
  }

  /**
   * Removes a member from the organization. Cannot remove the owner.
   */
  async removeMember(memberId: string, orgId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.orgId !== orgId) {
      throw new NotFoundException('Member not found in this organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (org && member.userId === org.ownerId) {
      throw new ForbiddenException(
        'Cannot remove the organization owner',
      );
    }

    await this.prisma.organizationMember.delete({
      where: { id: memberId },
    });

    return { id: memberId };
  }

  // ── Permission Helpers ──

  /**
   * Returns the permission array for a user's role in an org.
   * Returns ALL_PERMISSIONS for the org owner (implicit full access).
   * Returns null if the user is not an active member.
   */
  async getMemberPermissions(
    userId: string,
    orgId: string,
  ): Promise<string[] | null> {
    // Check if user is the org owner (implicit full access)
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) return null;
    if (org.ownerId === userId) {
      return [...ALL_PERMISSIONS];
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { role: true },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) {
      return null;
    }

    return membership.role.permissions;
  }

  /**
   * Checks if a user is a member (ACTIVE) of the org or is the owner.
   */
  async isMember(userId: string, orgId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) return false;
    if (org.ownerId === userId) return true;

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    return !!membership && membership.status === MemberStatus.ACTIVE;
  }

  // ── Private Helpers ──

  private validatePermissions(permissions: string[]): void {
    const invalid = permissions.filter(
      (p) => !ALL_PERMISSIONS.includes(p as PermissionValue),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid permissions: ${invalid.join(', ')}. Valid permissions: ${ALL_PERMISSIONS.join(', ')}`,
      );
    }
  }
}
