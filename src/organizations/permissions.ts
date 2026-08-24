export const Permission = {
  // ── Repository access ──────────────────────────────────────────────
  REPO_READ: 'repo.read',
  REPO_ASK: 'repo.ask',
  REPO_PROCESS: 'repo.process',
  REPO_UPDATE: 'repo.update',
  REPO_DELETE: 'repo.delete',
  REPO_SETTINGS: 'repo.settings',
  REPO_MANAGE_ACCESS: 'repo.manage_access',

  // ── Organization management ────────────────────────────────────────
  ORG_INVITE: 'org.invite',
  ORG_MANAGE_ROLES: 'org.manage_roles',
  ORG_MANAGE_SETTINGS: 'org.manage_settings',
  ORG_MANAGE_INTEGRATIONS: 'org.manage_integrations',
  ORG_BILLING: 'org.billing',
  ORG_DELETE: 'org.delete',

  // ── Teams ──────────────────────────────────────────────────────────
  TEAM_MANAGE: 'team.manage',

  // ── Connections ────────────────────────────────────────────────────
  CONNECTION_MANAGE: 'connection.manage',

  // ── Audit ──────────────────────────────────────────────────────────
  AUDIT_READ: 'audit.read',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: PermissionValue[] = Object.values(Permission);

/** Permissions granted to the built-in Admin role. */
export const ADMIN_PERMISSIONS: PermissionValue[] = [
  Permission.REPO_READ,
  Permission.REPO_ASK,
  Permission.REPO_PROCESS,
  Permission.REPO_UPDATE,
  Permission.REPO_DELETE,
  Permission.REPO_SETTINGS,
  Permission.REPO_MANAGE_ACCESS,
  Permission.ORG_INVITE,
  Permission.ORG_MANAGE_ROLES,
  Permission.ORG_MANAGE_SETTINGS,
  Permission.ORG_MANAGE_INTEGRATIONS,
  Permission.TEAM_MANAGE,
  Permission.CONNECTION_MANAGE,
  Permission.AUDIT_READ,
];

/** Permissions granted to the built-in Developer role. */
export const DEVELOPER_PERMISSIONS: PermissionValue[] = [
  Permission.REPO_READ,
  Permission.REPO_ASK,
  Permission.REPO_PROCESS,
  Permission.REPO_UPDATE,
  Permission.REPO_SETTINGS,
];

/** Permissions granted to the built-in Viewer role. */
export const VIEWER_PERMISSIONS: PermissionValue[] = [
  Permission.REPO_READ,
  // Permission.REPO_ASK,
];

/**
 * Legacy permission aliases kept for backward compatibility during migration.
 * Maps old permission strings to their new equivalents.
 */
export const LEGACY_PERMISSION_MAP: Record<string, PermissionValue> = {
  'repo:read': Permission.REPO_READ,
  'repo:import': Permission.REPO_PROCESS,
  'repo:delete': Permission.REPO_DELETE,
  'docs:read': Permission.REPO_ASK,
  'docs:write': Permission.REPO_UPDATE,
  'task:read': Permission.REPO_READ,
  'task:write': Permission.REPO_PROCESS,
  'member:invite': Permission.ORG_INVITE,
  'org:manage': Permission.ORG_MANAGE_ROLES,
  'connection:manage': Permission.CONNECTION_MANAGE,
};

/**
 * Normalizes a permission string, mapping legacy values to current ones.
 */
export function normalizePermission(p: string): PermissionValue | null {
  if (ALL_PERMISSIONS.includes(p as PermissionValue)) {
    return p as PermissionValue;
  }
  return LEGACY_PERMISSION_MAP[p] ?? null;
}
