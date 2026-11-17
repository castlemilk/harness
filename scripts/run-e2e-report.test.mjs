import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runE2EReport } from './run-e2e-report.mjs';

const passing = {
  success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: '/fixture/example.test.mjs', status: 'passed', assertionResults: [{ title: 'example', status: 'passed' }] }],
};

async function fixture(t, result, raw = passing) {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-report-test-'));
  t.after(() => fs.rm(storageRoot, { recursive: true, force: true }));
  const output = await runE2EReport({ storageRoot, log() {}, runner(command, args, options) {
    assert.equal(command, 'pnpm');
    assert.deepEqual(args.slice(0, 5), ['--filter', '@omega/e2e', 'test', '--', '--reporter=json']);
    assert.equal(options.shell, false);
    const rawFile = args[5].slice('--outputFile='.length);
    if (raw !== undefined) fsSync.writeFileSync(rawFile, typeof raw === 'string' ? raw : JSON.stringify(raw));
    return result;
  } });
  return { ...output, markdown: await fs.readFile(output.reportFile, 'utf8') };
}

test('successful run keeps valid counts and exits zero', async (t) => {
  const output = await fixture(t, { status: 0 });
  assert.equal(output.exitCode, 0);
  assert.match(output.markdown, /Total tests: 1/);
  assert.match(output.markdown, /Passed: 1/);
});

test('nonzero status is preserved and partial failure diagnostics remain available', async (t) => {
  const output = await fixture(t, { status: 7 }, {
    ...passing, success: false, numPassedTests: 0, numFailedTests: 1,
    testResults: [{ name: '/fixture/example.test.mjs', status: 'passed', assertionResults: [{ title: 'example', status: 'failed', failureMessages: ['expected failure detail'] }] }],
  });
  assert.equal(output.exitCode, 7);
  assert.match(output.markdown, /expected failure detail/);
});

for (const [name, result, diagnostic] of [
  ['signal with partial passing report', { status: null, signal: 'SIGTERM' }, /SIGTERM/],
  ['spawn error with partial passing report', { status: null, error: new Error('ENOENT') }, /ENOENT/],
  ['missing child status', { status: null }, /did not return an exit status/],
  ['error despite zero status', { status: 0, error: new Error('spawn failed') }, /spawn failed/],
]) {
  test(name, async (t) => {
    const output = await fixture(t, result);
    assert.equal(output.exitCode, 1);
    assert.match(output.markdown, diagnostic);
    assert.match(output.markdown, /Passed: 1/);
  });
}

for (const [name, raw] of [
  ['malformed JSON', '{'], ['null JSON', 'null'], ['missing counts', {}],
  ['invalid test files', { ...passing, testResults: [null] }],
  ['invalid failure messages', { ...passing, testResults: [{ name: 'test', status: 'passed', assertionResults: [{ status: 'failed', failureMessages: 'wrong type' }] }] }],
]) {
  test(name, async (t) => {
    const output = await fixture(t, { status: 0 }, raw);
    assert.equal(output.exitCode, 1);
    assert.match(output.markdown, /Required results unavailable/);
    assert.match(output.markdown, /Total tests: unavailable/);
    assert.doesNotMatch(output.markdown, /Passed: 0/);
  });
}

for (const raw of [{ ...passing, success: false }, { ...passing, numPassedTests: 0, numFailedTests: 1, testResults: [{ name: 'test', status: 'failed', assertionResults: [{ status: 'failed' }] }] }]) {
  test('report failure cannot be masked by a zero child exit', async (t) => {
    const output = await fixture(t, { status: 0 }, raw);
    assert.equal(output.exitCode, 1);
    assert.match(output.markdown, /unsuccessful run/);
  });
}

test('thrown runner errors still produce diagnostic Markdown', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-report-throw-'));
  t.after(() => fs.rm(storageRoot, { recursive: true, force: true }));
  const output = await runE2EReport({ storageRoot, log() {}, runner() { throw new Error('runner failed'); } });
  assert.equal(output.exitCode, 1);
  assert.match(await fs.readFile(output.reportFile, 'utf8'), /runner failed/);
});

test('CLI fails for missing results and does not reuse an old passing report', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-report-cli-'));
  t.after(() => fs.rm(storageRoot, { recursive: true, force: true }));
  const bin = path.join(storageRoot, 'pnpm');
  await fs.writeFile(bin, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.mkdir(path.join(storageRoot, 'reports'));
  await fs.writeFile(path.join(storageRoot, 'reports', 'e2e-raw-old.json'), JSON.stringify(passing));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-e2e-report.mjs', import.meta.url))], {
    env: { ...process.env, PATH: `${storageRoot}:${process.env.PATH}`, OMEGA_STORAGE_ROOT: storageRoot }, encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  const report = (await fs.readdir(path.join(storageRoot, 'reports'))).find((file) => file.endsWith('.md'));
  assert.match(await fs.readFile(path.join(storageRoot, 'reports', report), 'utf8'), /Total tests: unavailable/);
});

for (const [name, raw] of [
  ['nonzero total without assertion records', { ...passing, testResults: [] }],
  ['failed assertion hidden by successful aggregate', { ...passing, testResults: [{ name: 'test', status: 'passed', assertionResults: [{ status: 'failed' }] }] }],
  ['unknown assertion status', { ...passing, testResults: [{ name: 'test', status: 'passed', assertionResults: [{ status: 'surprise' }] }] }],
  ['incorrect passed count', { ...passing, numPassedTests: 0 }],
  ['incorrect todo count', { ...passing, numTodoTests: 1 }],
]) {
  test(name, async (t) => {
    const output = await fixture(t, { status: 0 }, raw);
    assert.equal(output.exitCode, 1);
    assert.match(output.markdown, /Required results unavailable/);
  });
}

test('pinned Vitest skipped and todo accounting is valid and displayed separately', async (t) => {
  const output = await fixture(t, { status: 0 }, {
    ...passing, numTotalTests: 3, numPassedTests: 3, numTodoTests: 1,
    testResults: [{ name: 'test', status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'skipped' }, { status: 'todo' }] }],
  });
  assert.equal(output.exitCode, 0);
  assert.match(output.markdown, /Passed: 1/);
  assert.match(output.markdown, /Skipped: 1/);
  assert.match(output.markdown, /Todo: 1/);
});

test('file-level failures cannot be masked by a successful aggregate', async (t) => {
  const output = await fixture(t, { status: 0 }, { ...passing, testResults: [{ ...passing.testResults[0], status: 'failed' }] });
  assert.equal(output.exitCode, 1);
});

test('unfinished assertions cannot pass even with zero running count', async (t) => {
  const output = await fixture(t, { status: 0 }, { ...passing, testResults: [{ name: 'test', status: 'passed', assertionResults: [{ status: 'pending' }] }] });
  assert.equal(output.exitCode, 1);
  assert.match(output.markdown, /unfinished assertions/);
});
