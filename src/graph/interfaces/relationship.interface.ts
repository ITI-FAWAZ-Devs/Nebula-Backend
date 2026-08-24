export type RelationshipType =
  | 'CONTAINS'
  | 'HAS_MODULE'
  | 'IMPORTS'
  | 'CALLS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'DEPENDS_ON'
  | 'HAS_METHOD';

export interface Relationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  properties?: Record<string, unknown>;
}
