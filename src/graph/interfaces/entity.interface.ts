export type EntityType =
  | 'Repository'
  | 'Module'
  | 'Directory'
  | 'File'
  | 'Class'
  | 'Interface'
  | 'Method'
  | 'Function'
  | 'Enum'
  | 'TypeAlias'
  | 'Endpoint'
  | 'Service'
  | 'Component';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  properties?: Record<string, unknown>;
}
