/**
 * Adversarial test generation: use a stronger model to generate tests
 * that break weaker models. The pipeline:
 *
 * 1. Take a task from the benchmark suite
 * 2. Ask a stronger model: "what wrong fix would pass visible tests but fail hidden spec?"
 * 3. Generate adversarial test cases based on the response
 * 4. Add to the benchmark suite
 * 5. Re-run evals to see if models fail
 *
 * This creates a self-improvement loop: generate harder tasks → find
 * weaknesses → improve prompts/harness → repeat.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { omegaWorkDir } from '@omega/core';
import type { BenchmarkTask, BenchmarkEvaluation, EvaluationContext } from './types.js';

/** Load .env file if not already loaded. */
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), '.env');
  try {
    const content = fsSync.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* no .env file */ }
}

export interface AdversarialGenOptions {
  /** The API URL for the harness server. */
  apiUrl: string;
  /** The model to use for generating adversarial tests. */
  provider: string;
  model: string;
  /** Base task to generate adversarial variants from. */
  baseTask: BenchmarkTask;
  /** Number of adversarial variants to generate. */
  count?: number;
}

export interface AdversarialTask extends BenchmarkTask {
  /** The original task this was derived from. */
  baseTaskId: string;
  /** Description of the adversarial modification. */
  adversarialDescription: string;
  /** The wrong fix that would pass visible tests. */
  wrongFixHint: string;
}

/**
 * Generate adversarial test cases for a task.
 * Uses the harness API to ask a model what wrong fix would pass visible tests.
 */
export async function generateAdversarialTests(
  options: AdversarialGenOptions,
): Promise<AdversarialTask[]> {
  const { apiUrl, provider, model, baseTask, count = 3 } = options;

  // Build the adversarial generation prompt.
  const prompt = buildAdversarialPrompt(baseTask);

  // Create a task to ask the model.
  const response = await askModel(apiUrl, provider, model, prompt);

  // Parse the response into adversarial test cases.
  const tasks = parseAdversarialResponse(response, baseTask, count);

  return tasks;
}

function buildAdversarialPrompt(task: BenchmarkTask): string {
  return `You are a benchmark designer creating adversarial test cases.

Given this coding task:
Title: ${task.title}
Description: ${task.description ?? 'No description'}

Your job is to identify ways an agent might produce a WRONG fix that still passes
the visible tests. For each wrong fix:

1. Describe the wrong fix (e.g., "hardcode the output instead of implementing the algorithm")
2. Explain why it passes visible tests
3. Explain why it's wrong (violates the spec, breaks edge cases, etc.)
4. Write a test case that would catch this wrong fix

Generate ${3} different adversarial scenarios. For each, provide:
- WRONG FIX: <description>
- PASSES BECAUSE: <why visible tests pass>
- ACTUALLY WRONG: <why it's incorrect>
- ADVERSARIAL TEST: <code that catches the wrong fix>

Be specific and realistic. These tests should catch naive implementations.`;
}

async function askModel(
  apiUrl: string,
  provider: string,
  model: string,
  prompt: string,
): Promise<string> {
  // Load .env if not already loaded.
  loadEnvFile();

  // Read API key and base URL from environment variables.
  const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const envBaseUrl = `${provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
  const apiKey = process.env[envKey];
  const baseUrl = process.env[envBaseUrl] ?? `https://api.${provider}.com/v1`;

  if (!apiKey) {
    throw new Error(`No API key found. Set ${envKey} in environment or .env`);
  }

  // Call the provider's chat completions endpoint directly.
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
  // Some models (e.g. DeepSeek) put the answer in reasoning_content with empty content.
  const msg = data.choices?.[0]?.message;
  return msg?.content || msg?.reasoning_content || '';
}

function parseAdversarialResponse(
  response: string,
  baseTask: BenchmarkTask,
  count: number,
): AdversarialTask[] {
  const tasks: AdversarialTask[] = [];

  // Simple parsing: look for WRONG FIX blocks.
  const blocks = response.split(/(?=WRONG FIX:)/i).filter(Boolean);

  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    const block = blocks[i];

    const wrongFix = extractField(block, 'WRONG FIX');
    const passesBecause = extractField(block, 'PASSES BECAUSE');
    const actuallyWrong = extractField(block, 'ACTUALLY WRONG');
    const adversarialTest = extractField(block, 'ADVERSARIAL TEST');

    if (!wrongFix || !adversarialTest) continue;

    tasks.push({
      id: `${baseTask.id}-adversarial-${i}`,
      name: `${baseTask.name}-adversarial-${i}`,
      title: `${baseTask.title} (adversarial ${i + 1})`,
      description: [
        baseTask.description,
        '',
        '---',
        '',
        'ADVERSARIAL CHALLENGE:',
        `A naive agent might try: ${wrongFix}`,
        `This passes visible tests because: ${passesBecause}`,
        `But it's actually wrong because: ${actuallyWrong}`,
        '',
        'Your task: produce a CORRECT fix that passes ALL tests, including hidden ones.',
      ].join('\n'),
      complexity: baseTask.complexity,
      tags: [...(baseTask.tags ?? []), 'adversarial', `base:${baseTask.id}`],
      setup: baseTask.setup,
      evaluate: baseTask.evaluate,
      baseTaskId: baseTask.id,
      adversarialDescription: `Wrong fix: ${wrongFix}. Why wrong: ${actuallyWrong}`,
      wrongFixHint: wrongFix,
    });
  }

  return tasks;
}

function extractField(block: string, field: string): string | undefined {
  const regex = new RegExp(`${field}:\\s*(.+?)(?=\\n[A-Z]|$)`, 'is');
  const match = block.match(regex);
  return match?.[1]?.trim();
}

/**
 * Save adversarial tasks to a JSON file for later use.
 */
export async function saveAdversarialTasks(
  tasks: AdversarialTask[],
  outputPath: string,
): Promise<void> {
  const data = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    title: t.title,
    description: t.description,
    baseTaskId: t.baseTaskId,
    adversarialDescription: t.adversarialDescription,
    wrongFixHint: t.wrongFixHint,
    tags: t.tags,
  }));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Load adversarial tasks from a JSON file.
 */
export async function loadAdversarialTasks(
  inputPath: string,
  evaluators: Record<string, (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> | BenchmarkEvaluation>,
): Promise<AdversarialTask[]> {
  const raw = await fs.readFile(inputPath, 'utf-8');
  const data = JSON.parse(raw) as Array<{
    id: string;
    name: string;
    title: string;
    description: string;
    baseTaskId: string;
    adversarialDescription: string;
    wrongFixHint: string;
    tags?: string[];
  }>;

  return data.map((item) => ({
    ...item,
    complexity: 'medium' as const,
    tags: item.tags ?? ['adversarial'],
    evaluate: evaluators[item.baseTaskId] ?? (() => ({ passed: false, message: 'no evaluator' })),
  }));
}
