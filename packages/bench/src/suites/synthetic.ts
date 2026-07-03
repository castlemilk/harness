import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkTask, EvaluationContext } from '../types.js';

async function writeJson(projectPath: string, file: string, data: unknown): Promise<void> {
  await fs.writeFile(path.join(projectPath, file), JSON.stringify(data, null, 2), 'utf-8');
}

async function writeFile(projectPath: string, file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(projectPath, file)), { recursive: true });
  await fs.writeFile(path.join(projectPath, file), content, 'utf-8');
}

function parseValidation(ctx: EvaluationContext): { allPassed: boolean; summary?: Record<string, unknown> } {
  if (!ctx.agentRun?.validationSummary) return { allPassed: false };
  try {
    const summary = JSON.parse(ctx.agentRun.validationSummary) as Record<string, unknown>;
    return { allPassed: Boolean(summary.allPassed), summary };
  } catch {
    return { allPassed: false };
  }
}

function validate(ctx: EvaluationContext) {
  const v = parseValidation(ctx);
  return {
    passed: v.allPassed,
    message: v.allPassed ? 'Validation passed' : 'Validation failed',
  };
}

function basePackage(): Record<string, unknown> {
  return {
    name: 'synthetic-bench-project',
    version: '1.0.0',
    type: 'module',
    scripts: {
      lint: 'node lint.js',
      test: 'node test.js',
      build: 'node build.js',
    },
  };
}

const TASKS: BenchmarkTask[] = [
  {
    id: 'greet-function',
    name: 'Add a greet function',
    title: 'Add greet.js with a greet function',
    description:
      'Create a `greet.js` file that exports a function `greet(name)` returning `Hello, <name>!`. The existing test expects this function.',
    complexity: 'simple',
    setup: async (projectPath) => {
      await writeJson(projectPath, 'package.json', basePackage());
      await writeFile(projectPath, 'test.js', `import { greet } from './greet.js';\nimport assert from 'node:assert';\nassert.strictEqual(greet('World'), 'Hello, World!');\nconsole.log('greet test passed');\n`);
      await writeFile(projectPath, 'lint.js', `console.log('lint ok');\n`);
      await writeFile(projectPath, 'build.js', `console.log('build ok');\n`);
    },
    evaluate: (ctx) => Promise.resolve(validate(ctx)),
  },
  {
    id: 'fix-lint-warning',
    name: 'Fix a lint warning',
    title: 'Remove unused variable flagged by linter',
    description:
      'The custom linter flags any use of `var`. Update `src/index.js` so the lint script passes while keeping the greeting behavior.',
    complexity: 'simple',
    setup: async (projectPath) => {
      await writeJson(projectPath, 'package.json', basePackage());
      await writeFile(projectPath, 'src/index.js', `var greeting = 'Hello';\nexport function hi(name) { return greeting + ', ' + name + '!'; }\n`);
      await writeFile(projectPath, 'test.js', `import { hi } from './src/index.js';\nimport assert from 'node:assert';\nassert.strictEqual(hi('Omega'), 'Hello, Omega!');\nconsole.log('hi test passed');\n`);
      await writeFile(projectPath, 'lint.js', `import fs from 'node:fs/promises';\nconst code = await fs.readFile('./src/index.js', 'utf-8');\nif (code.includes('var ')) { console.error('lint failed: var keyword found'); process.exit(1); }\nconsole.log('lint ok');\n`);
      await writeFile(projectPath, 'build.js', `console.log('build ok');\n`);
    },
    evaluate: (ctx) => Promise.resolve(validate(ctx)),
  },
  {
    id: 'update-config',
    name: 'Update a config value',
    title: 'Update timeout value in config.json',
    description:
      'Change `config.json` so that `timeout` is `5000` instead of `1000`. The test will read the file and assert the value.',
    complexity: 'simple',
    setup: async (projectPath) => {
      await writeJson(projectPath, 'package.json', basePackage());
      await writeJson(projectPath, 'config.json', { timeout: 1000, retries: 3 });
      await writeFile(projectPath, 'test.js', `import { readFile } from 'node:fs/promises';\nconst cfg = JSON.parse(await readFile('./config.json', 'utf-8'));\nif (cfg.timeout !== 5000) { console.error('timeout is ' + cfg.timeout); process.exit(1); }\nconsole.log('config test passed');\n`);
      await writeFile(projectPath, 'lint.js', `console.log('lint ok');\n`);
      await writeFile(projectPath, 'build.js', `console.log('build ok');\n`);
    },
    evaluate: (ctx) => Promise.resolve(validate(ctx)),
  },
  {
    id: 'extract-constant',
    name: 'Extract a magic constant',
    title: 'Extract MAX_RETRIES constant',
    description:
      'Refactor `src/retry.js` so the magic number `3` is replaced by a top-level constant named `MAX_RETRIES`. The test checks for the constant.',
    complexity: 'medium',
    setup: async (projectPath) => {
      await writeJson(projectPath, 'package.json', basePackage());
      await writeFile(projectPath, 'src/retry.js', `export function attempts() { return 3; }\n`);
      await writeFile(projectPath, 'test.js', `import fs from 'node:fs/promises';\nimport { attempts } from './src/retry.js';\nconst code = await fs.readFile('./src/retry.js', 'utf-8');\nif (!code.includes('const MAX_RETRIES')) { console.error('MAX_RETRIES constant not found'); process.exit(1); }\nif (attempts() !== 3) { console.error('attempts() changed'); process.exit(1); }\nconsole.log('constant test passed');\n`);
      await writeFile(projectPath, 'lint.js', `console.log('lint ok');\n`);
      await writeFile(projectPath, 'build.js', `console.log('build ok');\n`);
    },
    evaluate: (ctx) => Promise.resolve(validate(ctx)),
  },
  {
    id: 'noop-validation',
    name: 'Run validation on a clean project',
    title: 'Confirm the project already passes validation',
    description:
      'This project already passes lint, test and build. Use the publish tool to confirm validation passes and finish.',
    complexity: 'simple',
    setup: async (projectPath) => {
      await writeJson(projectPath, 'package.json', basePackage());
      await writeFile(projectPath, 'test.js', `console.log('test ok');\n`);
      await writeFile(projectPath, 'lint.js', `console.log('lint ok');\n`);
      await writeFile(projectPath, 'build.js', `console.log('build ok');\n`);
    },
    evaluate: (ctx) => Promise.resolve(validate(ctx)),
  },
];

export function syntheticSuite(): BenchmarkTask[] {
  return TASKS;
}
