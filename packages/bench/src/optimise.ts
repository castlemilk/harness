import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkReport, BenchmarkResult } from './types.js';
import { getTraceFlow } from './api-client.js';

export interface OptimiseOptions {
  apiUrl: string;
  projectId: string;
  outputDir?: string;
  taskId?: string;
}

async function findLatestReport(outputDir: string): Promise<BenchmarkReport | undefined> {
  const entries = await fs.readdir(outputDir).catch(() => []);
  const files = entries
    .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return undefined;
  const raw = await fs.readFile(path.join(outputDir, files[0]), 'utf-8');
  return JSON.parse(raw) as BenchmarkReport;
}

function summariseTraceFlow(report: string, maxLines = 60): string {
  const lines = report.split('\n');
  if (lines.length <= maxLines) return report;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

export function buildOptimisePrompt(
  report: BenchmarkReport,
  failedResult?: BenchmarkResult,
  traceFlowText?: string
): string {
  const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
  const failed = report.results.filter((r) => !r.evaluation.passed);

  const lines: string[] = [];
  lines.push('# Prompt optimisation task');
  lines.push('');
  lines.push(`The latest benchmark run achieved ${String(passRate)}% pass rate (${String(report.passed)}/${String(report.total)}).`);
  lines.push('');
  lines.push('## Failed tasks');
  for (const r of failed.slice(0, 5)) {
    lines.push(`- ${r.task.name}: ${r.evaluation.message ?? 'no message'}`);
  }
  lines.push('');

  if (failedResult) {
    lines.push(`## Focus task: ${failedResult.task.name}`);
    lines.push(`Status: ${failedResult.status}`);
    lines.push(`Evaluation: ${failedResult.evaluation.message ?? 'none'}`);
    lines.push('');
  }

  if (traceFlowText) {
    lines.push('## Trace flow snapshot');
    lines.push('```json');
    lines.push(summariseTraceFlow(traceFlowText));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('Analyse the failures above and edit `packages/agent/src/prompts.ts` (and optionally `packages/agent/src/planner.ts`) to improve the Omega agent.');
  lines.push('Rules:');
  lines.push('- Keep changes minimal and targeted.');
  lines.push('- Do not break existing tool signatures or system behaviour.');
  lines.push('- Run `pnpm lint` and `pnpm test` after edits.');
  lines.push('- Finish with a summary of what changed and why it should help.');

  return lines.join('\n');
}

export async function loadOptimisationContext(
  apiUrl: string,
  outputDir: string
): Promise<{ report: BenchmarkReport; failedResult?: BenchmarkResult; traceFlowText?: string } | undefined> {
  const report = await findLatestReport(outputDir);
  if (!report) return undefined;

  const failedResult = report.results.find((r) => !r.evaluation.passed);
  let traceFlowText: string | undefined;
  if (failedResult?.harnessTaskId) {
    const traceFlow = await getTraceFlow(apiUrl, failedResult.harnessTaskId);
    if (traceFlow) {
      traceFlowText = JSON.stringify(traceFlow, null, 2);
    }
  }
  return { report, failedResult, traceFlowText };
}

export async function submitOptimiseTask(
  apiUrl: string,
  projectId: string,
  prompt: string
): Promise<{ id: string }> {
  const title = 'Optimise agent prompts from benchmark trace analysis';
  const res = await fetch(`${apiUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      title,
      description: prompt,
      complexity: 'complex',
      tags: ['self-improve', 'benchmark'],
    }),
  });
  if (!res.ok) throw new Error(`submit optimise task failed: ${String(res.status)}`);
  return res.json() as Promise<{ id: string }>;
}
