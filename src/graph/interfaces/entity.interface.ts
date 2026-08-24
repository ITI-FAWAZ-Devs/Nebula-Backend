export type EntityType =
  | 'Repository'
  | 'Module'
  | 'Directory'
  | 'File'
  | 'Class'
  | 'Interface'
  | 'Method'
  | 'Function';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  properties?: Record<string, unknown>;
}
