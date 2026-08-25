import { AstExtractorService } from './ast-extractor.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AstExtractorService', () => {
  let service: AstExtractorService;
  let tempDir: string;

  beforeEach(async () => {
    service = new AstExtractorService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nebula-ast-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('extracts TypeScript classes, interfaces, enums, and imports correctly', async () => {
    const tsconfig = {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    };
    await fs.writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2),
      'utf-8',
    );

    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const userModel = `
      export enum Role {
        ADMIN = 'ADMIN',
        USER = 'USER'
      }

      export interface UserProfile {
        id: string;
        username: string;
      }

      export class User {
        id: string;
        role: Role;
        getDisplayName(): string {
          return this.id;
        }
      }
    `;
    await fs.writeFile(path.join(srcDir, 'user.ts'), userModel, 'utf-8');

    const authService = `
      import { User, Role } from '@/user';

      export class AuthService {
        authenticate(): User {
          return new User();
        }
      }
    `;
    await fs.writeFile(path.join(srcDir, 'auth.service.ts'), authService, 'utf-8');

    const result = await service.extract(tempDir);

    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();

    const nodeNames = result.nodes?.map((n) => n.name) || [];
    expect(nodeNames).toContain('User');
    expect(nodeNames).toContain('UserProfile');
    expect(nodeNames).toContain('Role');
    expect(nodeNames).toContain('AuthService');

    // Check alias import resolved
    const importEdges = result.edges?.filter((e) => e.type === 'IMPORTS') || [];
    expect(importEdges.length).toBeGreaterThanOrEqual(1);
    expect(importEdges.some((e) => e.target.includes('src/user.ts'))).toBe(true);
  });

  it('extracts Python classes and functions', async () => {
    const pyFile = `
class DataModel:
    def __init__(self):
        pass

def process_data():
    return True
    `;
    await fs.writeFile(path.join(tempDir, 'model.py'), pyFile, 'utf-8');

    const result = await service.extract(tempDir);
    const nodeNames = result.nodes?.map((n) => n.name) || [];
    expect(nodeNames).toContain('DataModel');
    expect(nodeNames).toContain('process_data');
  });
});
