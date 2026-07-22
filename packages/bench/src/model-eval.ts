import path from 'node:path';
import fs from 'node:fs/promises';
import { omegaReportsDir } from '@omega/core';
import { runBenchmark } from './runner.js';
import type { BenchmarkTask, BenchmarkReport } from './types.js';

export interface ModelEvalModel {
  provider: string;
  model: string;
}

export interface ModelEvalOptions {
  apiUrl: string;
  models: ModelEvalModel[];
  timeoutMs?: number;
  projectPrefix?: string;
  tokenBudget?: number;
  suiteName?: string;
  onModelProgress?: (model: ModelEvalModel, report: BenchmarkReport) => void;
}

export interface ModelEvalResult {
  provider: string;
  model: string;
  report: BenchmarkReport;
}

export interface ModelEvalSummary {
  provider: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  passRate: number;
  totalDurationMs: number;
  totalTokens: number | null;
  totalCostUsd: number | null;
  totalTurns: number | null;
  averageTurns: number | null;
  totalToolCalls: number | null;
  toolBreakdown: Record<string, number>;
}

export interface HarnessEvalOptions {
  apiUrl: string;
  harnesses: string[];
  timeoutMs?: number;
  projectPrefix?: string;
  tokenBudget?: number;
  suiteName?: string;
  onHarnessProgress?: (cli: string, report: BenchmarkReport) => void;
}

export async function runHarnessEval(tasks: BenchmarkTask[], options: HarnessEvalOptions): Promise<ModelEvalResult[]> {
  const results: ModelEvalResult[] = [];
  for (const cli of options.harnesses) {
    const safeCli = cli.replace(/[^a-z0-9]+/gi, '-');
    const report = await runBenchmark(tasks, {
      apiUrl: options.apiUrl,
      suiteName: options.suiteName ?? 'harness-eval',
      timeoutMs: options.timeoutMs,
      projectPrefix: `${options.projectPrefix ?? 'eval'}-external-${safeCli}`,
      externalCli: cli,
      tokenBudget: options.tokenBudget,
    });
    results.push({ provider: 'external', model: cli, report });
    options.onHarnessProgress?.(cli, report);
  }
  return results;
}

export async function runModelEval(tasks: BenchmarkTask[], options: ModelEvalOptions): Promise<ModelEvalResult[]> {
  const results: ModelEvalResult[] = [];
  for (const m of options.models) {
    const safeModel = m.model.replace(/[^a-z0-9]+/gi, '-');
    const report = await runBenchmark(tasks, {
      apiUrl: options.apiUrl,
      suiteName: options.suiteName ?? 'model-eval',
      timeoutMs: options.timeoutMs,
      projectPrefix: `${options.projectPrefix ?? 'eval'}-${m.provider}-${safeModel}`,
      provider: m.provider,
      model: m.model,
      tokenBudget: options.tokenBudget,
    });
    results.push({ provider: m.provider, model: m.model, report });
    options.onModelProgress?.(m, report);
  }
  return results;
}

export function summarizeModelEval(results: ModelEvalResult[]): ModelEvalSummary[] {
  return results.map((r) => {
    let totalTokens = 0;
    let anyTokens = false;
    let totalCost = 0;
    let anyCost = false;
    let totalTurns = 0;
    let anyTurns = false;
    let totalToolCalls = 0;
    let anyToolCalls = false;
    const toolBreakdown: Record<string, number> = {};

    for (const res of r.report.results) {
      const tokens = res.agentRun?.totalTokens;
      if (typeof tokens === 'number' && tokens > 0) {
        totalTokens += tokens;
        anyTokens = true;
      }
      const cost = res.agentRun?.costUsd;
      if (typeof cost === 'number' && cost > 0) {
        totalCost += cost;
        anyCost = true;
      }
      const turns = res.agentRun?.turnCount;
      if (typeof turns === 'number' && turns > 0) {
        totalTurns += turns;
        anyTurns = true;
      }
      const toolCallsJson = res.agentRun?.toolCalls;
      if (typeof toolCallsJson === 'string' && toolCallsJson.length > 0) {
        try {
          const counts = JSON.parse(toolCallsJson) as Record<string, number>;
          for (const [name, count] of Object.entries(counts)) {
            if (typeof count === 'number' && count > 0) {
              totalToolCalls += count;
              toolBreakdown[name] = (toolBreakdown[name] ?? 0) + count;
              anyToolCalls = true;
            }
          }
        } catch {
          // Skip malformed toolCalls JSON.
        }
      }
    }

    const total = r.report.total;

    return {
      provider: r.provider,
      model: r.model,
      total,
      passed: r.report.passed,
      failed: r.report.failed,
      timeouts: r.report.timeouts,
      passRate: total > 0 ? r.report.passed / total : 0,
      totalDurationMs: r.report.totalDurationMs,
      totalTokens: anyTokens ? totalTokens : null,
      totalCostUsd: anyCost ? Number(totalCost.toFixed(4)) : null,
      totalTurns: anyTurns ? totalTurns : null,
      averageTurns: anyTurns && total > 0 ? Number((totalTurns / total).toFixed(1)) : null,
      totalToolCalls: anyToolCalls ? totalToolCalls : null,
      toolBreakdown,
    };
  });
}

export async function writeModelEvalReport(
  results: ModelEvalResult[],
  suiteName: string,
  outputDir = omegaReportsDir()
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outputDir, `model-eval-${ts}.json`);
  const summaries = summarizeModelEval(results);
  const payload = {
    timestamp: new Date().toISOString(),
    suite: suiteName,
    models: results.map((r) => ({ provider: r.provider, model: r.model })),
    summaries,
    results: results.map((r) => ({ provider: r.provider, model: r.model, report: r.report })),
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');

  const md = path.join(outputDir, `model-eval-${ts}.md`);
  const lines: string[] = [
    `# Model eval — ${suiteName}`,
    '',
    `Timestamp: ${payload.timestamp}`,
    '',
    '| Model | Passed | Failed | Timeouts | Pass rate | Duration (s) | Tokens | Cost (USD) | Turns (avg) | Tools |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summaries.map(
      (s) =>
        `| ${s.provider}/${s.model} | ${String(s.passed)}/${String(s.total)} | ${String(s.failed)} | ${String(s.timeouts)} | ${(s.passRate * 100).toFixed(0)}% | ${(s.totalDurationMs / 1000).toFixed(1)} | ${s.totalTokens !== null ? s.totalTokens.toLocaleString() : '—'} | ${s.totalCostUsd !== null ? `$${s.totalCostUsd.toFixed(2)}` : '—'} | ${s.averageTurns !== null ? String(s.averageTurns) : '—'} | ${s.totalToolCalls !== null ? String(s.totalToolCalls) : '—'} |`
    ),
    '',
    '### Tool breakdown',
    '',
    ...summaries.flatMap((s) => {
      const entries = Object.entries(s.toolBreakdown);
      if (entries.length === 0) return [];
      return [
        `**${s.provider}/${s.model}**`,
        '',
        ...entries.sort((a, b) => b[1] - a[1]).map(([name, count]) => `  - ${name}: ${String(count)}`),
        '',
      ];
    }),
  ];
  await fs.writeFile(md, lines.join('\n'), 'utf-8');
  return file;
}

export function parseModelList(input: string, defaultProvider = 'kimi'): ModelEvalModel[] {
  return input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes('/')) {
        const [provider, ...rest] = part.split('/');
        return { provider, model: rest.join('/') };
      }
      return { provider: defaultProvider, model: part };
    });
}
