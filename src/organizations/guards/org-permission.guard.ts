import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { OrganizationsService } from '../organizations.service';

@Injectable()
export class OrgPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission is required, allow access
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    // Extract orgId from route params — supports both :id and :orgId
    const orgId = request.params.id || request.params.orgId;
    if (!orgId) {
      throw new ForbiddenException(
        'Organization context is required for this operation',
      );
    }

    const permissions = await this.organizationsService.getMemberPermissions(
      userId,
      orgId,
    );

    if (!permissions) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    // Support both new dotted permissions and legacy colon-based strings
    const hasPermission =
      permissions.some((p) => p === requiredPermission) ||
      permissions.some((p) => {
        // normalize legacy: 'org:manage' covers org.manage_roles + org.manage_settings
        if (requiredPermission.startsWith('org.') && p === 'org:manage')
          return true;
        if (requiredPermission.startsWith('repo.') && p === 'repo:read')
          return false; // too broad
        return false;
      });

    if (!hasPermission) {
      throw new ForbiddenException(
        `You do not have the "${requiredPermission}" permission in this organization`,
      );
    }

    return true;
  }
}
