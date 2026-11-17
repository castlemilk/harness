#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '..', '..');

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatDuration(ms) {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function readResults(filePath) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const counts = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
    if (!raw || typeof raw !== 'object' ||
        !counts.every((key) => Number.isInteger(raw[key]) && raw[key] >= 0) ||
        typeof raw.success !== 'boolean' || !Array.isArray(raw.testResults) ||
        !raw.testResults.every((file) => file && typeof file.name === 'string' && ['passed', 'failed'].includes(file.status) &&
          Array.isArray(file.assertionResults) && file.assertionResults.every((assertion) =>
            assertion && ['passed', 'failed', 'pending', 'skipped', 'todo'].includes(assertion.status) &&
            (assertion.failureMessages === undefined ||
              (Array.isArray(assertion.failureMessages) && assertion.failureMessages.every((message) => typeof message === 'string')))))) {
      throw new Error('invalid Vitest result structure');
    }
    const assertions = raw.testResults.flatMap((file) => file.assertionResults);
    const count = (status) => assertions.filter((assertion) => assertion.status === status).length;
    // Pinned Vitest 1.6 counts all non-failed tests as numPassedTests, including
    // skipped/todo. Pending is a subset of assertion status pending (mode-only
    // pending assertions need not have a running result yet).
    if (raw.numTotalTests !== assertions.length || raw.numFailedTests !== count('failed') ||
        raw.numPassedTests !== raw.numTotalTests - raw.numFailedTests ||
        raw.numTodoTests !== count('todo') || raw.numPendingTests > count('pending')) {
      throw new Error('inconsistent Vitest result counts');
    }
    return { raw, error: null };
  } catch (error) {
    return { raw: null, error: `Required results unavailable: ${error.message}` };
  }
}

function generateMarkdown(raw, command, exitCode, durationMs, diagnostics) {
  const summary = raw?.numTotalTests ?? 'unavailable';
  const assertions = raw?.testResults.flatMap((file) => file.assertionResults);
  const count = (status) => assertions?.filter((assertion) => assertion.status === status).length ?? 'unavailable';
  const passed = count('passed');
  const failed = raw?.numFailedTests ?? 'unavailable';
  const skipped = count('skipped');
  const testFiles = raw?.testResults ?? [];

  let md = `# Omega Harness E2E Report\n\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n`;
  md += `- **Command:** \`${command}\`\n`;
  md += `- **Exit code:** ${exitCode}\n`;
  md += `- **Total duration:** ${formatDuration(durationMs)}\n\n`;
  if (diagnostics.length) md += `## Diagnostics\n\n${diagnostics.map((line) => `- ${line}`).join('\n')}\n\n`;
  md += `## Summary\n\n`;
  md += `- Total tests: ${summary}\n`;
  md += `- Passed: ${passed}\n`;
  md += `- Failed: ${failed}\n`;
  md += `- Skipped: ${skipped}\n`;
  md += `- Todo: ${count('todo')}\n`;
  md += `- Pending: ${count('pending')}\n\n`;

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

export async function runE2EReport({
  storageRoot = process.env.OMEGA_STORAGE_ROOT ?? path.join(os.homedir(), '.omega'),
  runner = spawnSync,
  log = console.log,
} = {}) {
  const reportsDir = path.join(storageRoot, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  // Unique per attempt: never accept a prior invocation's result as current.
  const ts = `${nowIso()}-${randomUUID()}`;
  const rawFile = path.join(reportsDir, `e2e-raw-${ts}.json`);
  const reportFile = path.join(reportsDir, `e2e-report-${ts}.md`);

  const command = 'pnpm --filter @omega/e2e test -- --reporter=json --outputFile=' + rawFile;
  log(`Running E2E suite -> ${rawFile}`);
  const start = Date.now();
  let result;
  try {
    result = runner('pnpm', ['--filter', '@omega/e2e', 'test', '--', '--reporter=json', `--outputFile=${rawFile}`], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    });
  } catch (error) {
    result = { status: null, error };
  }
  const duration = Date.now() - start;
  const { raw, error } = await readResults(rawFile);
  const diagnostics = [];
  if (result.error) diagnostics.push(`Command error: ${result.error.message}`);
  if (result.signal) diagnostics.push(`Command terminated by signal: ${result.signal}`);
  if (result.status == null) diagnostics.push('Command did not return an exit status');
  if (error) diagnostics.push(error);
  if (raw && (!raw.success || raw.numFailedTests > 0 || raw.testResults.some((file) => file.status === 'failed'))) {
    diagnostics.push('Vitest reported an unsuccessful run');
  }
  if (raw?.testResults.some((file) => file.assertionResults.some((assertion) => assertion.status === 'pending'))) {
    diagnostics.push('Vitest results contain unfinished assertions');
  }
  // Preserve ordinary nonzero child statuses; signal/spawn/report failures must
  // never become a successful wrapper exit, even when partial results exist.
  const exitCode = Number.isInteger(result.status) && result.status > 0 ? result.status
    : result.status === 0 && diagnostics.length === 0 ? 0 : 1;
  const md = generateMarkdown(raw, command, exitCode, duration, diagnostics);
  await fs.writeFile(reportFile, md, 'utf-8');
  log(`\nE2E report written to ${reportFile}`);
  if (raw) {
    const passed = raw.testResults.flatMap((file) => file.assertionResults).filter((assertion) => assertion.status === 'passed').length;
    log(`Tests: ${passed}/${raw.numTotalTests} passed`);
  }
  return { exitCode, rawFile, reportFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runE2EReport().then(({ exitCode }) => {
    process.exitCode = exitCode;
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
