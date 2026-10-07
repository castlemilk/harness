import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Reuse the bundle's declared YAML dependency; no registry access is needed.
const { parse } = createRequire(new URL('../../packages/bundle/package.json', import.meta.url))('yaml');
const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/benchmark.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.bench.steps;
const step = (name) => {
  const found = steps.find((entry) => entry.name === name);
  assert.ok(found, `Missing workflow step: ${name}`);
  return found;
};

function fixture(t, { report = true, baseline = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-benchmark-workflow-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.mkdirSync(path.join(cwd, '.omega/reports'), { recursive: true });
  if (report) {
    fs.writeFileSync(path.join(cwd, '.omega/reports/benchmark-fixture.json'), '{}');
    fs.writeFileSync(path.join(cwd, '.omega/reports/benchmark-fixture.md'), 'Fixture benchmark summary\n');
  }
  if (baseline) fs.writeFileSync(path.join(cwd, '.omega/reports/baseline.json'), '{}');
  // Only the CLI boundary is stubbed. Execute the actual workflow shell bodies,
  // including tee, report discovery, conditional commands and summary writes.
  fs.writeFileSync(path.join(cwd, 'bin/node'), `#!/bin/bash
printf '%s\\n' "$*" >> "$COMMAND_LOG"
echo fixture-cli-output
if [[ "$*" == *"bench compare"* ]]; then exit "\${COMPARE_EXIT:-0}"; fi
if [[ "$*" == *"--fail-on-regression"* ]]; then exit "\${REGRESSION_EXIT:-0}"; fi
exit "\${BENCH_EXIT:-0}"
`, { mode: 0o755 });
  return {
    cwd,
    run(name, { suite = 'fast', ...env } = {}) {
      const entry = step(name);
      assert.equal(entry.shell, 'bash', `${name} must enable GitHub Actions bash pipefail`);
      const script = entry.run.replaceAll('${{ inputs.suite || \'fast\' }}', suite);
      assert.ok(!script.includes('${{'), 'Unresolved Actions expression');
      return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${path.join(cwd, 'bin')}:${process.env.PATH}`,
          COMMAND_LOG: path.join(cwd, 'commands.log'),
          GITHUB_OUTPUT: path.join(cwd, 'output'),
          GITHUB_STEP_SUMMARY: path.join(cwd, 'summary'),
          GITHUB_WORKSPACE: cwd,
          HARNESS_API_URL: 'http://127.0.0.1:4000',
          ...env,
        },
      });
    },
    read(file) { return fs.readFileSync(path.join(cwd, file), 'utf8'); },
    commands() {
      const file = path.join(cwd, 'commands.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
    },
  };
}

test('build CLI and server closures before migration; never resolve a registry CLI', () => {
  const build = step('Build CLI and server dependencies');
  assert.match(build.run, /pnpm --filter ['"]?@omega\/cli\.\.\.['"]? --filter ['"]?@omega\/server\.\.\.['"]? --workspace-concurrency=1 build/);
  assert.equal(workflow.env.HARNESS_API_URL, 'http://127.0.0.1:4000');
  assert.match(workflow.env.DATABASE_DIR, /\.omega\/cli-db$/);
  const installIndex = steps.findIndex((entry) => entry.run?.includes('install --frozen-lockfile'));
  const buildIndex = steps.indexOf(build);
  const migrateIndex = steps.findIndex((entry) => entry.run === 'pnpm db:migrate');
  assert.ok(installIndex >= 0 && installIndex < buildIndex && buildIndex < migrateIndex);
  assert.ok(migrateIndex < steps.indexOf(step('Run benchmark')));
  assert.doesNotMatch(steps.map((entry) => entry.run ?? '').join('\n'), /\bnpx\b|pnpm\s+dlx\b/);
  assert.equal(workflow.on.schedule[0].cron, '0 6 * * *');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.suite.options, ['fast', 'hard']);
  assert.equal(workflow.on.workflow_dispatch.inputs.fail_on_regression.default, true);
  const checkout = steps.find((entry) => entry.uses === 'actions/checkout@v4');
  assert.equal(checkout.with.submodules, "${{ inputs.suite == 'hard' }}");
});

for (const suite of ['fast', 'hard']) {
  test(`runs checked-out CLI for ${suite} and captures output`, (t) => {
    const f = fixture(t);
    assert.equal(f.run('Run benchmark', { suite }).status, 0);
    const taskArgs = suite === 'hard' ? ` --path ${f.cwd}/deep-swe/tasks` : '';
    assert.deepEqual(f.commands(), [`scripts/ci/with-harness-api.mjs node apps/cli/dist/index.js --api http://127.0.0.1:4000 bench run --suite ${suite}${taskArgs} --output-dir .omega/reports`]);
    assert.match(f.read('bench-output.txt'), /fixture-cli-output/);
    assert.equal(f.read('output'), 'exit_code=0\n');
  });
}

test('benchmark failure survives tee and is captured in the log', (t) => {
  const f = fixture(t);
  assert.equal(f.run('Run benchmark', { BENCH_EXIT: '17' }).status, 17);
  assert.match(f.read('bench-output.txt'), /fixture-cli-output/);
});

test('baseline comparison uses the checked-out CLI and propagates failure through tee', (t) => {
  const f = fixture(t);
  assert.equal(step('Compare against baseline').if, "hashFiles('.omega/reports/baseline.json') != ''");
  assert.equal(f.run('Compare against baseline', { COMPARE_EXIT: '19' }).status, 19);
  assert.deepEqual(f.commands(), ['apps/cli/dist/index.js bench compare --baseline .omega/reports/baseline.json --candidate .omega/reports/benchmark-fixture.json']);
  assert.match(f.read('compare-output.txt'), /fixture-cli-output/);
});

test('requested regression gate keeps baseline, suite and nonzero exit', (t) => {
  const f = fixture(t);
  assert.equal(step('Check for regression').if, "inputs.fail_on_regression == 'true' || inputs.fail_on_regression == true");
  assert.equal(f.run('Check for regression', { suite: 'hard', REGRESSION_EXIT: '23' }).status, 23);
  assert.deepEqual(f.commands(), [`scripts/ci/with-harness-api.mjs node apps/cli/dist/index.js --api http://127.0.0.1:4000 bench run --suite hard --path ${f.cwd}/deep-swe/tasks --baseline .omega/reports/baseline.json --fail-on-regression --output-dir .omega/reports`]);
});

test('absent report or baseline skips optional commands without a shell failure', (t) => {
  const noReport = fixture(t, { report: false });
  for (const name of ['Compare against baseline', 'Check for regression', 'Post summary']) {
    assert.equal(noReport.run(name).status, 0, name);
  }
  assert.deepEqual(noReport.commands(), []);
  const noBaseline = fixture(t, { baseline: false });
  assert.equal(noBaseline.run('Check for regression').status, 0);
  assert.deepEqual(noBaseline.commands(), []);
});

test('reports upload even after failure and summary includes the Markdown report', (t) => {
  const f = fixture(t);
  const upload = step('Upload report');
  assert.equal(upload.if, 'always()');
  for (const file of ['benchmark-*.json', 'benchmark-*.md', 'bench-output.txt', 'compare-output.txt', 'harness-api-output.txt']) {
    assert.ok(upload.with.path.includes(file), `Missing artifact: ${file}`);
  }
  assert.equal(step('Post summary').if, 'always()');
  assert.equal(f.run('Post summary').status, 0);
  assert.match(f.read('summary'), /## Benchmark Report\n\nFixture benchmark summary/);
  fs.unlinkSync(path.join(f.cwd, '.omega/reports/benchmark-fixture.md'));
  assert.equal(f.run('Post summary').status, 0);
  assert.match(f.read('summary'), /See artifact for details/);
});
