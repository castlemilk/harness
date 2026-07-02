#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '..', '..');
const reportsDir = path.join(root, '.omega', 'reports');

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatDuration(ms) {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function generateMarkdown(raw, command, exitCode, durationMs) {
  const summary = raw?.numTotalTests ?? 0;
  const passed = raw?.numPassedTests ?? 0;
  const failed = raw?.numFailedTests ?? 0;
  const skipped = raw?.numPendingTests ?? 0;
  const testFiles = raw?.testResults ?? [];

  let md = `# Omega Harness E2E Report\n\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n`;
  md += `- **Command:** \`${command}\`\n`;
  md += `- **Exit code:** ${exitCode}\n`;
  md += `- **Total duration:** ${formatDuration(durationMs)}\n\n`;
  md += `## Summary\n\n`;
  md += `- Total tests: ${summary}\n`;
  md += `- Passed: ${passed} ✅\n`;
  md += `- Failed: ${failed} ❌\n`;
  md += `- Skipped: ${skipped}\n\n`;

  if (failed > 0) {
    md += `## Failures\n\n`;
    for (const file of testFiles) {
      const failing = (file.assertionResults ?? []).filter((a) => a.status === 'failed');
      for (const assertion of failing) {
        md += `### ${file.name} > ${assertion.title}\n\n`;
        md += '```\n';
        md += (assertion.failureMessages ?? []).join('\n');
        md += '\n```\n\n';
      }
    }
  }

  md += `## Test Files\n\n`;
  md += '| File | Tests | Passed | Failed | Duration |\n';
  md += '|------|------:|-------:|-------:|---------:|\n';
  for (const file of testFiles) {
    const total = file.assertionResults?.length ?? 0;
    const fPassed = (file.assertionResults ?? []).filter((a) => a.status === 'passed').length;
    const fFailed = (file.assertionResults ?? []).filter((a) => a.status === 'failed').length;
    md += `| ${path.relative(root, file.name)} | ${total} | ${fPassed} | ${fFailed} | ${formatDuration(file.perfStats?.runtime)} |\n`;
  }

  return md;
}

async function main() {
  await fs.mkdir(reportsDir, { recursive: true });
  const ts = nowIso();
  const rawFile = path.join(reportsDir, `e2e-raw-${ts}.json`);
  const reportFile = path.join(reportsDir, `e2e-report-${ts}.md`);

  const command = 'pnpm --filter @omega/e2e test -- --reporter=json --outputFile=' + rawFile;
  console.log(`Running E2E suite -> ${rawFile}`);
  const start = Date.now();
  const result = spawnSync('pnpm', ['--filter', '@omega/e2e', 'test', '--', '--reporter=json', `--outputFile=${rawFile}`], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  const duration = Date.now() - start;

  const raw = await readJsonSafe(rawFile);
  const md = generateMarkdown(raw, command, result.status ?? -1, duration);
  await fs.writeFile(reportFile, md, 'utf-8');

  console.log(`\nE2E report written to ${reportFile}`);
  if (raw) {
    console.log(`Tests: ${raw.numPassedTests ?? 0}/${raw.numTotalTests ?? 0} passed`);
  }
  process.exit(result.status ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
