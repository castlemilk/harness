import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkTask, EvaluationContext, BenchmarkEvaluation } from '../types.js';
import {
  task,
  nodeProject,
  codeFile,
  jsonFile,
  expectFileContains,
  combined,
} from './builder.js';

const execFileAsync = promisify(execFile);

function applyLatestPatch(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const patch = ctx.diffs
      .slice()
      .reverse()
      .find((d) => typeof d.patch === 'string' && d.patch.length > 0)?.patch;
    if (!patch) {
      return { passed: false, message: 'No diff patch available to evaluate' };
    }
    const tmp = path.join(ctx.projectPath, '.bench-apply.patch');
    await fs.writeFile(tmp, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf-8');
    try {
      await execFileAsync('git', ['apply', '--whitespace=nowarn', tmp], { cwd: ctx.projectPath, timeout: 10_000 });
      return { passed: true, message: 'Applied model patch' };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return { passed: false, message: `Failed to apply patch: ${e.stderr ?? e.message ?? 'unknown'}` };
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  };
}

async function runScript(ctx: EvaluationContext, script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [script], { cwd: ctx.projectPath, timeout: 10_000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode: e.code ?? 1 };
  }
}

function expectScriptOutput(script: string, text: string): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const { stdout, stderr, exitCode } = await runScript(ctx, script);
    const out = `${stdout}\n${stderr}`;
    if (exitCode !== 0) {
      return { passed: false, message: `${script} exited ${String(exitCode)}: ${out.trim() || '(no output)'}` };
    }
    const found = out.includes(text);
    return {
      passed: found,
      message: found ? `${script} passed` : `${script} output missing "${text}"`,
    };
  };
}

/**
 * Fast, lightweight benchmark suite: ten tiny plain-Node tasks with no
 * external dependencies. Each project validates in seconds, making the suite
 * suitable for smoke-testing the harness and agent loop end to end.
 */
