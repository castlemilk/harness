import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { estimateCostUsd, type ProviderConfig } from '@omega/core';
import { createProvider } from '@omega/providers';
import {
  DEFAULT_SOLVER_SYSTEM,
  runLedgerLoop,
  runSampleTests,
  runSingleCall,
  type LedgerCallRecord,
  type LedgerSend,
  type LedgerUsage,
} from '@omega/agent';
import { discordantCounts, mcnemarExact, meanCi95, signFlipPermutation } from './stats.js';

export interface LedgerEvalTest {
  input: string;
  output: string;
}

export interface LedgerEvalProblem {
  id: string;
  statement: string;
  tests: LedgerEvalTest[];
  hiddenTests?: LedgerEvalTest[];
}

export interface LedgerEvalProvider {
  kind: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  contextTokens?: number;
}

export type LedgerEvalMode = 'single' | 'ledger';

export interface LedgerEvalRow {
  problem: string;
  mode: LedgerEvalMode;
  grading: 'public' | 'hidden';
  tests: number;
  calls: number;
  truncatedCalls: number;
  usage: LedgerUsage;
  status?: string;
  passed: number;
  total: number;
  correct: boolean;
  emitted: boolean;
  durationMs: number;
  error?: string;
  roles?: Record<string, { calls: number; truncated: number; completionTokens: number; totalDurationMs: number; maxDurationMs: number }>;
}

export interface LedgerEvalSummary {
  problems: number;
  correct: number;
  passRate: number;
  calls: number;
  truncatedCalls: number;
  completionTokens: number;
  avgDurationMs: number;
}

export interface LedgerEvalPaired {
  problems: number;
  singlePassRate: number;
  singleCi: { low: number; high: number };
  ledgerPassRate: number;
  ledgerCi: { low: number; high: number };
  meanDelta: number;
  signFlipP: number;
  signFlipMethod: string;
  discordant: { a: number; b: number; both: number; neither: number };
  mcnemarP: number;
}

export interface LedgerEvalReport {
  startedAt: string;
  finishedAt: string;
  model: string;
  grading: 'public' | 'hidden';
  results: LedgerEvalRow[];
  summary: Partial<Record<LedgerEvalMode, LedgerEvalSummary>>;
  paired?: LedgerEvalPaired;
}

export interface LedgerEvalOptions {
  problems: LedgerEvalProblem[];
  provider: LedgerEvalProvider;
  modes?: LedgerEvalMode[];
  maxOutputTokens?: number;
  maxIters?: number;
  think?: boolean;
  freshPerspective?: boolean;
  gradeHidden?: boolean;
  timeoutMs?: number;
  workspaceRoot?: string;
  /** Live per-call hook (role, duration, truncation, tokens, cost). */
  onCall?: (info: { index: number; role: string; durationMs: number; finishReason?: string; completionTokens?: number; costUsd?: number }) => void;
  onProblem?: (row: LedgerEvalRow) => void;
  /** Test seam: inject a fake send instead of building a real provider. */
  createSend?: (provider: LedgerEvalProvider, onCall: LedgerEvalOptions['onCall']) => LedgerSend;
}

const DEFAULT_CONTEXT_TOKENS = 65_536;

function buildSend(provider: LedgerEvalProvider, onCall: LedgerEvalOptions['onCall']): LedgerSend {
  const client = createProvider({
    id: 'ledger-eval',
    name: `ledger-eval-${provider.kind}`,
    kind: provider.kind as ProviderConfig['kind'],
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultModel: provider.model,
    capabilities: [],
    enabled: true,
  });

  let index = 0;
  return async (request) => {
    index += 1;
    const startedAt = Date.now();
    let finishReason: string | undefined;
    let usage: LedgerUsage | undefined;
    const text = await client.send(request.user, {
      system: request.system,
      model: provider.model,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      thinking: false,
      contextTokens: provider.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      onFinishReason: (reason, reportedUsage) => {
        finishReason = reason;
        if (reportedUsage) usage = reportedUsage;
      },
      onUsage: (reportedUsage) => {
        usage = reportedUsage;
      },
    });
    const durationMs = Date.now() - startedAt;
    const costUsd = usage ? estimateCostUsd(provider.model, usage) : null;
    onCall?.({
      index,
      role: request.role,
      durationMs,
      finishReason,
      completionTokens: usage?.completionTokens,
      costUsd: costUsd ?? undefined,
    });
    return { text, finishReason, usage, costUsd: costUsd ?? undefined };
  };
}

