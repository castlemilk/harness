import fs from 'node:fs/promises';
import path from 'node:path';
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
  const msg = r.evaluation.message ? ` — ${r.evaluation.message}` : '';
  return `${String(idx + 1)}. ${symbol} ${r.task.name} [${status}] ${formatDuration(r.durationMs)}${score}${msg}`;
}

export async function writeReport(report: BenchmarkReport, outputDir = '.omega/reports'): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const ts = nowIso();
  const jsonFile = path.join(outputDir, `benchmark-${ts}.json`);
  const mdFile = path.join(outputDir, `benchmark-${ts}.md`);

  await fs.writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf-8');

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
    ...report.results.map((r, i) => resultLine(r, i)),
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
  }
}