export function fastSuite(): BenchmarkTask[] {
  return [
    task({
      id: 'fast-string-utility',
      name: 'Implement a string utility',
      title: 'Add capitalize util',
      description:
        'Create `src/strings.js` exporting `capitalize(str)` which upper-cases the first character and lower-cases the rest. The test expects `capitalize("hELLO") === "Hello"`.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { capitalize } from './src/strings.js';\nimport assert from 'node:assert';\nassert.strictEqual(capitalize('hELLO'), 'Hello');\nassert.strictEqual(capitalize('omega'), 'Omega');\nconsole.log('capitalize tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'capitalize tests passed')),
    }),
    task({
      id: 'fast-csv-parser',
      name: 'Implement a small parser',
      title: 'Add parseCsvLine util',
      description:
        'Create `src/csv.js` exporting `parseCsvLine(line)` that splits a comma-separated line into trimmed fields. The test expects `parseCsvLine("a, b ,c")` to deep-equal `["a", "b", "c"]`.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { parseCsvLine } from './src/csv.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(parseCsvLine('a, b ,c'), ['a', 'b', 'c']);\nassert.deepStrictEqual(parseCsvLine('x'), ['x']);\nconsole.log('csv parser tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'csv parser tests passed')),
    }),
    task({
      id: 'fast-cache',
      name: 'Implement a cache',
      title: 'Add memoize util',
      description:
        'Create `src/cache.js` exporting `memoize(fn)` that caches results by first argument. The test counts invocations to confirm the wrapped function only runs once per argument.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { memoize } from './src/cache.js';\nimport assert from 'node:assert';\nlet calls = 0;\nconst double = memoize((n) => { calls++; return n * 2; });\nassert.strictEqual(double(2), 4);\nassert.strictEqual(double(2), 4);\nassert.strictEqual(calls, 1);\nassert.strictEqual(double(3), 6);\nassert.strictEqual(calls, 2);\nconsole.log('memoize tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'memoize tests passed')),
    }),
    task({
      id: 'fast-validation',
      name: 'Implement input validation',
      title: 'Add isValidEmail util',
      description:
        'Create `src/validate.js` exporting `isValidEmail(value)` returning a boolean. The test expects `isValidEmail("a@b.co")` to be true and `isValidEmail("nope")` to be false.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { isValidEmail } from './src/validate.js';\nimport assert from 'node:assert';\nassert.strictEqual(isValidEmail('a@b.co'), true);\nassert.strictEqual(isValidEmail('user@example.com'), true);\nassert.strictEqual(isValidEmail('nope'), false);\nassert.strictEqual(isValidEmail('a@b'), false);\nconsole.log('validation tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'validation tests passed')),
    }),
    task({
      id: 'fast-sorting',
      name: 'Implement a sorting helper',
      title: 'Add sortBy util',
      description:
        'Create `src/sort.js` exporting `sortBy(items, key)` returning a new array sorted ascending by the given key. The test sorts objects by `age` and expects the youngest first.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { sortBy } from './src/sort.js';\nimport assert from 'node:assert';\nconst input = [{ name: 'b', age: 30 }, { name: 'a', age: 20 }];\nconst sorted = sortBy(input, 'age');\nassert.strictEqual(sorted[0].name, 'a');\nassert.strictEqual(input[0].name, 'b');\nconsole.log('sortBy tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'sortBy tests passed')),
    }),
    task({
      id: 'fast-config-transform',
      name: 'Transform a config file',
      title: 'Convert config.json to env format',
      description:
        'Create `src/config.js` exporting `toEnvLines(config)` that converts an object into `KEY=value` lines with keys upper-cased. The test expects `{ port: 3000 }` to produce `["PORT=3000"]`.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await jsonFile(projectPath, 'config.json', { port: 3000, host: 'localhost' });
        await codeFile(
          projectPath,
          'test.js',
          `import { toEnvLines } from './src/config.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(toEnvLines({ port: 3000 }), ['PORT=3000']);\nassert.deepStrictEqual(toEnvLines({ host: 'localhost' }), ['HOST=localhost']);\nconsole.log('config transform tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'config transform tests passed')),
    }),
    task({
      id: 'fast-error-handling',
      name: 'Add safe error handling',
      title: 'Add safeJsonParse util',
      description:
        'Create `src/safe.js` exporting `safeJsonParse(text, fallback)` that returns the parsed JSON, or `fallback` when parsing throws. The test expects `safeJsonParse("not json", [])` to return `[]`.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { safeJsonParse } from './src/safe.js';\nimport assert from 'node:assert';\nassert.deepStrictEqual(safeJsonParse('{"a":1}', null), { a: 1 });\nassert.deepStrictEqual(safeJsonParse('not json', []), []);\nassert.strictEqual(safeJsonParse('', 'fallback'), 'fallback');\nconsole.log('safeJsonParse tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'safeJsonParse tests passed')),
    }),
    task({
      id: 'fast-file-io',
      name: 'Implement a file I/O helper',
      title: 'Add readJsonFile util',
      description:
        'Create `src/files.js` exporting an async `readJsonFile(path)` that reads and parses a JSON file. The test reads the existing `data.json` and expects `{ "value": 42 }`.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await jsonFile(projectPath, 'data.json', { value: 42 });
        await codeFile(
          projectPath,
          'test.js',
          `import { readJsonFile } from './src/files.js';\nimport assert from 'node:assert';\nconst data = await readJsonFile('./data.json');\nassert.deepStrictEqual(data, { value: 42 });\nconsole.log('readJsonFile tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'readJsonFile tests passed')),
    }),
    task({
      id: 'fast-async-retry',
      name: 'Implement async retry logic',
      title: 'Add retry util',
      description:
        'Create `src/retry.js` exporting an async `retry(fn, attempts)` that calls `fn` until it succeeds or `attempts` is exhausted, then rethrows the last error. The test uses a function that fails twice before succeeding.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'test.js',
          `import { retry } from './src/retry.js';\nimport assert from 'node:assert';\nlet tries = 0;\nconst flaky = async () => { tries++; if (tries < 3) throw new Error('fail'); return 'ok'; };\nassert.strictEqual(await retry(flaky, 3), 'ok');\nassert.strictEqual(tries, 3);\nawait assert.rejects(() => retry(async () => { throw new Error('always'); }, 2), /always/);\nconsole.log('retry tests passed');\n`
        );
      },
      evaluate: combined(applyLatestPatch(), expectScriptOutput('test.js', 'retry tests passed')),
    }),
    task({
      id: 'fast-lint-fix',
      name: 'Fix a lint violation',
      title: 'Remove var keyword flagged by linter',
      description:
        'The custom linter rejects any use of `var`. Update `src/index.js` to use `const`/`let` while keeping the exported `add(a, b)` behavior. The test and lint must both pass.',
      setup: async (projectPath) => {
        await nodeProject(projectPath);
        await codeFile(
          projectPath,
          'src/index.js',
          `var base = 1;\nexport function add(a, b) { return a + b + base - 1; }\n`
        );
        await codeFile(
          projectPath,
          'test.js',
          `import { add } from './src/index.js';\nimport assert from 'node:assert';\nassert.strictEqual(add(1, 2), 3);\nconsole.log('add tests passed');\n`
        );
        await codeFile(
          projectPath,
          'lint.js',
          `import fs from 'node:fs/promises';\nconst code = await fs.readFile('./src/index.js', 'utf-8');\nif (/\\bvar\\s/.test(code)) { console.error('lint failed: var keyword found'); process.exit(1); }\nconsole.log('lint ok');\n`
        );
      },
      evaluate: combined(
        applyLatestPatch(),
        expectScriptOutput('test.js', 'add tests passed'),
        expectScriptOutput('lint.js', 'lint ok'),
        expectFileContains('src/index.js', 'const')
      ),
    }),
  ];
}
