import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preProcessFile } from 'typescript';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAINTAINED_SOURCE_DIRECTORIES = ['src', 'tools', 'scripts'] as const;
const DOCUMENTED_ROOTS = [
  'src/main.ts',
  'src/particle_testbed.ts',
  'src/vehicles_test.ts',
  'vite.config.ts',
  'tools/config/index.ts',
  'tools/logging/demo.ts',
] as const;

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function resolveRelativeImport(
  importer: string,
  specifier: string,
  maintainedFiles: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;

  const importedPath = resolve(dirname(importer), specifier);
  const extension = extname(importedPath);
  const candidates = extension === '.js'
    ? [`${importedPath.slice(0, -extension.length)}.ts`]
    : extension === '.ts'
      ? [importedPath]
      : [`${importedPath}.ts`, join(importedPath, 'index.ts')];

  return candidates.find((candidate) => maintainedFiles.has(candidate));
}

function repositoryPath(file: string): string {
  return relative(REPOSITORY_ROOT, file).replace(/\\/g, '/');
}

function findMissingRoots(maintainedFiles: ReadonlySet<string>, roots: readonly string[]): string[] {
  return roots.filter((root) => !maintainedFiles.has(root));
}

describe('maintained TypeScript source graph', () => {
  it('reports protected roots that are missing from the maintained graph', () => {
    const present = join(REPOSITORY_ROOT, 'src/main.ts');
    const missing = join(REPOSITORY_ROOT, 'src/missing-entry.ts');

    expect(findMissingRoots(new Set([present]), [present, missing]).map(repositoryPath)).toEqual([
      'src/missing-entry.ts',
    ]);
  });

  it('has no modules unreachable from a documented entry point', () => {
    const maintainedFiles = new Set([
      ...MAINTAINED_SOURCE_DIRECTORIES.flatMap((directory) =>
        collectTypeScriptFiles(join(REPOSITORY_ROOT, directory)),
      ),
      join(REPOSITORY_ROOT, 'vite.config.ts'),
    ]);
    const documentedRoots = DOCUMENTED_ROOTS.map((file) => join(REPOSITORY_ROOT, file));
    const missingRoots = findMissingRoots(maintainedFiles, documentedRoots).map(repositoryPath);
    expect(missingRoots).toEqual([]);

    const roots = [
      ...documentedRoots,
      ...[...maintainedFiles].filter((file) =>
        repositoryPath(file).startsWith('scripts/') || file.endsWith('.test.ts'),
      ),
    ];
    const dependencies = new Map(
      [...maintainedFiles].map((file) => {
        const imports = preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
        const resolvedImports = imports
          .map(({ fileName }) => resolveRelativeImport(file, fileName, maintainedFiles))
          .filter((dependency): dependency is string => dependency !== undefined);
        return [file, resolvedImports] as const;
      }),
    );

    const reachable = new Set<string>();
    const pending = [...roots];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || reachable.has(file)) continue;
      reachable.add(file);
      pending.push(...(dependencies.get(file) ?? []));
    }

    const unreachable = [...maintainedFiles]
      .filter((file) => !reachable.has(file))
      .map(repositoryPath)
      .sort();

    expect(unreachable).toEqual([]);
  });
});
