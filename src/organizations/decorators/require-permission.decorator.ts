import { SetMetadata } from '@nestjs/common';
import { PermissionValue } from '../permissions';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Decorator that marks a route as requiring a specific org-level permission.
 * Must be used with OrgPermissionGuard (applied via @UseGuards or module-level).
 *
 * Example: @RequirePermission('repo:import')
 */
export const RequirePermission = (permission: PermissionValue) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
