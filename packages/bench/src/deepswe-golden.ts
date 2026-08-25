import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadDeepSWESuite, type DeepSWEOptions } from './adapters/deepswe.js';
import type { BenchmarkEvaluation, BenchmarkTask } from './types.js';

export interface DeepSWEGoldenOutcome {
  passed: boolean;
  f2p_passed: number;
  f2p_total: number;
  p2p_passed: number;
  p2p_total: number;
}

export interface DeepSWEGoldenFixture {
  taskId: string;
  sourceHarnessTaskId: string;
  sourceTaskDiffId: string;
  patchFile: string;
  patchSha256: string;
  sourceDurationMs: number;
  expected: DeepSWEGoldenOutcome;
}

export interface DeepSWEGoldenManifest {
  version: 1;
  name: string;
  sourceBenchmarkRunId: string;
  fixtures: DeepSWEGoldenFixture[];
}

export interface DeepSWEGoldenRunOptions {
  manifestPath: string;
  tasksDir: string;
  taskIds?: string[];
  useDocker?: boolean;
}

export interface DeepSWEGoldenFixtureResult {
  taskId: string;
  sourceHarnessTaskId: string;
  expected: DeepSWEGoldenOutcome;
  actual?: Partial<DeepSWEGoldenOutcome>;
  matched: boolean;
  differences: string[];
  sourceDurationMs: number;
  setupDurationMs: number;
  verifierDurationMs: number;
  totalDurationMs: number;
  error?: string;
}

export interface DeepSWEGoldenRunResult {
  manifestName: string;
  sourceBenchmarkRunId: string;
  total: number;
  matched: number;
  durationMs: number;
  results: DeepSWEGoldenFixtureResult[];
}

interface DeepSWEGoldenDependencies {
  loadTasks?: (options: DeepSWEOptions) => Promise<BenchmarkTask[]>;
}