async function grade(
  workspaceDir: string,
  solution: string,
  tests: LedgerEvalTest[]
): Promise<{ passed: number; total: number; correct: boolean; emitted: boolean; firstFail?: unknown }> {
  if (solution.trim().length === 0) {
    return { passed: 0, total: tests.length, correct: false, emitted: false };
  }
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, 'solution.py'), solution, 'utf-8');
  let emitted = true;
  try {
    const { spawnSync } = await import('node:child_process');
    emitted = spawnSync('python3', ['-m', 'py_compile', path.join(workspaceDir, 'solution.py')], { timeout: 10_000 }).status === 0;
  } catch {
    emitted = false;
  }
  if (tests.length === 0) return { passed: 0, total: 0, correct: false, emitted };
  const verdict = await runSampleTests(workspaceDir, tests);
  return {
    passed: verdict.passed,
    total: verdict.total,
    correct: verdict.ran && verdict.total > 0 && verdict.passed === verdict.total,
    emitted,
    firstFail: verdict.fail,
  };
}

function aggregateRoles(calls: LedgerCallRecord[]): LedgerEvalRow['roles'] {
  const roles: NonNullable<LedgerEvalRow['roles']> = {};
  for (const call of calls) {
    const entry = (roles[call.role] ??= { calls: 0, truncated: 0, completionTokens: 0, totalDurationMs: 0, maxDurationMs: 0 });
    entry.calls += 1;
    if (call.truncated) entry.truncated += 1;
    entry.completionTokens += call.usage?.completionTokens ?? 0;
    entry.totalDurationMs += call.durationMs ?? 0;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, call.durationMs ?? 0);
  }
  return roles;
}

/** Runs single-call and/or ledger arms over a problem set and grades them. */
export async function runLedgerEval(options: LedgerEvalOptions): Promise<LedgerEvalReport> {
  const modes = options.modes ?? ['single', 'ledger'];
  const grading: 'public' | 'hidden' = options.gradeHidden ? 'hidden' : 'public';
  const root = options.workspaceRoot ?? path.join(os.homedir(), '.omega', 'evals', 'ledger', String(Date.now()));
  await mkdir(root, { recursive: true });
  const send = options.createSend
    ? options.createSend(options.provider, options.onCall)
    : buildSend(options.provider, options.onCall);
  const spec = { kind: 'code' as const, solverSystem: DEFAULT_SOLVER_SYSTEM };
  const startedAt = new Date().toISOString();
  const results: LedgerEvalRow[] = [];

  for (const problem of options.problems) {
    const tests = options.gradeHidden && problem.hiddenTests?.length ? problem.hiddenTests : problem.tests;
    for (const mode of modes) {
      const workspaceDir = path.join(root, mode, problem.id);
      const started = Date.now();
      const row: LedgerEvalRow = {
        problem: problem.id,
        mode,
        grading,
        tests: tests.length,
        calls: 0,
        truncatedCalls: 0,
        usage: {},
        passed: 0,
        total: tests.length,
        correct: false,
        emitted: false,
        durationMs: 0,
      };
      try {
        if (mode === 'single') {
          const result = await runSingleCall(send, problem, spec, { maxOutputTokens: options.maxOutputTokens });
          row.calls = 1;
          row.truncatedCalls = result.finishReason === 'length' ? 1 : 0;
          row.usage = result.usage ?? {};
          Object.assign(row, await grade(path.join(workspaceDir, 'grade'), result.code, tests));
        } else {
          const result = await runLedgerLoop(send, problem, spec, {
            workspaceDir,
            maxIters: options.maxIters,
            maxOutputTokens: options.maxOutputTokens,
            freshPerspective: options.freshPerspective,
          });
          row.calls = result.calls.length;
          row.truncatedCalls = result.truncatedCalls;
          row.usage = result.usage;
          row.status = result.status;
          row.roles = aggregateRoles(result.calls);
          Object.assign(row, await grade(path.join(workspaceDir, 'grade'), result.solution, tests));
        }
      } catch (err) {
        row.error = err instanceof Error ? err.message : String(err);
      }
      row.durationMs = Date.now() - started;
      results.push(row);
      options.onProblem?.(row);
    }
  }

  const summary: LedgerEvalReport['summary'] = {};
  for (const mode of modes) {
    const rows = results.filter((row) => row.mode === mode);
    const correct = rows.filter((row) => row.correct).length;
    summary[mode] = {
      problems: rows.length,
      correct,
      passRate: rows.length > 0 ? correct / rows.length : 0,
      calls: rows.reduce((sum, row) => sum + row.calls, 0),
      truncatedCalls: rows.reduce((sum, row) => sum + row.truncatedCalls, 0),
      completionTokens: rows.reduce((sum, row) => sum + (row.usage.completionTokens ?? 0), 0),
      avgDurationMs: rows.length > 0 ? rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length : 0,
    };
  }

  let paired: LedgerEvalPaired | undefined;
  if (modes.includes('single') && modes.includes('ledger')) {
    const ids = [...new Set(results.map((row) => row.problem))];
    const singleVec = ids.map((id) => Boolean(results.find((row) => row.problem === id && row.mode === 'single')?.correct));
    const ledgerVec = ids.map((id) => Boolean(results.find((row) => row.problem === id && row.mode === 'ledger')?.correct));
    const deltas = ids.map((_, index) => (ledgerVec[index] ? 1 : 0) - (singleVec[index] ? 1 : 0));
    const flip = signFlipPermutation(deltas);
    const discordant = discordantCounts(singleVec, ledgerVec);
    const singleCi = meanCi95(singleVec.map(Number));
    const ledgerCi = meanCi95(ledgerVec.map(Number));
    paired = {
      problems: ids.length,
      singlePassRate: singleCi.mean,
      singleCi: { low: singleCi.low, high: singleCi.high },
      ledgerPassRate: ledgerCi.mean,
      ledgerCi: { low: ledgerCi.low, high: ledgerCi.high },
      meanDelta: flip.meanDelta,
      signFlipP: flip.pValue,
      signFlipMethod: flip.method,
      discordant,
      mcnemarP: mcnemarExact(discordant.a, discordant.b),
    };
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    model: options.provider.model,
    grading,
    results,
    summary,
    paired,
  };
}

