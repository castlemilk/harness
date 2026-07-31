import fs from 'node:fs/promises';
import path from 'node:path';
import { omegaReportsDir } from '@omega/core';
import type { BenchmarkReport } from './types.js';

export interface TrendEntry {
  file: string;
  timestamp: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  passRate: number;
  totalDurationMs: number;
  totalTokens: number;
  promptVersionId?: string;
  promptHash?: string;
}

export interface TrendOptions {
  /** Directory containing benchmark report JSONs. Defaults to omegaReportsDir(). */
  outputDir?: string;
  /** Filter to a specific suite name. */
  suite?: string;
  /** Maximum number of recent entries to show. */
  last?: number;
}

async function loadReports(outputDir: string): Promise<TrendEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(outputDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.startsWith('benchmark-') && f.endsWith('.json') && !f.includes('latest'));
  const entries: TrendEntry[] = [];

  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(outputDir, file), 'utf-8');
      const report = JSON.parse(raw) as BenchmarkReport;
      const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
      const totalTokens = report.totalUsage?.totalTokens ?? report.results.reduce(
        (sum, r) => sum + (r.agentRun?.totalTokens ?? 0),
        0
      );
      entries.push({
        file,
        timestamp: report.timestamp,
        suite: report.suite,
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        timeouts: report.timeouts,
        passRate,
        totalDurationMs: report.totalDurationMs,
        totalTokens,
        promptVersionId: report.promptVersionId,
        promptHash: report.promptHash,
      });
    } catch {
      // skip malformed report files
    }
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return entries;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${String(m)}m ${String(Math.round(s - m * 60))}s`;
}

function formatTokens(n: number): string {
  if (n === 0) return '-';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatTrend(entries: TrendEntry[]): string {
  if (entries.length === 0) return 'No benchmark reports found.';

  const lines: string[] = [];
  lines.push('# Benchmark Trend');
  lines.push('');

  // Summary stats
  const latest = entries[entries.length - 1];
  const first = entries[0];
  const bestRate = Math.max(...entries.map((e) => e.passRate));
  const avgTokens = entries.reduce((a, e) => a + e.totalTokens, 0) / entries.length;

  lines.push(`Reports:  ${String(entries.length)}`);
  lines.push(`Suite:    ${latest.suite}`);
  lines.push(`Latest:   ${String(latest.passRate)}% (${String(latest.passed)}/${String(latest.total)}) at ${latest.timestamp}`);
  lines.push(`Best:     ${String(bestRate)}%`);
  lines.push(`Avg tokens: ${formatTokens(Math.round(avgTokens))}`);

  // Delta from first to latest
  if (entries.length > 1) {
    const rateDelta = latest.passRate - first.passRate;
    const sign = rateDelta > 0 ? '+' : '';
    lines.push(`Delta:    ${sign}${String(rateDelta)}% from first run`);
  }
  lines.push('');

  // Table
  const headers = ['timestamp', 'suite', 'pass%', 'passed', 'failed', 'timeouts', 'duration', 'tokens', 'prompt_version'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.suite,
    `${String(e.passRate)}%`,
    String(e.passed),
    String(e.failed),
    String(e.timeouts),
    formatDuration(e.totalDurationMs),
    formatTokens(e.totalTokens),
    e.promptVersionId ?? '-',
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const pad = (s: string, w: number) => s.padEnd(w);

  lines.push(headers.map((h, i) => pad(h, widths[i])).join('  '));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c, widths[i])).join('  '));
  }
  lines.push('');

  // Sparkline
  if (entries.length > 1) {
    const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const rates = entries.map((e) => e.passRate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const range = max - min || 1;
    const spark = rates
      .map((r) => {
        const idx = Math.round(((r - min) / range) * (sparkChars.length - 1));
        return sparkChars[idx];
      })
      .join('');
    lines.push(`Pass rate: ${spark}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function generateTrend(opts: TrendOptions = {}): Promise<string> {
  const outputDir = opts.outputDir ?? omegaReportsDir();
  let entries = await loadReports(outputDir);

  if (opts.suite) {
    entries = entries.filter((e) => e.suite === opts.suite);
  }
  if (opts.last && opts.last > 0) {
    entries = entries.slice(-opts.last);
  }

  return formatTrend(entries);
}
