import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import ts from 'typescript';
import {
  GraphifyResult,
  GraphifyNode,
  GraphifyEdge,
} from './interfaces/graphify-result.interface';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.rs',
  '.cs',
  '.php',
  '.rb',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
]);

interface PathAliasConfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

@Injectable()
export class AstExtractorService {
  private readonly logger = new Logger(AstExtractorService.name);

  /**
   * Performs an in-process AST extraction of the codebase.
   */
  async extract(projectPath: string): Promise<GraphifyResult> {
    const rootDir = path.resolve(projectPath);
    this.logger.log(`Starting in-process AST extraction for ${rootDir}`);

    const aliasConfig = await this.loadPathAliases(rootDir);
    const files = await this.scanFiles(rootDir, rootDir);

    const nodes: GraphifyNode[] = [];
    const edges: GraphifyEdge[] = [];
    const fileSet = new Set(files);

    for (const relPath of files) {
      const fullPath = path.join(rootDir, relPath);
      const ext = path.extname(relPath).toLowerCase();

      // Create file node
      const fileNodeId = `file:${relPath}`;
      nodes.push({
        id: fileNodeId,
        type: 'File',
        name: path.posix.basename(relPath),
        path: relPath,
        source_file: relPath,
      });

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
          this.extractTsJs(
            relPath,
            content,
            fileNodeId,
            rootDir,
            fileSet,
            aliasConfig,
            nodes,
            edges,
          );
        } else if (ext === '.py') {
          this.extractPython(relPath, content, fileNodeId, fileSet, nodes, edges);
        } else {
          this.extractGeneric(relPath, content, fileNodeId, fileSet, nodes, edges);
        }
      } catch (err) {
        this.logger.warn(`Could not parse file ${relPath}: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `In-process AST extraction completed: ${nodes.length} nodes, ${edges.length} edges across ${files.length} files`,
    );

    return {
      raw: { source: 'AstExtractorService', fileCount: files.length },
      nodes,
      edges,
    };
  }

  private async scanFiles(dir: string, rootDir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') {
          if (entry.isDirectory()) continue;
        }
        if (EXCLUDED_DIRS.has(entry.name)) continue;

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.scanFiles(full, rootDir);
          results.push(...sub);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (CODE_EXTENSIONS.has(ext)) {
            const rel = path.relative(rootDir, full).replace(/\\/g, '/');
            results.push(rel);
          }
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
    return results;
  }

  private async loadPathAliases(rootDir: string): Promise<PathAliasConfig> {
    const tsconfigPaths = [
      path.join(rootDir, 'tsconfig.json'),
      path.join(rootDir, 'jsconfig.json'),
    ];

    for (const tsconfigPath of tsconfigPaths) {
      try {
        const raw = await fs.readFile(tsconfigPath, 'utf-8');
        // Strip single & multi-line comments in json
        const clean = raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
        const parsed = JSON.parse(clean);
        const compilerOptions = parsed.compilerOptions || {};
        return {
          baseUrl: compilerOptions.baseUrl,
          paths: compilerOptions.paths,
        };
      } catch {
        // Fallback / continue
      }
    }
    return {};
  }

  private extractTsJs(
    relPath: string,
    content: string,
    fileNodeId: string,
    rootDir: string,
    fileSet: Set<string>,
    aliasConfig: PathAliasConfig,
    nodes: GraphifyNode[],
    edges: GraphifyEdge[],
  ): void {
    const sourceFile = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    const resolveImportPath = (importSpec: string): string | null => {
      if (importSpec.startsWith('.')) {
        const sourceDir = path.posix.dirname(relPath);
        const resolved = path.posix.normalize(path.posix.join(sourceDir, importSpec));
        return this.findMatchingFile(resolved, fileSet);
      }

      // Check tsconfig alias
      if (aliasConfig.paths) {
        for (const [pattern, targets] of Object.entries(aliasConfig.paths)) {
          const prefix = pattern.replace(/\*$/, '');
          if (importSpec.startsWith(prefix)) {
            const rest = importSpec.slice(prefix.length);
            for (const target of targets) {
              const targetPrefix = target.replace(/\*$/, '');
              const base = aliasConfig.baseUrl ? aliasConfig.baseUrl.replace(/^\.\/?/, '') : '';
              const resolved = path.posix.normalize(
                path.posix.join(base, targetPrefix + rest),
              );
              const match = this.findMatchingFile(resolved, fileSet);
              if (match) return match;
            }
          }
        }
      }
      return null;
    };

    const visit = (node: ts.Node, parentSymbolId?: string) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (ts.isStringLiteral(specifier)) {
          const importText = specifier.text;
          const targetFile = resolveImportPath(importText);
          if (targetFile) {
            edges.push({
              source: fileNodeId,
              target: `file:${targetFile}`,
              relation: 'imports',
              type: 'IMPORTS',
              source_file: relPath,
            });
          }
        }
      } else if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const classId = `class:${relPath}:${className}`;
        nodes.push({
          id: classId,
          type: 'Class',
          name: className,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: classId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });

        // Inheritance
        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const type of clause.types) {
                const parentName = type.expression.getText(sourceFile);
                edges.push({
                  source: classId,
                  target: parentName,
                  relation: 'extends',
                  type: 'EXTENDS',
                  source_file: relPath,
                });
              }
            } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const type of clause.types) {
                const ifaceName = type.expression.getText(sourceFile);
                edges.push({
                  source: classId,
                  target: ifaceName,
                  relation: 'implements',
                  type: 'IMPLEMENTS',
                  source_file: relPath,
                });
              }
            }
          }
        }

        // Methods within class
        ts.forEachChild(node, (child) => visit(child, classId));
        return;
      } else if (ts.isInterfaceDeclaration(node)) {
        const ifaceName = node.name.text;
        const ifaceId = `interface:${relPath}:${ifaceName}`;
        nodes.push({
          id: ifaceId,
          type: 'Interface',
          name: ifaceName,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: ifaceId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      } else if (ts.isEnumDeclaration(node)) {
        const enumName = node.name.text;
        const enumId = `enum:${relPath}:${enumName}`;
        nodes.push({
          id: enumId,
          type: 'Enum',
          name: enumName,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: enumId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.text;
        const typeId = `type:${relPath}:${typeName}`;
        nodes.push({
          id: typeId,
          type: 'TypeAlias',
          name: typeName,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: typeId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      } else if (ts.isMethodDeclaration(node) && node.name) {
        const methodName = node.name.getText(sourceFile);
        const parentId = parentSymbolId || fileNodeId;
        const methodId = `method:${relPath}:${parentId}:${methodName}`;
        nodes.push({
          id: methodId,
          type: 'Method',
          name: methodName,
          source_file: relPath,
        });
        edges.push({
          source: parentId,
          target: methodId,
          relation: 'has_method',
          type: 'HAS_METHOD',
          source_file: relPath,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const fnName = node.name.text;
        const fnId = `function:${relPath}:${fnName}`;
        nodes.push({
          id: fnId,
          type: 'Function',
          name: fnName,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: fnId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      }

      ts.forEachChild(node, (child) => visit(child, parentSymbolId));
    };

    ts.forEachChild(sourceFile, visit);
  }

  private extractPython(
    relPath: string,
    content: string,
    fileNodeId: string,
    fileSet: Set<string>,
    nodes: GraphifyNode[],
    edges: GraphifyEdge[],
  ): void {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Imports: import foo or from foo import bar
      const importMatch = trimmed.match(/^(?:from\s+([\w\.]+)\s+import|import\s+([\w\.]+))/);
      if (importMatch) {
        const mod = (importMatch[1] || importMatch[2]).replace(/\./g, '/');
        const match = this.findMatchingFile(mod, fileSet);
        if (match) {
          edges.push({
            source: fileNodeId,
            target: `file:${match}`,
            relation: 'imports',
            type: 'IMPORTS',
            source_file: relPath,
          });
        }
      }

      // Class: class Foo(Bar):
      const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)(?:\(([^)]+)\))?:/);
      if (classMatch) {
        const className = classMatch[1];
        const classId = `class:${relPath}:${className}`;
        nodes.push({
          id: classId,
          type: 'Class',
          name: className,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: classId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
        if (classMatch[2]) {
          const parent = classMatch[2].trim();
          edges.push({
            source: classId,
            target: parent,
            relation: 'extends',
            type: 'EXTENDS',
            source_file: relPath,
          });
        }
      }

      // Function: def foo():
      const defMatch = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
      if (defMatch) {
        const fnName = defMatch[1];
        const fnId = `function:${relPath}:${fnName}`;
        nodes.push({
          id: fnId,
          type: 'Function',
          name: fnName,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: fnId,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      }
    }
  }

  private extractGeneric(
    relPath: string,
    content: string,
    fileNodeId: string,
    fileSet: Set<string>,
    nodes: GraphifyNode[],
    edges: GraphifyEdge[],
  ): void {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Match class / struct / interface declarations
      const declMatch = trimmed.match(
        /^(?:public|private|protected|export)?\s*(class|interface|struct|enum)\s+([A-Za-z0-9_]+)/,
      );
      if (declMatch) {
        const kind = declMatch[1];
        const name = declMatch[2];
        const type =
          kind === 'class' || kind === 'struct'
            ? 'Class'
            : kind === 'interface'
              ? 'Interface'
              : 'Enum';
        const id = `${type.toLowerCase()}:${relPath}:${name}`;
        nodes.push({
          id,
          type,
          name,
          source_file: relPath,
        });
        edges.push({
          source: fileNodeId,
          target: id,
          relation: 'contains',
          type: 'CONTAINS',
          source_file: relPath,
        });
      }
    }
  }

  private findMatchingFile(basePath: string, fileSet: Set<string>): string | null {
    const clean = basePath.replace(/^\.\//, '').replace(/\\/g, '/');
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];

    if (fileSet.has(clean)) return clean;

    for (const ext of extensions) {
      if (fileSet.has(clean + ext)) return clean + ext;
      if (fileSet.has(path.posix.join(clean, 'index' + ext))) {
        return path.posix.join(clean, 'index' + ext);
      }
      if (fileSet.has(path.posix.join(clean, '__init__' + ext))) {
        return path.posix.join(clean, '__init__' + ext);
      }
    }

    return null;
  }
}
