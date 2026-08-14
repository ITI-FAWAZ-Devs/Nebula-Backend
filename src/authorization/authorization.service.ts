import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  PermissionValue,
  normalizePermission,
} from '../organizations/permissions';
import { MemberStatus } from '@prisma/client';

export interface CanOptions {
  userId: string;
  action: PermissionValue;
  organizationId?: string | null;
  repositoryId?: string | null;
}

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Central authorization check.
   *
   * Resolution order:
   *  1. Org owner → full access
   *  2. Org role permissions
   *  3. Team → repository grants
   *  4. Direct RepositoryMember overrides
   */
  async can({ userId, action, organizationId, repositoryId }: CanOptions): Promise<boolean> {
    if (!organizationId) {
      // Personal workspace — user owns their own repos
      return true;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) return false;

    // Org owner has implicit full access
    if (org.ownerId === userId) return true;

    // Get org membership role permissions
    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: organizationId, userId } },
      include: { role: true },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) return false;

    const rolePerms = membership.role.permissions
      .map(normalizePermission)
      .filter(Boolean) as PermissionValue[];

    if (rolePerms.includes(action)) return true;

    // If no repositoryId, org-level check only
    if (!repositoryId) return false;

    // Check team grants for this specific repo
    const teamGrant = await this.prisma.teamRepository.findFirst({
      where: {
        repositoryId,
        team: {
          orgId: organizationId,
          members: { some: { userId } },
        },
      },
    });

    if (teamGrant) {
      const teamPerms = teamGrant.permissions
        .map(normalizePermission)
        .filter(Boolean) as PermissionValue[];
      if (teamPerms.includes(action)) return true;
    }

    // Check direct repository member overrides
    const repoMember = await this.prisma.repositoryMember.findUnique({
      where: { repositoryId_userId: { repositoryId, userId } },
    });

    if (repoMember) {
      const repoPerms = repoMember.permissions
        .map(normalizePermission)
        .filter(Boolean) as PermissionValue[];
      return repoPerms.includes(action);
    }

    return false;
  }

  /**
   * Returns effective permissions for a user in an org (or for a specific repo).
   */
  async getEffectivePermissions(
    userId: string,
    organizationId: string,
    repositoryId?: string,
  ): Promise<PermissionValue[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) return [];

    if (org.ownerId === userId) return [...ALL_PERMISSIONS];

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: organizationId, userId } },
      include: { role: true },
    });

    if (!membership || membership.status !== MemberStatus.ACTIVE) return [];

    const perms = new Set<PermissionValue>(
      membership.role.permissions
        .map(normalizePermission)
        .filter(Boolean) as PermissionValue[],
    );

    if (repositoryId) {
      // Add team grants
      const teamRepos = await this.prisma.teamRepository.findMany({
        where: {
          repositoryId,
          team: {
            orgId: organizationId,
            members: { some: { userId } },
          },
        },
      });
      for (const tr of teamRepos) {
        for (const p of tr.permissions) {
          const norm = normalizePermission(p);
          if (norm) perms.add(norm);
        }
      }

      // Override with repo-level grants
      const repoMember = await this.prisma.repositoryMember.findUnique({
        where: { repositoryId_userId: { repositoryId, userId } },
      });
      if (repoMember) {
        // Repo-level permissions replace (not augment) the base set for this repo
        const repoPerms = repoMember.permissions
          .map(normalizePermission)
          .filter(Boolean) as PermissionValue[];
        return repoPerms;
      }
    }

    return [...perms];
  }
}
