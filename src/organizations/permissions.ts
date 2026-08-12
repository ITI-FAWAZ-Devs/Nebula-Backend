export const Permission = {
  REPO_READ: 'repo:read',
  REPO_IMPORT: 'repo:import',
  REPO_DELETE: 'repo:delete',
  DOCS_READ: 'docs:read',
  DOCS_WRITE: 'docs:write',
  TASK_READ: 'task:read',
  TASK_WRITE: 'task:write',
  MEMBER_INVITE: 'member:invite',
  ORG_MANAGE: 'org:manage',
  CONNECTION_MANAGE: 'connection:manage',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: PermissionValue[] = Object.values(Permission);
