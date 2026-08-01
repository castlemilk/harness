import fs from 'node:fs/promises';
import path from 'node:path';
import { isInsideProject, execFileAsync } from './project-utils.js';
import type { ToolResult } from './tool-types.js';
import { runTypeCheck, runTypeScriptScript } from './ts-runner.js';

async function getModifiedFiles(projectPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: projectPath });
    const files = new Set<string>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const file = trimmed.slice(2).trim();
      if (file) {
        files.add(path.resolve(projectPath, file));
      }
    }
    return files;
  } catch {
    return new Set();
  }
}

function parseTscErrorFiles(output: string, projectPath: string): string[] {
  const files = new Set<string>();
  const regex = /^\s*([^\s(]+)\(\d+,\d+\):\s*error\s+TS\d+/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    const filePath = path.resolve(projectPath, match[1]);
    files.add(filePath);
  }
  return Array.from(files);
}

async function findPackageEntry(projectPath: string): Promise<string | undefined> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as {
      main?: string;
      module?: string;
      exports?: unknown;
    };
    if (pkg.main) return pkg.main;
    if (pkg.module) return pkg.module;
    if (typeof pkg.exports === 'string') return pkg.exports;
    if (typeof pkg.exports === 'object' && pkg.exports !== null) {
      const exportsRecord = pkg.exports as Record<string, unknown>;
      if ('.' in exportsRecord) {
        const defaultExport = exportsRecord['.'];
        if (typeof defaultExport === 'string') return defaultExport;
        if (typeof defaultExport === 'object' && defaultExport !== null) {
          const def = defaultExport as Record<string, unknown>;
          if (typeof def.import === 'string') return def.import;
          if (typeof def.require === 'string') return def.require;
        }
      }
    }
  } catch {
    // ignore
  }
  for (const candidate of ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'lib/index.js']) {
    try {
      await fs.access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export async function verifyApiSurface(
  projectPath: string,
  entryArg?: string,
  checks?: string[]
): Promise<ToolResult> {
  let entry = entryArg && entryArg.length > 0 ? entryArg : (await findPackageEntry(projectPath));
  if (!entry) {
    return { success: false, output: 'Could not determine package entry point.' };
  }
  let entryPath = path.resolve(projectPath, entry);
  if (!isInsideProject(projectPath, entryPath)) {
    return { success: false, output: 'Path traversal blocked' };
  }

  let isTypeScript = /\.(ts|tsx|mts|cts)$/.test(entry);

  if (isTypeScript) {
    const typeCheck = await runTypeCheck(projectPath);
    if (!typeCheck.success) {
      const modifiedFiles = await getModifiedFiles(projectPath);
      const errorFiles = parseTscErrorFiles(typeCheck.output, projectPath);
      const relevantErrors = errorFiles.filter((f) => modifiedFiles.has(f));
      if (relevantErrors.length > 0) {
        return {
          success: false,
          output: `TypeScript typecheck failed before API surface check (${String(relevantErrors.length)} error(s) in modified files):\n${typeCheck.output}`,
        };
      }
      isTypeScript = true;
    }
  }

  try {
    await fs.access(entryPath);
  } catch {
    const { runCommand } = await import('./run-utils.js');
    const buildResult = await runCommand(projectPath, 'corepack pnpm@10.18.0 build');
    if (!buildResult.success) {
      const fallback = 'src/index.ts';
      try {
        await fs.access(path.resolve(projectPath, fallback));
        entry = fallback;
        entryPath = path.resolve(projectPath, entry);
        isTypeScript = true;
      } catch {
        return {
          success: false,
          output: `Build failed before API surface check:\n${buildResult.output}`,
        };
      }
    } else {
      entry = entryArg && entryArg.length > 0 ? entryArg : ((await findPackageEntry(projectPath)) ?? entry);
      entryPath = path.resolve(projectPath, entry);
      isTypeScript = /\.(ts|tsx|mts|cts)$/.test(entry);
    }
  }

  let isEsm = false;
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { type?: string };
    isEsm = pkg.type === 'module' || entryPath.endsWith('.mjs');
  } catch {
    isEsm = entryPath.endsWith('.mjs');
  }

  const checkList = checks && checks.length > 0 ? checks : [`typeof api === 'object'`];
  const results: string[] = [];
  let allPassed = true;

  for (const check of checkList) {
    let checkOutput: { success: boolean; output: string };
    if (isTypeScript) {
      const script = `
        import * as api from '${entryPath}';
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      checkOutput = await runTypeScriptScript(projectPath, script);
    } else if (isEsm) {
      const script = `
        const api = await import('file://${entryPath}');
        Object.assign(globalThis, api);
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      try {
        const { stdout } = await execFileAsync('node', ['--input-type=module', '-e', script], { cwd: projectPath, timeout: 30000 });
        checkOutput = { success: true, output: stdout };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        checkOutput = {
          success: false,
          output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
        };
      }
    } else {
      const script = `
        const api = require('${entryPath}');
        Object.assign(globalThis, api);
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      try {
        const { stdout } = await execFileAsync('node', ['-e', script], { cwd: projectPath, timeout: 30000 });
        checkOutput = { success: true, output: stdout };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        checkOutput = {
          success: false,
          output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
        };
      }
    }

    if (!checkOutput.success) {
      allPassed = false;
      results.push(`✗ ${check} → ${checkOutput.output}`);
      continue;
    }

    const stdout = checkOutput.output;
    const execResult = /\{.*\}$/.exec(stdout.trim());
    const parsed = execResult
      ? (JSON.parse(execResult[0]) as { check: string; result: unknown })
      : { check, result: stdout.trim() };
    const passed = Boolean(parsed.result);
    if (!passed) allPassed = false;
    results.push(`${passed ? '✓' : '✗'} ${parsed.check} → ${JSON.stringify(parsed.result)}`);
  }

  return {
    success: allPassed,
    output: `Entry: ${entry}\n${results.join('\n')}`,
  };
}
