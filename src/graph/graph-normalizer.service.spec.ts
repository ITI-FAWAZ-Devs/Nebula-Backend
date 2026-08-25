import { GraphNormalizerService } from './graph-normalizer.service';
import { GraphifyResult } from '../graphify/interfaces/graphify-result.interface';

describe('GraphNormalizerService', () => {
  let service: GraphNormalizerService;

  beforeEach(() => {
    service = new GraphNormalizerService();
  });

  it('normalizes entities and maps types accurately', () => {
    const raw: GraphifyResult = {
      raw: {},
      nodes: [
        { id: 'f1', type: 'file', path: 'src\\components\\App.tsx', source_file: 'src\\components\\App.tsx' },
        { id: 'c1', label: 'App', source_file: 'src/components/App.tsx' },
        { id: 'i1', label: 'IUserProfile', source_file: 'src/types.ts' },
        { id: 'e1', label: 'UserStatusEnum', source_file: 'src/types.ts' },
        { id: 't1', label: 'UserProps', source_file: 'src/types.ts' },
        { id: 's1', label: 'AuthService', source_file: 'src/auth.service.ts' },
        { id: 'fn1', label: 'useAuth', source_file: 'src/useAuth.ts' },
      ],
      edges: [
        { source: 'f1', target: 'c1', relation: 'contains' },
        { source: 'c1', target: 's1', relation: 'injects' },
        { source: 'c1', target: 'fn1', relation: 'uses_hook' },
        { source: 'f1', target: 'e1', relation: 'exports' },
      ],
    };

    const normalized = service.normalize(raw);

    expect(normalized.entities).toHaveLength(7);
    expect(normalized.relationships).toHaveLength(4);

    const byName = new Map(normalized.entities.map((e) => [e.name, e]));
    expect(byName.get('App')?.type).toBe('Component');
    expect(byName.get('IUserProfile')?.type).toBe('Interface');
    expect(byName.get('UserStatusEnum')?.type).toBe('Enum');
    expect(byName.get('UserProps')?.type).toBe('TypeAlias');
    expect(byName.get('AuthService')?.type).toBe('Service');
    expect(byName.get('useAuth')?.type).toBe('Function');

    // Check relationship types
    const relTypes = normalized.relationships.map((r) => r.type);
    expect(relTypes).toContain('CONTAINS');
    expect(relTypes).toContain('INJECTS');
    expect(relTypes).toContain('USES_HOOK');
    expect(relTypes).toContain('EXPORTS');

    // Check path normalization (forward slashes)
    const f1 = normalized.entities.find((e) => e.id === 'f1');
    expect(f1?.properties?.path).toBe('src/components/App.tsx');
  });
});
