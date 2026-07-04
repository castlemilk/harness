import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkTask, EvaluationContext, BenchmarkEvaluation } from '../types.js';

export interface TaskSpec {
  id: string;
  name: string;
  title: string;
  description?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  setup?: (projectPath: string) => Promise<void>;
  evaluate?: (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> | BenchmarkEvaluation;
}

export function task(spec: TaskSpec): BenchmarkTask {
  return {
    id: spec.id,
    name: spec.name,
    title: spec.title,
    description: spec.description,
    complexity: spec.complexity ?? 'simple',
    setup: spec.setup,
    evaluate: spec.evaluate ?? expectValidationPassed(),
  };
}

export function basePackage(extraScripts: Record<string, string> = {}): Record<string, unknown> {
  return {
    name: 'synthetic-bench-project',
    version: '1.0.0',
    type: 'module',
    scripts: {
      lint: 'node lint.js',
      test: 'node test.js',
      build: 'node build.js',
      ...extraScripts,
    },
  };
}

export async function jsonFile(projectPath: string, file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(path.join(projectPath, file)), { recursive: true });
  await fs.writeFile(path.join(projectPath, file), JSON.stringify(data, null, 2), 'utf-8');
}

export async function codeFile(projectPath: string, file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(projectPath, file)), { recursive: true });
  await fs.writeFile(path.join(projectPath, file), content, 'utf-8');
}

export async function nodeProject(projectPath: string, extraScripts: Record<string, string> = {}): Promise<void> {
  await jsonFile(projectPath, 'package.json', basePackage(extraScripts));
  await codeFile(projectPath, 'lint.js', `console.log('lint ok');\n`);
  await codeFile(projectPath, 'test.js', `console.log('test ok');\n`);
  await codeFile(projectPath, 'build.js', `console.log('build ok');\n`);
}

export function readValidation(ctx: EvaluationContext): { allPassed: boolean; summary?: Record<string, unknown> } {
  if (!ctx.agentRun?.validationSummary) return { allPassed: false };
  try {
    const summary = JSON.parse(ctx.agentRun.validationSummary) as Record<string, unknown>;
    return { allPassed: Boolean(summary.allPassed), summary };
  } catch {
    return { allPassed: false };
  }
}

export function expectValidationPassed(): (ctx: EvaluationContext) => BenchmarkEvaluation {
  return (ctx) => {
    const v = readValidation(ctx);
    return {
      passed: v.allPassed,
      message: v.allPassed ? 'Validation passed' : 'Validation failed',
    };
  };
}

export async function readFile(projectPath: string, file: string): Promise<string> {
  return fs.readFile(path.join(projectPath, file), 'utf-8');
}

export function expectFileContains(file: string, needle: string | RegExp): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const content = await readFile(ctx.projectPath, file).catch(() => '');
    const found = typeof needle === 'string' ? content.includes(needle) : needle.test(content);
    return {
      passed: found,
      message: found ? `${file} contains required content` : `${file} missing required content`,
    };
  };
}

export function expectFileDoesNotContain(file: string, needle: string | RegExp): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const content = await readFile(ctx.projectPath, file).catch(() => '');
    const found = typeof needle === 'string' ? content.includes(needle) : needle.test(content);
    return {
      passed: !found,
      message: !found ? `${file} does not contain forbidden content` : `${file} contains forbidden content`,
    };
  };
}

export function expectTestOutputIncludes(text: string): (ctx: EvaluationContext) => BenchmarkEvaluation {
  return (ctx) => {
    const validation = readValidation(ctx);
    if (!validation.summary) {
      return { passed: false, message: 'No validation summary available' };
    }
    const outputs = validation.summary.outputs as Record<string, { stdout?: string; stderr?: string }> | undefined;
    if (!outputs) {
      return { passed: false, message: 'Validation outputs missing' };
    }
    const combined = Object.values(outputs)
      .map((o) => `${o.stdout ?? ''}\n${o.stderr ?? ''}`)
      .join('\n');
    const found = combined.includes(text);
    return {
      passed: found,
      message: found ? `Test output includes "${text}"` : `Test output missing "${text}"`,
    };
  };
}

export function combined(...evaluators: ((ctx: EvaluationContext) => Promise<BenchmarkEvaluation> | BenchmarkEvaluation)[]): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    for (const evaluator of evaluators) {
      const result = await evaluator(ctx);
      if (!result.passed) return result;
    }
    return { passed: true, message: 'All checks passed' };
  };
}
