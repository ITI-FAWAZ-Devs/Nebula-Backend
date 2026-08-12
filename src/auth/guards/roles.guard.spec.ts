import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const createContext = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext({ role: UserRole.USER }))).toBe(
      true,
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('should allow an admin user to access a route requiring ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(createContext({ role: UserRole.ADMIN }))).toBe(
      true,
    );
  });

  it('should throw ForbiddenException for a normal user', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() =>
      guard.canActivate(createContext({ role: UserRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('should throw UnauthorizedException when no user is present', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(createContext(null))).toThrow(
      UnauthorizedException,
    );
  });
});