export function formatLedgerEvalSummary(report: LedgerEvalReport): string {
  const lines: string[] = [];
  const summaryEntries: [string, LedgerEvalSummary | undefined][] = Object.entries(report.summary);
  for (const [mode, summary] of summaryEntries) {
    if (!summary) continue;
    lines.push(
      `${mode.padEnd(6)} pass@1=${(summary.passRate * 100).toFixed(0)}% (${String(summary.correct)}/${String(summary.problems)})` +
        ` calls=${String(summary.calls)} truncated=${String(summary.truncatedCalls)} tokens=${String(summary.completionTokens)}` +
        ` avg=${(summary.avgDurationMs / 1000).toFixed(1)}s`
    );
  }
  const ledgerRows = report.results.filter((row) => row.mode === 'ledger' && row.roles);
  if (ledgerRows.length > 0) {
    const totals: NonNullable<LedgerEvalRow['roles']> = {};
    for (const row of ledgerRows) {
      for (const [role, entry] of Object.entries(row.roles ?? {})) {
        const agg = (totals[role] ??= { calls: 0, truncated: 0, completionTokens: 0, totalDurationMs: 0, maxDurationMs: 0 });
        agg.calls += entry.calls;
        agg.truncated += entry.truncated;
        agg.completionTokens += entry.completionTokens;
        agg.totalDurationMs += entry.totalDurationMs;
        agg.maxDurationMs = Math.max(agg.maxDurationMs, entry.maxDurationMs);
      }
    }
    lines.push('');
    lines.push('ledger by role:');
    lines.push(`${'role'.padEnd(18)} ${'calls'.padStart(5)} ${'trunc'.padStart(5)} ${'out tok'.padStart(8)} ${'avg'.padStart(7)} ${'max'.padStart(7)}`);
    for (const [role, agg] of Object.entries(totals)) {
      lines.push(
        `${role.padEnd(18)} ${String(agg.calls).padStart(5)} ${String(agg.truncated).padStart(5)} ` +
          `${String(agg.completionTokens).padStart(8)} ${(agg.totalDurationMs / agg.calls / 1000).toFixed(1).padStart(6)}s ` +
          `${(agg.maxDurationMs / 1000).toFixed(1).padStart(6)}s`
      );
    }
  }
  if (report.paired) {
    const p = report.paired;
    lines.push('');
    lines.push(`paired comparison (n=${String(p.problems)} problems, ${report.grading} grading):`);
    lines.push(`  single pass@1 = ${(p.singlePassRate * 100).toFixed(1)}% [${(p.singleCi.low * 100).toFixed(1)}, ${(p.singleCi.high * 100).toFixed(1)}]`);
    lines.push(`  ledger pass@1 = ${(p.ledgerPassRate * 100).toFixed(1)}% [${(p.ledgerCi.low * 100).toFixed(1)}, ${(p.ledgerCi.high * 100).toFixed(1)}]`);
    lines.push(`  mean delta = ${(p.meanDelta * 100).toFixed(1)} pp, sign-flip p=${p.signFlipP.toFixed(4)} (${p.signFlipMethod})`);
    lines.push(
      `  discordants: single-only ${String(p.discordant.a)}, ledger-only ${String(p.discordant.b)}, both ${String(p.discordant.both)}, neither ${String(p.discordant.neither)}` +
        ` (McNemar p=${p.mcnemarP.toFixed(4)})`
    );
  }
  return lines.join('\n');
}

export async function writeLedgerEvalReport(report: LedgerEvalReport, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
}