interface PreparedFixture {
  fixture: DeepSWEGoldenFixture;
  patch: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${context}.${key} must be a non-negative finite number`);
  }
  return value;
}

function parseOutcome(value: unknown, context: string): DeepSWEGoldenOutcome {
  if (!isRecord(value) || typeof value.passed !== 'boolean') {
    throw new Error(`${context} must contain a boolean passed value`);
  }
  return {
    passed: value.passed,
    f2p_passed: requireNumber(value, 'f2p_passed', context),
    f2p_total: requireNumber(value, 'f2p_total', context),
    p2p_passed: requireNumber(value, 'p2p_passed', context),
    p2p_total: requireNumber(value, 'p2p_total', context),
  };
}

function parseFixture(value: unknown, index: number): DeepSWEGoldenFixture {
  const context = `fixtures[${String(index)}]`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  return {
    taskId: requireString(value, 'taskId', context),
    sourceHarnessTaskId: requireString(value, 'sourceHarnessTaskId', context),
    sourceTaskDiffId: requireString(value, 'sourceTaskDiffId', context),
    patchFile: requireString(value, 'patchFile', context),
    patchSha256: requireString(value, 'patchSha256', context),
    sourceDurationMs: requireNumber(value, 'sourceDurationMs', context),
    expected: parseOutcome(value.expected, `${context}.expected`),
  };
}

export async function loadDeepSWEGoldenManifest(manifestPath: string): Promise<DeepSWEGoldenManifest> {
  const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error('DeepSWE golden manifest must be an object');
  if (parsed.version !== 1) throw new Error('DeepSWE golden manifest version must be 1');
  if (!Array.isArray(parsed.fixtures) || parsed.fixtures.length === 0) {
    throw new Error('DeepSWE golden manifest fixtures must be a non-empty array');
  }
  const fixtures = parsed.fixtures.map(parseFixture);
  const taskIds = new Set<string>();
  for (const fixture of fixtures) {
    if (taskIds.has(fixture.taskId)) {
      throw new Error(`DeepSWE golden manifest contains duplicate task ${fixture.taskId}`);
    }
    taskIds.add(fixture.taskId);
  }
  return {
    version: 1,
    name: requireString(parsed, 'name', 'manifest'),
    sourceBenchmarkRunId: requireString(parsed, 'sourceBenchmarkRunId', 'manifest'),
    fixtures,
  };
}

function resolvePatchPath(manifestPath: string, patchFile: string): string {
  const manifestDir = path.resolve(path.dirname(manifestPath));
  const patchPath = path.resolve(manifestDir, patchFile);
  if (path.isAbsolute(patchFile) || (patchPath !== manifestDir && !patchPath.startsWith(`${manifestDir}${path.sep}`))) {
    throw new Error(`Golden patch path must stay inside the fixture directory: ${patchFile}`);
  }
  return patchPath;
}

async function prepareFixture(
  manifestPath: string,
  fixture: DeepSWEGoldenFixture,
): Promise<PreparedFixture> {
  const patchPath = resolvePatchPath(manifestPath, fixture.patchFile);
  const patchBuffer = await fs.readFile(patchPath);
  const actualSha256 = crypto.createHash('sha256').update(patchBuffer).digest('hex');
  if (actualSha256 !== fixture.patchSha256) {
    throw new Error(
      `Golden patch SHA-256 mismatch for ${fixture.taskId}: expected ${fixture.patchSha256}, received ${actualSha256}`,
    );
  }
  return { fixture, patch: patchBuffer.toString('utf8') };
}

function metricNumber(
  evaluation: BenchmarkEvaluation,
  key: keyof Omit<DeepSWEGoldenOutcome, 'passed'>,
): number | undefined {
  const value = evaluation.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function outcomeFromEvaluation(evaluation: BenchmarkEvaluation): Partial<DeepSWEGoldenOutcome> {
  return {
    passed: evaluation.passed,
    f2p_passed: metricNumber(evaluation, 'f2p_passed'),
    f2p_total: metricNumber(evaluation, 'f2p_total'),
    p2p_passed: metricNumber(evaluation, 'p2p_passed'),
    p2p_total: metricNumber(evaluation, 'p2p_total'),
  };
}

function compareOutcomes(
  expected: DeepSWEGoldenOutcome,
  actual: Partial<DeepSWEGoldenOutcome>,
): string[] {
  const differences: string[] = [];
  const keys: (keyof DeepSWEGoldenOutcome)[] = [
    'passed',
    'f2p_passed',
    'f2p_total',
    'p2p_passed',
    'p2p_total',
  ];
  for (const key of keys) {
    if (actual[key] !== expected[key]) {
      differences.push(`${key}: expected ${String(expected[key])}, received ${String(actual[key] ?? 'missing')}`);
    }
  }
  return differences;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function roundedDuration(start: number): number {
  return Math.round(performance.now() - start);
}

export async function runDeepSWEGoldenCorpus(
  options: DeepSWEGoldenRunOptions,
  dependencies: DeepSWEGoldenDependencies = {},
): Promise<DeepSWEGoldenRunResult> {
  const startedAt = performance.now();
  const manifest = await loadDeepSWEGoldenManifest(options.manifestPath);
  const requestedIds = options.taskIds === undefined ? undefined : new Set(options.taskIds);
  if (requestedIds?.size === 0) throw new Error('Golden replay taskIds must not be empty');
  if (requestedIds) {
    const knownIds = new Set(manifest.fixtures.map((fixture) => fixture.taskId));
    const unknownIds = [...requestedIds].filter((taskId) => !knownIds.has(taskId));
    if (unknownIds.length > 0) {
      throw new Error(`Golden replay requested unknown task(s): ${unknownIds.join(', ')}`);
    }
  }
  const selected = manifest.fixtures.filter((fixture) => requestedIds?.has(fixture.taskId) ?? true);
  // Validate every patch before any repository setup so a corrupt fixture fails cheaply.
  const prepared = await Promise.all(selected.map((fixture) => prepareFixture(options.manifestPath, fixture)));
  const loadTasks = dependencies.loadTasks ?? loadDeepSWESuite;
  const tasks = await loadTasks({
    tasksDir: options.tasksDir,
    taskIds: selected.map((fixture) => fixture.taskId),
    useDocker: options.useDocker ?? true,
  });
  const tasksByName = new Map(tasks.map((task) => [task.name, task]));
  const missingTasks = selected.filter((fixture) => !tasksByName.has(fixture.taskId));
  if (missingTasks.length > 0) {
    throw new Error(`DeepSWE task definition(s) not found: ${missingTasks.map((fixture) => fixture.taskId).join(', ')}`);
  }

  const results: DeepSWEGoldenFixtureResult[] = [];
  for (const { fixture, patch } of prepared) {
    const task = tasksByName.get(fixture.taskId);
    if (!task) continue;
    const fixtureStartedAt = performance.now();
    const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), `omega-deepswe-golden-${fixture.taskId}-`));
    const projectPath = path.join(workRoot, 'repo');
    let setupDurationMs = 0;
    let verifierDurationMs = 0;
    try {
      if (!task.setup) throw new Error(`DeepSWE task ${fixture.taskId} has no setup function`);
      const evalContext = {
        apiUrl: 'golden-replay://local',
        taskId: fixture.sourceHarnessTaskId,
        projectPath,
        projectId: 'golden-replay',
        diffs: [{ id: fixture.sourceTaskDiffId, branch: 'golden-replay', patch }],
      };
      // The Docker verifier builds its own repo at the base commit inside the
      // image and never reads projectPath when a stored patch is supplied, so
      // cloning + installing dependencies here is pure waste. It dominates
      // replay: measured 1402s of setup against a 12s verifier on abs.
      // Only the LOCAL verifier needs a real project, so if Docker was
      // unavailable and the adapter fell back, redo the fixture properly —
      // verifier_mode reports which path actually graded.
      const runSetup = async (): Promise<void> => {
        const setupStartedAt = performance.now();
        await fs.rm(projectPath, { recursive: true, force: true });
        await task.setup?.(projectPath);
        setupDurationMs += roundedDuration(setupStartedAt);
      };
      const skippedSetup = options.useDocker === true;
      if (skippedSetup) await fs.mkdir(projectPath, { recursive: true });
      else await runSetup();

      const verifierStartedAt = performance.now();
      // A skipped setup leaves projectPath empty, which only the Docker
      // verifier tolerates. If Docker did not grade — whether it reported the
      // local fallback or threw on the empty checkout — redo the fixture with
      // a real project rather than reporting a replay artefact as a result.
      let evaluation: BenchmarkEvaluation | undefined;
      let firstAttemptError: unknown;
      try {
        evaluation = await task.evaluate(evalContext);
      } catch (error) {
        if (!skippedSetup) throw error;
        firstAttemptError = error;
      }
      verifierDurationMs = roundedDuration(verifierStartedAt);
      if (skippedSetup && (firstAttemptError !== undefined || evaluation?.metrics?.verifier_mode !== 'docker')) {
        await runSetup();
        const retryStartedAt = performance.now();
        evaluation = await task.evaluate(evalContext);
        verifierDurationMs += roundedDuration(retryStartedAt);
      }
      if (!evaluation) {
        throw firstAttemptError instanceof Error
          ? firstAttemptError
          : new Error('replay produced no evaluation');
      }
      const actual = outcomeFromEvaluation(evaluation);
      const differences = compareOutcomes(fixture.expected, actual);
      results.push({
        taskId: fixture.taskId,
        sourceHarnessTaskId: fixture.sourceHarnessTaskId,
        expected: fixture.expected,
        actual,
        matched: differences.length === 0,
        differences,
        sourceDurationMs: fixture.sourceDurationMs,
        setupDurationMs,
        verifierDurationMs,
        totalDurationMs: roundedDuration(fixtureStartedAt),
      });
    } catch (error) {
      const message = errorMessage(error);
      results.push({
        taskId: fixture.taskId,
        sourceHarnessTaskId: fixture.sourceHarnessTaskId,
        expected: fixture.expected,
        matched: false,
        differences: [`replay error: ${message}`],
        sourceDurationMs: fixture.sourceDurationMs,
        setupDurationMs,
        verifierDurationMs,
        totalDurationMs: roundedDuration(fixtureStartedAt),
        error: message,
      });
    } finally {
      await fs.rm(workRoot, { recursive: true, force: true });
    }
  }

  return {
    manifestName: manifest.name,
    sourceBenchmarkRunId: manifest.sourceBenchmarkRunId,
    total: results.length,
    matched: results.filter((result) => result.matched).length,
    durationMs: roundedDuration(startedAt),
    results,
  };
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${String(durationMs)}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function formatOutcome(outcome: Partial<DeepSWEGoldenOutcome> | undefined): string {
  if (!outcome) return 'no outcome';
  return `passed=${String(outcome.passed)} f2p=${String(outcome.f2p_passed)}/${String(outcome.f2p_total)}` +
    ` p2p=${String(outcome.p2p_passed)}/${String(outcome.p2p_total)}`;
}

export function formatDeepSWEGoldenSummary(result: DeepSWEGoldenRunResult): string {
  const lines = [
    `DeepSWE golden corpus: ${result.manifestName}`,
    `Source benchmark run: ${result.sourceBenchmarkRunId}`,
  ];
  for (const fixture of result.results) {
    lines.push(
      `${fixture.matched ? 'PASS' : 'FAIL'} ${fixture.taskId} ` +
      `${formatOutcome(fixture.actual)} ` +
      `(setup ${formatDuration(fixture.setupDurationMs)}, verifier ${formatDuration(fixture.verifierDurationMs)}, ` +
      `total ${formatDuration(fixture.totalDurationMs)}, ` +
      `source task ${formatDuration(fixture.sourceDurationMs)} excluding setup)`,
    );
    for (const difference of fixture.differences) lines.push(`  - ${difference}`);
  }
  lines.push(
    `${String(result.matched)}/${String(result.total)} outcomes matched in ${formatDuration(result.durationMs)}`,
  );
  return lines.join('\n');
}
