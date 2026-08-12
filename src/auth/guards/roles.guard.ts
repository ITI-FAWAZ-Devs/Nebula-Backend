import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Global JwtAuthGuard runs first and guarantees an authenticated user.
    // Defend in depth in case the guard is used in isolation.
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `You do not have the required role (${requiredRoles.join(', ')}) to access this resource`,
      );
    }

    return true;
  }
}
