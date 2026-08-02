import fs from 'node:fs/promises';
import path from 'node:path';
import { omegaReportsDir } from '@omega/core';
import type { BenchmarkReport, BenchmarkResult } from './types.js';

function nowIso(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function resultLine(r: BenchmarkResult, idx: number): string {
  const symbol = r.evaluation.passed ? '✓' : '✗';
  const status = r.status === 'timeout' ? 'timeout' : r.status;
  const score = r.evaluation.score !== undefined ? ` (score ${String(r.evaluation.score)})` : '';
  const errText = r.evaluation.message || r.taskError;
  const msg = errText ? ` — ${errText}` : '';
  return `${String(idx + 1)}. ${symbol} ${r.task.name} [${status}] ${formatDuration(r.durationMs)}${score}${msg}`;
}

function traceSummaryBlock(r: BenchmarkResult): string[] {
  const ts = r.traceSummary;
  if (!ts || ts.totalSpans === 0) return [];
  const lines: string[] = [];
  lines.push(`  Trace: ${String(ts.totalSpans)} spans, ${formatDuration(ts.totalDurationMs)} wall`);
  if (ts.totalTokens) {
    const prompt = ts.promptTokens ?? 0;
    const completion = ts.completionTokens ?? 0;
    lines.push(`  Tokens: ${String(ts.totalTokens)} total (${String(prompt)} prompt + ${String(completion)} completion)`);
  }
  if (ts.toolSummary.length > 0) {
    lines.push('  Tools:');
    for (const t of ts.toolSummary) {
      const sr = `${String(Math.round(t.successRate * 100))}%`;
      lines.push(`    - ${t.tool.padEnd(20)} ${String(t.total).padStart(4)} calls  ${sr.padStart(4)} success  ${String(t.failure).padStart(3)} fail`);
    }
  }
  if (ts.topErrors.length > 0) {
    lines.push('  Top errors:');
    for (const e of ts.topErrors.slice(0, 5)) {
      lines.push(`    - [${e.tool}] ${e.message.slice(0, 120)}`);
    }
  }
  return lines;
}

export async function writeReport(report: BenchmarkReport, outputDir = omegaReportsDir()): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const ts = nowIso();
  const jsonFile = path.join(outputDir, `benchmark-${ts}.json`);
  const mdFile = path.join(outputDir, `benchmark-${ts}.md`);

  await fs.writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf-8');

  // Keep a stable "latest" symlink so scripts and the UI can always find the
  // most recent report without guessing the timestamp.
  const latestFile = path.join(outputDir, 'benchmark-latest.json');
  try {
    await fs.unlink(latestFile);
  } catch {
    // ignore if it does not exist
  }
  try {
    await fs.symlink(path.basename(jsonFile), latestFile);
  } catch {
    // symlinks can fail on some filesystems; the timestamped file is still there
  }

  const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
  const md = [
    '# Omega Benchmark Report',
    '',
    `- Suite: ${report.suite}`,
    `- Timestamp: ${report.timestamp}`,
    `- Total: ${String(report.total)}`,
    `- Passed: ${String(report.passed)}`,
    `- Failed: ${String(report.failed)}`,
    `- Timeouts: ${String(report.timeouts)}`,
    `- Pass rate: ${String(passRate)}%`,
    `- Total duration: ${formatDuration(report.totalDurationMs)}`,
    '',
    '## Results',
    '',
    ...report.results.flatMap((r, i) => [resultLine(r, i), ...traceSummaryBlock(r)]),
    '',
    '## Details',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    '',
  ].join('\n');

  await fs.writeFile(mdFile, md, 'utf-8');
  return jsonFile;
}

export function printSummary(report: BenchmarkReport): void {
  const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
  console.log(`\nBenchmark: ${report.suite}`);
  console.log(`Total: ${String(report.total)} | Passed: ${String(report.passed)} | Failed: ${String(report.failed)} | Timeouts: ${String(report.timeouts)}`);
  console.log(`Pass rate: ${String(passRate)}%`);
  console.log(`Duration: ${formatDuration(report.totalDurationMs)}`);
  for (const r of report.results) {
    console.log(resultLine(r, report.results.indexOf(r)));
    for (const line of traceSummaryBlock(r)) {
      console.log(line);
    }
  }
}
