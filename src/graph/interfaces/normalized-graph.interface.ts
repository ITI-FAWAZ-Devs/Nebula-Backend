import { Entity } from './entity.interface';
import { Relationship } from './relationship.interface';

export interface NormalizedGraph {
  entities: Entity[];
  relationships: Relationship[];
}
