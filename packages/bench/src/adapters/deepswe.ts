import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  isTestishPath,
  omegaVerifierToolsDir,
  omegaWorkDir,
} from '@omega/core';
import type { BenchmarkTask, BenchmarkEvaluation, EvaluationContext } from '../types.js';

const execFileAsync = promisify(execFile);

export interface DeepSWEOptions {
  tasksDir: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  useDocker?: boolean;
  /** Per-agent-attempt wall-clock limit advertised in the task prompt. */
  timeoutMs?: number;
}

export function deepSwePatchAuditMetrics(
  modelPatch: string,
  validationSummary: string | undefined,
): Record<
  'graded_patch_test_paths' | 'graded_patch_added_test_paths',
  number
> & Record<'graded_patch_added_test_path_list', string> {
  const paths = new Set<string>();
  const addedPaths = new Set<string>();
  let currentPath: string | undefined;
  let currentPathAdded = false;
  const finishCurrentPath = (): void => {
    if (currentPath && isTestishPath(currentPath)) {
      paths.add(currentPath);
      if (currentPathAdded) addedPaths.add(currentPath);
    }
  };
  for (const line of modelPatch.split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (match?.[2]) {
      finishCurrentPath();
      currentPath = match[2];
      currentPathAdded = false;
    } else if (currentPath && (line.startsWith('new file mode ') || line === '--- /dev/null')) {
      currentPathAdded = true;
    }
  }
  finishCurrentPath();
  let auditedTestPaths: number | undefined;
  let auditedAddedTestPaths: number | undefined;
  let auditedAddedTestPathList: string[] | undefined;
  try {
    const parsed = JSON.parse(validationSummary ?? '') as {
      patchAudit?: {
        gradedPatchTestPaths?: unknown;
        gradedPatchAddedTestPaths?: unknown;
        gradedPatchAddedTestPathList?: unknown;
        gradedPatchSha256?: unknown;
      };
    };
    const capturedPatchSha256 = parsed.patchAudit?.gradedPatchSha256;
    const currentPatchSha256 = createHash('sha256').update(modelPatch).digest('hex');
    // Retries can leave several TaskDiff rows but only one latest AgentRun.
    // Trust its path audit only when it was captured from this exact patch.
    if (capturedPatchSha256 === currentPatchSha256) {
      const testPaths = parsed.patchAudit?.gradedPatchTestPaths;
      if (typeof testPaths === 'number' && Number.isInteger(testPaths) && testPaths >= 0) {
        auditedTestPaths = testPaths;
      }
      const addedTestPaths = parsed.patchAudit?.gradedPatchAddedTestPaths;
      if (typeof addedTestPaths === 'number' && Number.isInteger(addedTestPaths) && addedTestPaths >= 0) {
        auditedAddedTestPaths = addedTestPaths;
      }
      const addedTestPathList = parsed.patchAudit?.gradedPatchAddedTestPathList;
      if (Array.isArray(addedTestPathList)) {
        auditedAddedTestPathList = addedTestPathList.filter(
          (item): item is string => typeof item === 'string',
        );
      }
    }
  } catch {
    // Legacy or absent metadata falls back to the stored patch itself.
  }
  const addedPathList = auditedAddedTestPathList ?? [...addedPaths].sort();
  return {
    graded_patch_test_paths: auditedTestPaths ?? paths.size,
    graded_patch_added_test_paths: auditedAddedTestPaths ?? addedPaths.size,
    graded_patch_added_test_path_list: addedPathList.join('\n'),
  };
}

interface DeepSWETaskToml {
  task?: {
    name?: string;
  };
  metadata?: {
    display_title?: string;
    display_description?: string;
    original_title?: string;
    repository_url?: string;
    base_commit_hash?: string;
    language?: string;
    task_id?: string;
  };
}

export interface DeepSWEReward {
  reward?: number;
  f2p?: number;
  f2p_total?: number;
  f2p_passed?: number;
  p2p?: number;
  p2p_total?: number;
  p2p_passed?: number;
  partial?: number;
  apply_failed?: boolean;
}

type Reward = DeepSWEReward;

export interface KnownP2PEnvironmentFailure {
  testId: string;
  reason: string;
  /**
   * The port whose occupancy is the ASSERTED cause. The exclusion only
   * applies when that port is actually busy — otherwise the same failing
   * test is a real regression and must fail the task. Without this the
   * disclosure claimed a cause it had never checked, and a genuine break in
   * the excluded test was indistinguishable from a busy port.
   */
  requiresBusyPort?: number;
}

export interface TaskEnvironmentOverride {
  pip?: string[];
  npm?: string[];
  dependencyReason?: string;
  knownP2PEnvironmentFailures?: KnownP2PEnvironmentFailure[];
}

export type AppliedTaskEnvironmentOverride =
  | {
      kind: 'dependency';
      task: string;
      requirements: string[];
      reason: string;
    }
  | {
      kind: 'known-p2p-environment-failure';
      task: string;
      testId: string;
      reason: string;
    };

export interface DeepSWEVerifierResult {
  reward: Reward;
  logs: string;
  /** Logs for the verifier invocation whose reward was selected for grading. */
  gradingLogs: string;
  verifierMode: 'docker' | 'local';
  logFile: string;
  exitCode: number;
  timedOut: boolean;
  appliedEnvironmentOverrides: AppliedTaskEnvironmentOverride[];
  patchPathsCleanedCount: number;
}

export interface FlakeRerunGateInput {
  reward: DeepSWEReward;
  timedOut: boolean;
  disabled?: boolean;
  maxP2PFailures?: number;
}

export type FlakeRerunDecision =
  | { shouldRerun: true }
  | { shouldRerun: false; skippedReason: string };

function isValidCount(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function p2pShortfall(reward: DeepSWEReward): number | undefined {
  if (!isValidCount(reward.p2p_total) || !isValidCount(reward.p2p_passed)) return undefined;
  if (reward.p2p_passed > reward.p2p_total) return undefined;
  return reward.p2p_total - reward.p2p_passed;
}

export function decideFlakeRerun(input: FlakeRerunGateInput): FlakeRerunDecision {
  if (input.disabled) {
    return { shouldRerun: false, skippedReason: 'disabled by OMEGA_DEEPSWE_DISABLE_FLAKE_RERUN=1' };
  }
  if (input.reward.reward === 1) {
    return { shouldRerun: false, skippedReason: 'first verifier run passed' };
  }
  if (input.timedOut) {
    return { shouldRerun: false, skippedReason: 'first verifier run timed out' };
  }
  if (input.reward.apply_failed) {
    return { shouldRerun: false, skippedReason: 'model patch failed to apply in the first verifier run' };
  }
  if (
    !isValidCount(input.reward.f2p_total) ||
    !isValidCount(input.reward.f2p_passed) ||
    input.reward.f2p_total === 0 ||
    input.reward.f2p_passed !== input.reward.f2p_total
  ) {
    return { shouldRerun: false, skippedReason: 'f2p was not complete in the first verifier run' };
  }

  const shortfall = p2pShortfall(input.reward);
  if (shortfall === undefined || !isValidCount(input.reward.p2p_total) || input.reward.p2p_total === 0) {
    return { shouldRerun: false, skippedReason: 'first verifier run reported invalid p2p counts' };
  }
  if (shortfall === 0) {
    return { shouldRerun: false, skippedReason: 'first verifier run had no p2p failures to confirm' };
  }

  const maxP2PFailures = input.maxP2PFailures ?? 3;
  if (!Number.isInteger(maxP2PFailures) || maxP2PFailures < 0) {
    return { shouldRerun: false, skippedReason: 'OMEGA_DEEPSWE_FLAKE_MAX_P2P_FAILURES is invalid' };
  }
  const percentageCap = Math.max(1, Math.floor(0.02 * input.reward.p2p_total));
  const effectiveCap = Math.min(maxP2PFailures, percentageCap);
  if (shortfall > effectiveCap) {
    return {
      shouldRerun: false,
      skippedReason: `p2p shortfall ${String(shortfall)} exceeds effective flake cap ${String(effectiveCap)}`,
    };
  }
  return { shouldRerun: true };
}

export function parseFailingP2PTestIds(logs: string): string[] {
  const failures = new Set<string>();
  for (const line of logs.split('\n')) {
    const match = /^\[verifier\] ✗ \[p2p\] (.+)\r?$/.exec(line);
    const testId = match?.[1]?.trim();
    if (testId) failures.add(testId);
  }
  return [...failures];
}

export interface FlakeVerifierRun {
  reward?: DeepSWEReward;
  timedOut?: boolean;
  verifierMode?: DeepSWEVerifierResult['verifierMode'];
  failingP2PTests: readonly string[];
  error?: string;
}

export interface FlakeAwareVerdict {
  passed: boolean;
  flakyTests: string[];
  confirmedFailingTests: string[];
  p2pRerunFailureDisjoint: boolean;
  originalVerdictRetained: boolean;
  reason?: string;
}

export interface FlakeAwareVerdictInput {
  originalPassed: boolean;
  firstRun: FlakeVerifierRun;
  rerun?: FlakeVerifierRun;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validRewardCounts(reward: DeepSWEReward | undefined): reward is Required<
  Pick<DeepSWEReward, 'reward' | 'f2p_total' | 'f2p_passed' | 'p2p_total' | 'p2p_passed'>
> & DeepSWEReward {
  return (
    typeof reward?.reward === 'number' &&
    isValidCount(reward.f2p_total) &&
    isValidCount(reward.f2p_passed) &&
    reward.f2p_passed <= reward.f2p_total &&
    isValidCount(reward.p2p_total) &&
    isValidCount(reward.p2p_passed) &&
    reward.p2p_passed <= reward.p2p_total
  );
}

export function synthesizeFlakeAwareVerdict(input: FlakeAwareVerdictInput): FlakeAwareVerdict {
  const preserveOriginal = (reason: string): FlakeAwareVerdict => ({
    passed: input.originalPassed,
    flakyTests: [],
    confirmedFailingTests: [],
    p2pRerunFailureDisjoint: false,
    originalVerdictRetained: true,
    reason,
  });

  if (input.originalPassed) return preserveOriginal('original verifier verdict already passed');
  if (input.firstRun.error) return preserveOriginal(`first verifier run failed: ${input.firstRun.error}`);
  if (input.firstRun.timedOut) return preserveOriginal('first verifier run timed out');
  if (input.firstRun.reward?.apply_failed) return preserveOriginal('model patch failed to apply in run 1');
  if (!validRewardCounts(input.firstRun.reward)) return preserveOriginal('run 1 did not produce a usable reward');

  const firstFailures = uniqueSorted(input.firstRun.failingP2PTests);
  const firstShortfall = input.firstRun.reward.p2p_total - input.firstRun.reward.p2p_passed;
  if (firstShortfall === 0) {
    return preserveOriginal('run 1 reward was zero with no p2p shortfall to confirm');
  }
  if (firstFailures.length !== firstShortfall) {
    return preserveOriginal(
      `run 1 p2p parser/count mismatch: reward shortfall=${String(firstShortfall)}, parsed=${String(firstFailures.length)}`,
    );
  }

  const rerun = input.rerun;
  if (!rerun) return preserveOriginal('flake re-run did not return a result');
  if (
    input.firstRun.verifierMode !== undefined &&
    rerun.verifierMode !== undefined &&
    input.firstRun.verifierMode !== rerun.verifierMode
  ) {
    return preserveOriginal('first run and flake re-run used different verifier environments');
  }
  if (rerun.error) return preserveOriginal(`flake re-run crashed: ${rerun.error}`);
  if (rerun.timedOut) return preserveOriginal('flake re-run timed out');
  if (rerun.reward?.apply_failed) return preserveOriginal('model patch failed to apply in the flake re-run');
  if (!validRewardCounts(rerun.reward)) return preserveOriginal('flake re-run did not produce a usable reward');

  const rerunFailures = uniqueSorted(rerun.failingP2PTests);
  if (rerun.reward.reward !== 1 && rerunFailures.length === 0) {
    return preserveOriginal('flake re-run failed without parseable p2p failure lines');
  }
  const rerunShortfall = rerun.reward.p2p_total - rerun.reward.p2p_passed;
  if (rerunFailures.length !== rerunShortfall) {
    return preserveOriginal(
      `re-run p2p parser/count mismatch: reward shortfall=${String(rerunShortfall)}, parsed=${String(rerunFailures.length)}`,
    );
  }
  if (
    input.firstRun.reward.f2p_total !== rerun.reward.f2p_total ||
    input.firstRun.reward.p2p_total !== rerun.reward.p2p_total
  ) {
    return preserveOriginal('first run and flake re-run reported different test totals');
  }
  if (
    input.firstRun.reward.f2p_total === 0 ||
    input.firstRun.reward.f2p_passed !== input.firstRun.reward.f2p_total ||
    rerun.reward.f2p_total === 0 ||
    rerun.reward.f2p_passed !== rerun.reward.f2p_total
  ) {
    return preserveOriginal('f2p was not complete in both verifier runs');
  }

  const firstSet = new Set(firstFailures);
  const rerunSet = new Set(rerunFailures);
  const confirmedFailingTests = firstFailures.filter((testId) => rerunSet.has(testId));
  const flakyTests = uniqueSorted([
    ...firstFailures.filter((testId) => !rerunSet.has(testId)),
    ...rerunFailures.filter((testId) => !firstSet.has(testId)),
  ]);
  const passed = confirmedFailingTests.length === 0;
  const p2pRerunFailureDisjoint = rerunFailures.length > 0 && confirmedFailingTests.length === 0;
  return {
    passed,
    flakyTests,
    confirmedFailingTests,
    p2pRerunFailureDisjoint,
    originalVerdictRetained: passed === input.originalPassed,
  };
}

// Per-task dependency/environment overrides. These cover test-only or
// environment-drift packages that are not declared in the project's own
// install metadata but are required for the DeepSWE verifier to pass.
const EXTRA_TASK_DEPS: Record<string, TaskEnvironmentOverride> = {
  'gql-incremental-graphql-delivery': {
    pip: [
      'graphql-core==3.3.0a7',
      'parse',
      'aiohttp<3.14',
      'websockets<16',
      'httpx<0.28',
      'requests',
      'aiofiles',
      'botocore',
      'pytest-asyncio',
    ],
  },
  'mobly-grouped-test-barriers': { pip: ['pytz'] },
  'dateutil-rfc5545-timezone-interop': { pip: ['pytest<8'] },
  'narwhals-rolling-window-suite': {
    pip: ['pyarrow>=23,<25'],
    dependencyReason:
      'Narwhals allows pyarrow>=13 with no lockfile, while PyArrow 25 emits a SortOptions FutureWarning that filterwarnings=error promotes to p2p failures.',
  },
  'anko-default-function-arguments': {
    knownP2PEnvironmentFailures: [
      {
        testId: 'github.com/mattn/anko/vm.Example_vmHttp',
        requiresBusyPort: 8080,
        reason:
          'The upstream example hard-codes TCP :8080; the local verifier shares the host network namespace, where an unrelated process can own that port.',
      },
    ],
  },
  'bandit-incremental-cache-control': { pip: ['GitPython', 'sarif-om', 'jschema_to_python'] },
  'bandit-structured-nosec-directives': { pip: ['setuptools', 'wheel', 'GitPython', 'sarif-om', 'jschema_to_python'] },
  'httpx-deterministic-cookie-store': {
    pip: ['pytest-xdist', 'chardet==5.2.0'],
  },
  'adaptix-name-mapping-aliases': { pip: ['attrs==22.2.0'] },
  'langchain-request-coalescing': {
    pip: [
      'blockbuster',
      'pytest-mock',
      'syrupy',
      'pytest-benchmark',
      'pytest-socket',
      'pytest-codspeed',
      'pytest-subtests',
      'pydantic',
      'freezegun',
      'langsmith',
      'jsonpatch',
      'pyyaml',
      'tenacity',
      'pytest-asyncio>=0.24',
    ],
  },
  'returns-validated-error-accumulation': {
    pip: ['anyio', 'pytest-asyncio', 'hypothesis', 'pytest-subtests'],
  },
  'fastapi-implicit-head-options': {
    pip: [
      'httpx<0.28',
      'inline-snapshot',
      'python-multipart',
      'orjson',
      'ujson',
      'sqlmodel',
      'flask',
      'pyjwt',
      'pwdlib[argon2]',
      'a2wsgi',
      'pyyaml',
      'dirty-equals',
      'pytest-sugar',
      'pytest-cov',
      'pytest-xdist',
      'pytest-timeout',
      'strawberry-graphql',
      'pydantic-settings',
      'uvicorn',
      'email-validator',
      'fastapi-cli',
      'trio',
    ],
  },
  'bandit-interprocedural-taint-checks': { pip: ['setuptools', 'wheel', 'GitPython', 'sarif-om', 'jschema_to_python'] },
  'sqlfmt-create-table-ddl-formatting': { pip: ['black'] },
  'python-statemachine-state-data-scoping': {
    pip: [
      'pytest-benchmark',
      'pytest-xdist',
      'pytest-timeout',
      'pytest-asyncio',
      'pytest-mock',
      'pytest-cov',
      'pytest-sugar',
      'pytest-django',
      'django',
      'docutils',
      'Sphinx',
      'pydot',
      'sphinx-gallery',
      'myst-parser',
    ],
  },
};

/** Every override entry, so tests can assert the table's SCOPE, not just its contents. */
export const ALL_TASK_ENVIRONMENT_OVERRIDES: readonly (readonly [string, TaskEnvironmentOverride])[] =
  Object.entries(EXTRA_TASK_DEPS);

export function getTaskEnvironmentOverride(taskName: string): TaskEnvironmentOverride | undefined {
  return EXTRA_TASK_DEPS[taskName];
}

/**
 * Is something listening on this port right now?
 *
 * Used to verify the asserted cause of a known-environment-failure exclusion
 * before honouring it. Connect-succeeds => occupied. Any error (refused,
 * timeout) => treated as free, which is the SAFE direction: the exclusion is
 * withheld and the test grades normally.
 */
export async function isPortBusy(port: number, host = '127.0.0.1'): Promise<boolean> {
  const { createConnection } = await import('node:net');
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host });
    const settle = (busy: boolean): void => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => { settle(true); });
    socket.once('timeout', () => { settle(false); });
    socket.once('error', () => { settle(false); });
  });
}

export function applyKnownEnvironmentFailures(
  taskName: string,
  config: Record<string, unknown>,
  /** Ports observed occupied right now. An exclusion that asserts a port
   *  collision applies only when its port is in here. */
  busyPorts: ReadonlySet<number> = new Set<number>()
): { config: Record<string, unknown>; applied: AppliedTaskEnvironmentOverride[] } {
  const failures = getTaskEnvironmentOverride(taskName)?.knownP2PEnvironmentFailures;
  const p2pNodeIds = config.p2p_node_ids;
  if (!failures || failures.length === 0 || !Array.isArray(p2pNodeIds)) {
    return { config, applied: [] };
  }

  const applied: AppliedTaskEnvironmentOverride[] = failures
    .filter((failure) => p2pNodeIds.includes(failure.testId))
    // An exclusion whose asserted cause does not hold is NOT applied: the
    // same failing test is then a real regression and must fail the task.
    .filter(
      (failure) =>
        failure.requiresBusyPort === undefined || busyPorts.has(failure.requiresBusyPort),
    )
    .map((failure) => ({
      kind: 'known-p2p-environment-failure',
      task: taskName,
      testId: failure.testId,
      reason: failure.reason,
    }));
  if (applied.length === 0) {
    return { config, applied };
  }

  const excludedIds = new Set(
    applied.map((override) =>
      override.kind === 'known-p2p-environment-failure' ? override.testId : ''
    )
  );
  return {
    config: {
      ...config,
      p2p_node_ids: p2pNodeIds.filter((nodeId) => typeof nodeId !== 'string' || !excludedIds.has(nodeId)),
      omega_known_environment_failures: [
        ...applied.map((override) => ({
          bucket: 'p2p',
          task: override.task,
          test_id: override.kind === 'known-p2p-environment-failure' ? override.testId : '',
          reason: override.reason,
          observed: 'asserted precondition verified at grading time',
        })),
      ],
    },
    applied,
  };
}

function formatAppliedEnvironmentOverride(override: AppliedTaskEnvironmentOverride): string {
  if (override.kind === 'dependency') {
    return `[environment override applied] task=${override.task} dependencies=${override.requirements.join(' ')} reason=${override.reason}`;
  }
  return `[environment override applied] task=${override.task} excluded_p2p=${override.testId} test_still_executed=true reason=${override.reason}`;
}

function parseToml(raw: string): DeepSWETaskToml {
  const result: DeepSWETaskToml = { task: {}, metadata: {} };
  let section: 'task' | 'metadata' | undefined;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      const name = trimmed.slice(1, -1).split('.')[0];
      if (name === 'task' || name === 'metadata') section = name;
      continue;
    }
    if (!section || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (section === 'task') {
      result.task ??= {};
      (result.task as Record<string, string>)[key] = value;
    } else {
      result.metadata ??= {};
      (result.metadata as Record<string, string>)[key] = value;
    }
  }
  return result;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function readTask(taskDir: string): Promise<{ toml: DeepSWETaskToml; instruction: string }> {
  const tomlRaw = await fs.readFile(path.join(taskDir, 'task.toml'), 'utf-8');
  const instructionRaw = await fs.readFile(path.join(taskDir, 'instruction.md'), 'utf-8');
  return { toml: parseToml(tomlRaw), instruction: instructionRaw };
}

// Per-language verification commands injected into the task description so the
// agent knows exactly how to compile and run the project's existing tests. The
// DeepSWE hidden fail-to-pass tests are applied by the verifier AFTER the agent
// finishes, so the agent can only implement from this spec; the build-gate below
// stops it shipping uncompilable code (the #1 cause of 0/0 results).
function languageGuidance(language: string | undefined): string {
  const lang = (language ?? '').toLowerCase();
  let cmds: string;
  if (lang === 'go') {
    cmds = `Language: Go.
- Build/compile check (run first, must exit 0): go build ./...
- Run existing tests: go test ./...
- Format: gofmt -w .`;
  } else if (lang === 'python') {
    cmds = `Language: Python.
- Use interpreter: python3.12 (DeepSWE tasks pin older native deps; python3.13+ often fails to build pydantic-core/msgspec/orjson wheels). If python3.12 is unavailable, fall back to python3.
- Install deps if missing: python3.12 -m venv .venv && source .venv/bin/activate && pip install -e .  (or: pip install -r requirements.txt)
- Run existing tests: python3.12 -m pytest -q  (uses .venv if present)
- If no pytest, fall back to: python3.12 -m unittest`;
  } else if (lang === 'rust') {
    cmds = `Language: Rust.
- Build/compile check (run first, must exit 0): cargo build
- Run existing tests: cargo test
- Format: cargo fmt`;
  } else if (lang === 'typescript' || lang === 'javascript') {
    cmds = `Language: ${lang[0].toUpperCase()}${lang.slice(1)}.
- Install deps if missing: npm install  (or: pnpm install)
- Typecheck: npx tsc --noEmit
- Run existing tests: npm test  (or: pnpm test)
- Lint: npm run lint  (or: pnpm lint)
- If deno.json or deno.jsonc exists, this is a Deno project: use deno cache to fetch deps and deno test to run tests; do NOT use npm/pnpm.`;
  } else {
    cmds = `Language: unknown. Detect the project's test/build command from package.json, go.mod, Cargo.toml, or pyproject.toml, then run it.`;
  }
  return cmds;
}

const BASELINE_SPEC_EXHORTATION = 'Implement precisely to the spec below - the hidden test suite checks exact behaviour (error message text, formatting, attribute names, signatures).';
const BUILD_GATE = `BUILD GATE (critical): the verifier scores you zero if the project does not compile or the existing test suite breaks. Before calling finish you MUST:
   1. Run the build/compile command above and confirm zero errors.
   2. Run the existing test command above and confirm the pre-existing tests still pass.
   3. If either fails, fix it before finishing. Do NOT finish while the build is broken.`;
const SCOPE_CONSTRAINT = 'SCOPE CONSTRAINT: Only edit source files directly related to the task. Do NOT modify CI/CD configs (.github/, .coderabbit.yaml, .codesandbox/), documentation (README.md, AUTHORS, CONTRIBUTING.md), meta files (.release-it.json, .prettierignore), build configs (package.json, rollup.config.js, webpack.config.js, tsconfig.json), or project scaffolding. Do NOT delete existing files. Do NOT create new files unless necessary for the implementation. Every extraneous change wastes steps and risks breaking the verifier.';
const DEEPSWE_VERIFICATION_START_FRACTION = 0.6;
const DISABLED_PROMPT_SWITCH_VALUES = new Set(['0', 'false', 'off', 'no']);

function promptExperimentEnabled(value: string | undefined): boolean {
  return !DISABLED_PROMPT_SWITCH_VALUES.has(value?.trim().toLowerCase() ?? '');
}

function formatWallClock(milliseconds: number): string {
  const totalMilliseconds = Math.max(0.001, milliseconds);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const remainingMilliseconds = totalMilliseconds % 1_000;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${String(hours)} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${String(minutes)} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0) parts.push(`${String(seconds)} second${seconds === 1 ? '' : 's'}`);
  if (remainingMilliseconds > 0) {
    const displayedMilliseconds = Math.round(remainingMilliseconds * 1_000) / 1_000;
    parts.push(`${String(displayedMilliseconds)} millisecond${displayedMilliseconds === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}

function timeBudgetGuidance(timeoutMs: number | undefined): string {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return '';
  const verifyAtMs = timeoutMs * DEEPSWE_VERIFICATION_START_FRACTION;
  const startPercent = Math.round(DEEPSWE_VERIFICATION_START_FRACTION * 100);
  const reservePercent = 100 - startPercent;
  return `TIME BUDGET: This agent attempt has an enforced total of ${formatWallClock(timeoutMs)}. Internal runs report both steps and wall-clock remaining in budget notices; external CLI runs receive their launch time and absolute UTC deadline.
Prioritisation: get the new behaviour working, then reserve time to run the existing suite and fix every regression you caused; a broken existing test scores zero no matter how good the feature is.
By ${String(startPercent)}% of the budget (${formatWallClock(verifyAtMs)} elapsed), stop exploring and start verifying. Reserve the final ${String(reservePercent)}% for regression fixes.`;
}

function legacyDeepSweDescription(guidance: string, cleanedInstruction: string): string {
  return `${guidance}

${BUILD_GATE}

${SCOPE_CONSTRAINT}

${BASELINE_SPEC_EXHORTATION}

---
${cleanedInstruction}`;
}

function buildDeepSweDescription(instruction: string, language: string | undefined, timeoutMs?: number): string {
  const guidance = languageGuidance(language);
  // Strip branch-management instructions that conflict with the harness's
  // isolated worktree branch; the agent must stay on its assigned branch.
  const cleanedInstruction = instruction
    .replace(/IMPORTANT:[\s\S]*?new branch from main[\s\S]*?(?=\n\n|\n*$)/gi, '')
    .replace(/work on this in a new branch from main[\s\S]*?(?=\n\n|\n*$)/gi, '')
    .trim();
  const specGateEnabled = promptExperimentEnabled(process.env.OMEGA_DEEPSWE_SPEC_GATE);
  const timeBudgetEnabled = promptExperimentEnabled(process.env.OMEGA_DEEPSWE_TIME_BUDGET);
  const budgetGuidance = timeBudgetEnabled ? timeBudgetGuidance(timeoutMs) : '';
  if (!specGateEnabled && !budgetGuidance) {
    return legacyDeepSweDescription(guidance, cleanedInstruction);
  }

  const specCheck = specGateEnabled
    ? 'EXACTNESS CHECK: Before editing, make a checklist of the public specification below. Verify exact string/message text with character-for-character equality (not substring matching) and output/file formats exactly; cover names, signatures, defaults, boundaries, and invalid inputs.'
    : BASELINE_SPEC_EXHORTATION;

  return `${guidance}

${BUILD_GATE}

${SCOPE_CONSTRAINT}

${budgetGuidance ? `${budgetGuidance}\n\n` : ''}${specCheck}

---
${cleanedInstruction}`;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-c', `command -v ${cmd}`], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface RetryWithBackoffOptions {
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  delayMs?: (failedAttempt: number) => number;
  shouldRetry?: (error: unknown, failedAttempt: number) => boolean;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function sleepWithAbort(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }
  const sleep = options.sleep ?? (async (milliseconds: number) => sleepWithAbort(milliseconds, options.signal));
  const delayMs = options.delayMs ?? ((failedAttempt: number) => 2_000 * (4 ** (failedAttempt - 1)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(options.signal);
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === maxAttempts || options.shouldRetry?.(error, attempt) === false) throw error;
      await sleep(Math.max(0, delayMs(attempt)));
      throwIfAborted(options.signal);
    }
  }

  throw new Error('retryWithBackoff exhausted without returning or throwing');
}

function stripRepoAliasSuffix(value: string): string {
  return value.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
}

export function normaliseRepoUrl(repoUrl: string): string {
  if (/^[A-Za-z]:[\\/]/.test(repoUrl)) return stripRepoAliasSuffix(repoUrl);
  try {
    const parsed = new URL(repoUrl);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = stripRepoAliasSuffix(parsed.pathname);
    return parsed.toString();
  } catch {
    const scpStyle = /^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/.exec(repoUrl);
    if (scpStyle) {
      const user = scpStyle[1] ? `${scpStyle[1]}@` : '';
      return `${user}${scpStyle[2].toLowerCase()}:${stripRepoAliasSuffix(scpStyle[3])}`;
    }
    return stripRepoAliasSuffix(repoUrl);
  }
}

function repoLabel(repoUrl: string): string {
  try {
    const parsed = new URL(repoUrl);
    return `${parsed.hostname}${parsed.port ? `-${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(repoUrl);
    if (scpStyle) return `${scpStyle[1]}-${scpStyle[2]}`;
    return path.basename(repoUrl.replace(/[\\/]+$/, ''));
  }
}

/** A stable, filesystem-safe name whose normalised full-URL hash prevents distinct URLs colliding. */
export function repoMirrorDirectoryName(repoUrl: string): string {
  const normalisedRepoUrl = normaliseRepoUrl(repoUrl);
  const readable = repoLabel(normalisedRepoUrl)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'repository';
  const digest = createHash('sha256').update(normalisedRepoUrl).digest('hex');
  return `repo-${readable}-${digest}.git`;
}

const mirrorOperations = new Map<string, Promise<unknown>>();
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const GIT_PROBE_TIMEOUT_MS = 60_000;
const DEFAULT_REPO_CACHE_MIN_FREE_GB = 15;
const DEFAULT_CLONE_DEADLINE_MS = 45 * 60_000;

class TerminalRepoCloneError extends Error {
  override name = 'TerminalRepoCloneError';
}

class RepoCloneDeadlineError extends Error {
  override name = 'RepoCloneDeadlineError';
}

class RepoCacheFreeSpaceFloorError extends Error {
  override name = 'RepoCacheFreeSpaceFloorError';
}

interface RepoCloneContext {
  signal: AbortSignal;
  deadlineAt: number;
  deadlineError: RepoCloneDeadlineError;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const commandError = error as Error & { stderr?: unknown; stdout?: unknown };
  const outputText = [commandError.stderr, commandError.stdout]
    .map((output) => (
      typeof output === 'string'
        ? output.trim()
        : Buffer.isBuffer(output)
          ? output.toString('utf-8').trim()
          : ''
    ))
    .filter((output) => output.length > 0 && !error.message.includes(output));
  return [error.message, ...outputText].join(': ');
}

export function isTerminalCheckoutFailure(
  error: unknown,
  source: 'mirror' | 'direct',
): boolean {
  const detail = errorDetail(error);
  if (source === 'direct') {
    return /(?:pathspec ['"].+['"] did not match|unknown revision or path not in the working tree)/i
      .test(detail);
  }
  return /(?:pathspec .* did not match|reference is not a tree|not a tree object|unable to read tree|unknown revision|invalid reference|bad revision|not a valid object name)/i
    .test(detail);
}

export function localCloneFailureShowsMirrorCorruption(error: unknown): boolean {
  const detail = errorDetail(error);
  const definitiveCorruptionEvidence = /(?:is corrupt|loose object|did not send all necessary objects|pack .* (?:invalid|corrupt)|object file .* is empty)/i;
  if (definitiveCorruptionEvidence.test(detail)) return true;

  // Git's generic read/checkout wording can accompany target-side resource
  // failures. Preserve A1 for those explicit target causes; otherwise either
  // shape is evidence that the mirror's object graph could not be checked out.
  const targetFailureEvidence = /(?:no space left|ENOSPC|permission denied|operation not permitted|EACCES|EPERM|ETIMEDOUT|timed out|timeout|read-only file system|could not create work tree dir)/i;
  const ambiguousCorruptionEvidence = /(?:unable to read|Clone succeeded, but checkout failed)/i;
  return ambiguousCorruptionEvidence.test(detail) && !targetFailureEvidence.test(detail);
}

function isTerminalRepoCloneError(error: unknown): error is TerminalRepoCloneError {
  return error instanceof TerminalRepoCloneError;
}

function readNonNegativeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return value;
  console.warn(`[deepswe] ignoring invalid ${name}=${raw}; using ${String(fallback)}`);
  return fallback;
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = readNonNegativeNumber(name, fallback);
  if (value > 0) return value;
  console.warn(`[deepswe] ignoring non-positive ${name}; using ${String(fallback)}`);
  return fallback;
}

async function execCloneGit(
  args: string[],
  timeoutMs: number,
  context: RepoCloneContext,
): Promise<{ stdout: string; stderr: string }> {
  throwIfAborted(context.signal);
  const remainingMs = context.deadlineAt - Date.now();
  if (remainingMs <= 0) throw context.deadlineError;
  return execFileAsync('git', args, {
    encoding: 'utf-8',
    timeout: Math.max(1, Math.min(timeoutMs, remainingMs)),
    maxBuffer: GIT_MAX_BUFFER,
    signal: context.signal,
  });
}

async function checkoutCloneCommit(
  targetPath: string,
  commit: string,
  source: 'mirror' | 'direct',
  context: RepoCloneContext,
): Promise<void> {
  try {
    await execCloneGit(['-C', targetPath, 'checkout', commit], 300_000, context);
  } catch (error) {
    if (isTerminalCheckoutFailure(error, source)) {
      throw new TerminalRepoCloneError(
        `DeepSWE repository checkout cannot resolve commit ${commit}: ${errorDetail(error)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function withMirrorLock<T>(mirrorPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = mirrorOperations.get(mirrorPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  mirrorOperations.set(mirrorPath, current);
  try {
    return await current;
  } finally {
    if (mirrorOperations.get(mirrorPath) === current) {
      mirrorOperations.delete(mirrorPath);
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

async function mirrorHasCommit(
  mirrorPath: string,
  commit: string,
  context: RepoCloneContext,
): Promise<boolean> {
  try {
    await execCloneGit(['-C', mirrorPath, 'cat-file', '-e', `${commit}^{commit}`], GIT_PROBE_TIMEOUT_MS, context);
    return true;
  } catch {
    throwIfAborted(context.signal);
    return false;
  }
}

async function mirrorHasTree(
  mirrorPath: string,
  commit: string,
  context: RepoCloneContext,
): Promise<boolean> {
  try {
    await execCloneGit(['-C', mirrorPath, 'cat-file', '-e', `${commit}^{tree}`], GIT_PROBE_TIMEOUT_MS, context);
    return true;
  } catch {
    throwIfAborted(context.signal);
    return false;
  }
}

async function ensureRepoCacheFreeSpace(
  cacheRoot: string,
  phase: 'create' | 'fetch',
  repoUrl: string,
  mirrorPath: string,
  context: RepoCloneContext,
): Promise<void> {
  const minimumFreeGb = readNonNegativeNumber(
    'OMEGA_DEEPSWE_REPO_CACHE_MIN_FREE_GB',
    DEFAULT_REPO_CACHE_MIN_FREE_GB,
  );
  if (typeof fs.statfs !== 'function') {
    console.warn(
      `[deepswe] repo cache free-space check unavailable; proceeding with mirror ` +
      `phase=${phase} repo=${repoUrl} mirror=${mirrorPath} reason=fs.statfs unavailable`,
    );
    return;
  }

  let fileSystem: Awaited<ReturnType<typeof fs.statfs>>;
  try {
    fileSystem = await fs.statfs(cacheRoot);
  } catch (error) {
    throwIfAborted(context.signal);
    console.warn(
      `[deepswe] repo cache free-space check unavailable; proceeding with mirror ` +
      `phase=${phase} repo=${repoUrl} mirror=${mirrorPath} reason=${errorDetail(error)}`,
    );
    return;
  }

  const freeGb = (fileSystem.bavail * fileSystem.bsize) / (1024 ** 3);
  if (freeGb >= minimumFreeGb) return;
  console.warn(
    `[deepswe] repo cache free-space floor stopped mirror; using direct fallback ` +
    `phase=${phase} repo=${repoUrl} mirror=${mirrorPath} ` +
    `free_gib=${freeGb.toFixed(2)} floor_gib=${String(minimumFreeGb)}`,
  );
  throw new RepoCacheFreeSpaceFloorError(
    `repo cache free-space floor stopped mirror ${phase}`,
  );
}

async function isBareGitRepository(mirrorPath: string, context: RepoCloneContext): Promise<boolean> {
  try {
    const { stdout } = await execCloneGit(
      ['-C', mirrorPath, 'rev-parse', '--is-bare-repository'],
      GIT_PROBE_TIMEOUT_MS,
      context,
    );
    return stdout.trim() === 'true';
  } catch {
    throwIfAborted(context.signal);
    return false;
  }
}

async function createBareMirror(
  repoUrl: string,
  cacheRoot: string,
  mirrorPath: string,
  attemptStats: RepoCloneAttemptStats,
  context: RepoCloneContext,
): Promise<void> {
  let completedTempPath: string | undefined;
  await retryWithBackoff(async (attempt) => {
    attemptStats.mirrorClone = attempt;
    const tempPath = await fs.mkdtemp(path.join(cacheRoot, '.mirror-tmp-'));
    try {
      await execCloneGit(['clone', '--bare', repoUrl, tempPath], 600_000, context);
      completedTempPath = tempPath;
    } catch (error) {
      await fs.rm(tempPath, { recursive: true, force: true });
      throw error;
    }
  }, {
    signal: context.signal,
    shouldRetry: (error) => !isTerminalRepoCloneError(error),
  });

  if (!completedTempPath) {
    throw new Error('Bare mirror clone completed without a temporary directory');
  }

  try {
    await fs.rename(completedTempPath, mirrorPath);
    completedTempPath = undefined;
  } catch (error) {
    // Another process may have won the same atomic publish race. Its complete
    // mirror is safe to use; any other rename failure falls back to direct.
    const code = (error as NodeJS.ErrnoException).code;
    const destinationCollision =
      code === 'EEXIST' ||
      code === 'ENOTEMPTY' ||
      code === 'EISDIR' ||
      (process.platform === 'win32' && code === 'EPERM');
    if (!destinationCollision || !(await isBareGitRepository(mirrorPath, context))) throw error;
  } finally {
    if (completedTempPath) {
      await fs.rm(completedTempPath, { recursive: true, force: true });
    }
  }
}

interface MirrorCheckoutResult {
  source: 'cache' | 'fresh-mirror';
}

interface RepoCloneAttemptStats {
  mirrorClone: number;
  mirrorFetch: number;
  localClone: number;
  directClone: number;
}

interface MirrorIdentity {
  dev: number;
  ino: number;
}

function formatRepoCloneAttempts(attempts: RepoCloneAttemptStats): string {
  const parts = [
    attempts.mirrorClone > 0 ? `mirror-clone:${String(attempts.mirrorClone)}` : undefined,
    attempts.mirrorFetch > 0 ? `mirror-fetch:${String(attempts.mirrorFetch)}` : undefined,
    attempts.localClone > 0 ? `local-clone:${String(attempts.localClone)}` : undefined,
    attempts.directClone > 0 ? `direct-clone:${String(attempts.directClone)}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(',') || 'none';
}

async function discardSuspectMirror(
  mirrorPath: string,
  expectedIdentity: MirrorIdentity,
): Promise<void> {
  const quarantinePath = `${mirrorPath}.suspect-${String(process.pid)}-${String(Date.now())}`;
  try {
    await fs.rename(mirrorPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const quarantinedIdentity = await fs.lstat(quarantinePath).catch(() => undefined);
  const quarantinedGenerationMatches =
    quarantinedIdentity?.dev === expectedIdentity.dev &&
    quarantinedIdentity.ino === expectedIdentity.ino;
  if (!quarantinedGenerationMatches) {
    // Another process replaced the failed generation before our atomic
    // quarantine. Restore that newer mirror when possible and never delete it.
    await fs.rename(quarantinePath, mirrorPath).catch(() => {
      console.warn(`[deepswe] preserved newer repo mirror at ${quarantinePath} after invalidation race`);
    });
    return;
  }
  await fs.rm(quarantinePath, { recursive: true, force: true });
}

async function cloneFromMirror(
  repoUrl: string,
  commit: string,
  targetPath: string,
  cacheRoot: string,
  mirrorPath: string,
  attemptStats: RepoCloneAttemptStats,
  context: RepoCloneContext,
): Promise<MirrorCheckoutResult> {
  return withMirrorLock(mirrorPath, async () => {
    throwIfAborted(context.signal);
    await fs.mkdir(cacheRoot, { recursive: true });
    let source: MirrorCheckoutResult['source'] = 'cache';

    if (await pathExists(mirrorPath)) {
      const mirrorIdentity = await fs.lstat(mirrorPath).then(
        (stat): MirrorIdentity => ({ dev: stat.dev, ino: stat.ino }),
      );
      if (!(await isBareGitRepository(mirrorPath, context))) {
        console.warn(
          `[deepswe] repo mirror is non-bare; quarantining and rebuilding repo=${repoUrl} mirror=${mirrorPath}`,
        );
        await discardSuspectMirror(mirrorPath, mirrorIdentity);
        if (
          await pathExists(mirrorPath) &&
          !(await isBareGitRepository(mirrorPath, context))
        ) {
          throw new Error(`replacement repo mirror is also non-bare: ${mirrorPath}`);
        }
      }
    }

    if (!(await pathExists(mirrorPath))) {
      await ensureRepoCacheFreeSpace(cacheRoot, 'create', repoUrl, mirrorPath, context);
      await createBareMirror(repoUrl, cacheRoot, mirrorPath, attemptStats, context);
      source = 'fresh-mirror';
    }

    if (!(await mirrorHasCommit(mirrorPath, commit, context))) {
      await ensureRepoCacheFreeSpace(cacheRoot, 'fetch', repoUrl, mirrorPath, context);
      await retryWithBackoff(async (attempt) => {
        attemptStats.mirrorFetch = attempt;
        await execCloneGit(
          ['-C', mirrorPath, 'fetch', '--prune', 'origin', '+refs/heads/*:refs/heads/*', '--tags'],
          300_000,
          context,
        );
      }, { signal: context.signal });
      if (!(await mirrorHasCommit(mirrorPath, commit, context))) {
        throw new TerminalRepoCloneError(
          `DeepSWE repository mirror does not contain requested commit ${commit} after fetch`,
        );
      }
    }

    const mirrorIdentity = await fs.lstat(mirrorPath).then(
      (stat): MirrorIdentity => ({ dev: stat.dev, ino: stat.ino }),
    );
    attemptStats.localClone = 1;
    try {
      await execCloneGit(['clone', mirrorPath, targetPath], 300_000, context);
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true });
      const corruptionEvidence = localCloneFailureShowsMirrorCorruption(error);
      const mirrorIsBare = await isBareGitRepository(mirrorPath, context);
      const mirrorContainsCommit = mirrorIsBare && await mirrorHasCommit(mirrorPath, commit, context);
      const mirrorContainsTree = mirrorContainsCommit && await mirrorHasTree(mirrorPath, commit, context);
      if (!corruptionEvidence && mirrorIsBare && mirrorContainsCommit && mirrorContainsTree) {
        console.warn(
          `[deepswe] local mirror clone failed but mirror probes are healthy; retaining mirror ` +
          `repo=${repoUrl} mirror=${mirrorPath} reason=${errorDetail(error)}`,
        );
      } else {
        console.warn(
          `[deepswe] local mirror clone failed and mirror probe failed; invalidating mirror ` +
          `repo=${repoUrl} mirror=${mirrorPath} bare=${String(mirrorIsBare)} ` +
          `hasCommit=${String(mirrorContainsCommit)} hasTree=${String(mirrorContainsTree)} ` +
          `corruptionEvidence=${String(corruptionEvidence)} reason=${errorDetail(error)}`,
        );
        await discardSuspectMirror(mirrorPath, mirrorIdentity);
      }
      throw error;
    }

    try {
      await checkoutCloneCommit(targetPath, commit, 'mirror', context);
      await execCloneGit(['-C', targetPath, 'remote', 'set-url', 'origin', repoUrl], 60_000, context);
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true });
      throw error;
    }

    return { source };
  });
}

async function directClone(
  repoUrl: string,
  commit: string,
  targetPath: string,
  onAttempt: (attempt: number) => void,
  context: RepoCloneContext,
): Promise<void> {
  try {
    await retryWithBackoff(async (attempt) => {
      onAttempt(attempt);
      await fs.rm(targetPath, { recursive: true, force: true });
      await execCloneGit(['clone', '--filter=blob:none', repoUrl, targetPath], 600_000, context);
      // A blobless checkout can hydrate promised objects from upstream, so on
      // this direct path clone + checkout form one retryable network attempt.
      await checkoutCloneCommit(targetPath, commit, 'direct', context);
    }, {
      signal: context.signal,
      shouldRetry: (error) => !isTerminalRepoCloneError(error),
    });
  } catch (error) {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function cloneRepoBeforeDeadline(
  repoUrl: string,
  commit: string,
  targetPath: string,
  context: RepoCloneContext,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  throwIfAborted(context.signal);
  // Ensure a clean clone so leftover state from previous runs cannot pollute
  // the worktree or branch list.
  await fs.rm(targetPath, { recursive: true, force: true });
  throwIfAborted(context.signal);
  const attemptStats: RepoCloneAttemptStats = {
    mirrorClone: 0,
    mirrorFetch: 0,
    localClone: 0,
    directClone: 0,
  };

  if (process.env.OMEGA_DEEPSWE_DISABLE_REPO_CACHE !== '1') {
    const cacheRoot = process.env.OMEGA_DEEPSWE_REPO_CACHE_DIR ?? path.join(omegaWorkDir(), 'deepswe-repo-cache');
    const mirrorPath = path.join(cacheRoot, repoMirrorDirectoryName(repoUrl));
    try {
      const result = await cloneFromMirror(
        repoUrl,
        commit,
        targetPath,
        cacheRoot,
        mirrorPath,
        attemptStats,
        context,
      );
      console.log(
        `[deepswe] repo checkout source=${result.source} attempts=${formatRepoCloneAttempts(attemptStats)}`,
      );
      return;
    } catch (error) {
      if (isTerminalRepoCloneError(error)) throw error;
      throwIfAborted(context.signal);
      // The cache is strictly an optimisation. Any cache error—including a
      // suspect local clone—must retain the direct network path below.
      if (!(error instanceof RepoCacheFreeSpaceFloorError)) {
        console.warn(
          `[deepswe] repo cache unavailable; using direct fallback repo=${repoUrl} ` +
          `mirror=${mirrorPath} reason=${errorDetail(error)}`,
        );
      }
    }
  }

  try {
    await directClone(
      repoUrl,
      commit,
      targetPath,
      (attempt) => { attemptStats.directClone = attempt; },
      context,
    );
    console.log(
      `[deepswe] repo checkout source=direct-fallback attempts=${formatRepoCloneAttempts(attemptStats)}`,
    );
  } catch (error) {
    console.log(
      `[deepswe] repo checkout source=direct-fallback ` +
      `attempts=${formatRepoCloneAttempts(attemptStats)} failed=true`,
    );
    throwIfAborted(context.signal);
    throw error;
  }
}

export async function cloneRepo(repoUrl: string, commit: string, targetPath: string): Promise<void> {
  const deadlineMs = readPositiveNumber(
    'OMEGA_DEEPSWE_CLONE_DEADLINE_MS',
    DEFAULT_CLONE_DEADLINE_MS,
  );
  const controller = new AbortController();
  const deadlineError = new RepoCloneDeadlineError(
    `DeepSWE repository clone deadline exceeded after ${String(deadlineMs)}ms for ${repoUrl}`,
  );
  const timer = setTimeout(() => { controller.abort(deadlineError); }, deadlineMs);
  const context: RepoCloneContext = {
    signal: controller.signal,
    deadlineAt: Date.now() + deadlineMs,
    deadlineError,
  };
  try {
    await raceWithAbort(cloneRepoBeforeDeadline(repoUrl, commit, targetPath, context), controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function findNodePackageDir(projectPath: string): Promise<string | undefined> {
  if (await fs.access(path.join(projectPath, 'package.json')).then(() => true, () => false)) {
    return projectPath;
  }
  const entries = await fs.readdir(projectPath, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectPath, entry.name, 'package.json');
    if (await fs.access(candidate).then(() => true, () => false)) {
      return path.dirname(candidate);
    }
  }
  return undefined;
}

async function findPnpmWorkspaceRoot(projectPath: string): Promise<string | undefined> {
  let current = path.resolve(projectPath);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (await fs.access(path.join(current, 'pnpm-workspace.yaml')).then(() => true, () => false)) {
      return current;
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return undefined;
}

async function ensureGitignoreLines(projectPath: string, lines: string[]): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // no .gitignore yet
  }
  const existing = new Set(content.split(/\r?\n/));
  const missing = lines.filter((l) => !existing.has(l));
  if (missing.length === 0) return;
  const prefix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  await fs.writeFile(gitignorePath, `${content}${prefix}${missing.join('\n')}\n`, 'utf-8');
}

async function readPytestAddopts(projectPath: string): Promise<string> {
  const fragments: string[] = [];
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  try {
    const raw = await fs.readFile(pyprojectPath, 'utf-8');
    const sectionMatch = /\[tool\.pytest\.ini_options\]([^[]*)/s.exec(raw);
    if (sectionMatch) {
      fragments.push(sectionMatch[1]);
    }
  } catch {
    // ignore missing pyproject.toml
  }
  const setupCfgPath = path.join(projectPath, 'setup.cfg');
  try {
    const raw = await fs.readFile(setupCfgPath, 'utf-8');
    const sectionMatch = /\[tool:pytest\]([^[]*)/s.exec(raw);
    if (sectionMatch) {
      fragments.push(sectionMatch[1]);
    }
  } catch {
    // ignore missing setup.cfg
  }
  return fragments.join('\n');
}

async function installProjectDependencies(
  projectPath: string,
  language?: string,
  taskDir?: string,
  taskName?: string
): Promise<void> {
  const has = (f: string) => fs.access(path.join(projectPath, f)).then(() => true, () => false);
  const lang = (language ?? '').toLowerCase();

  // Pure Deno projects do not need a Node package install, but the verifier
  // runs `deno test --cached-only`, so all test-time imports must be
  // pre-fetched into the local Deno cache. Mixed projects (e.g. optique) have
  // both deno.json and a Node lockfile; those still need the Node install.
  const hasDenoConfig = (await has('deno.json')) || (await has('deno.jsonc'));
  const hasNodePackage =
    (await has('package.json')) || (await has('pnpm-lock.yaml')) || (await has('package-lock.json')) || (await has('yarn.lock'));
  if (hasDenoConfig && !hasNodePackage) {
    console.log('[deepswe] Deno project detected, caching dependencies');
    const denoBinDir = await ensureDeno();
    const denoEnv: NodeJS.ProcessEnv = { ...process.env };
    if (denoBinDir) {
      denoEnv.PATH = `${denoBinDir}${path.delimiter}${denoEnv.PATH ?? ''}`;
    }
    const denoCmd = denoBinDir ? path.join(denoBinDir, 'deno') : 'deno';
    // `deno test --no-run --no-check` caches every test module and its JSR/npm
    // dependencies without executing the tests or failing on type errors.
    // Deps are written to the shared DENO_DIR, so the agent worktree and the
    // verifier reuse them.
    const cache = await runCommand(denoCmd, ['test', '--no-run', '--no-check'], { cwd: projectPath, env: denoEnv, timeout: 300_000 });
    if (cache.exitCode !== 0) {
      console.warn(`[deepswe] deno dependency cache incomplete (continuing): ${cache.stderr.slice(-500)}`);
    }
    return;
  }

  const nodePackageDir = await findNodePackageDir(projectPath);
  if (nodePackageDir) {
    // pnpm workspaces keep the lockfile at the workspace root; installing from
    // a sub-package fails when dependencies use workspace/catalog protocols.
    const workspaceRoot = await findPnpmWorkspaceRoot(nodePackageDir);
    const installDir = workspaceRoot ?? nodePackageDir;
    const nodeHas = (f: string) => fs.access(path.join(installDir, f)).then(() => true, () => false);
    const lock = (await nodeHas('pnpm-lock.yaml')) ? 'pnpm-lock.yaml' :
                 (await nodeHas('yarn.lock')) ? 'yarn.lock' :
                 (await nodeHas('package-lock.json')) ? 'package-lock.json' : undefined;
    let packageManager = '';
    try {
      const pkgRaw = await fs.readFile(path.join(installDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
      packageManager = pkg.packageManager ?? '';
    } catch {
      // ignore unreadable package.json
    }
    const useCorepackYarn = lock === 'yarn.lock' && /^yarn@[2-9]/.test(packageManager) && (await commandExists('corepack'));
    // Corepack's default pnpm (11.x) requires Node >= 22.13; pin a compatible
    // version for pnpm projects on this host.
    const useCorepackPnpm = lock === 'pnpm-lock.yaml' && (await commandExists('corepack'));
    const cmd = useCorepackPnpm ? ['corepack', 'pnpm@10.18.0', 'install'] :
                useCorepackYarn ? ['corepack', 'yarn', 'install'] :
                lock === 'yarn.lock' && (await commandExists('yarn')) ? ['yarn', 'install'] :
                lock === 'package-lock.json' ? ['npm', 'ci'] :
                ['npm', 'install'];
    const ensureNodeBinaries = async (): Promise<boolean> => {
      try {
        const pkgRaw = await fs.readFile(path.join(installDir, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
        const testScript = pkg.scripts?.test ?? '';
        const binDir = path.join(installDir, 'node_modules', '.bin');
        const bins = await fs.readdir(binDir).catch(() => [] as string[]);
        const needs = (name: string) => testScript.includes(name) && !bins.includes(name);
        return !needs('mocha') && !needs('jest') && !needs('vitest') && !needs('tap') && !needs('ava');
      } catch {
        return true;
      }
    };
    const runInstall = async (args: string[]): Promise<void> => {
      const install = await runCommand('npm', args, { cwd: installDir, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`Dependency install failed: ${install.stderr}\n${install.stdout}`);
      }
    };
    if (cmd[0] === 'npm' && cmd[1] === 'ci') {
      const install = await runCommand('npm', ['ci'], { cwd: installDir, timeout: 300_000 });
      if (install.exitCode !== 0) {
        if (install.stderr.includes('EBADENGINE') || install.stdout.includes('EBADENGINE')) {
          console.warn('[deepswe] npm ci failed with engine mismatch, falling back to npm install --no-engine-strict');
          await runInstall(['install', '--no-engine-strict']);
        } else {
          throw new Error(`npm ci failed: ${install.stderr}\n${install.stdout}`);
        }
      }
    } else {
      await runCommand(cmd[0], cmd.slice(1), { cwd: installDir, timeout: 300_000 }).then((r) => {
        if (r.exitCode !== 0) {
          throw new Error(`Dependency install failed (${cmd.join(' ')}): ${r.stderr}\n${r.stdout}`);
        }
      });
    }
    if (!(await ensureNodeBinaries())) {
      console.warn('[deepswe] node_modules missing test binaries, reinstalling');
      await fs.rm(path.join(installDir, 'node_modules'), { recursive: true, force: true });
      if (cmd[0] === 'npm' && cmd[1] === 'ci') {
        await runInstall(['install', '--no-engine-strict']);
      } else {
        await runCommand(cmd[0], cmd.slice(1), { cwd: installDir, timeout: 300_000 }).then((r) => {
          if (r.exitCode !== 0) {
            throw new Error(`Dependency install failed (${cmd.join(' ')}): ${r.stderr}\n${r.stdout}`);
          }
        });
      }
    }
    return;
  }

  if (lang === 'go' && (await has('go.mod'))) {
    const install = await runCommand('go', ['mod', 'download'], { cwd: projectPath, timeout: 180_000 });
    if (install.exitCode !== 0) {
      throw new Error(`go mod download failed: ${install.stderr}\n${install.stdout}`);
    }
    return;
  }

  // Some task snapshots mislabel the language in their toml (e.g. the httpx
  // cookie-store task is a Python project declared as "typescript"). Detect
  // Python from the repo layout so a venv (and the `python` symlink) is still
  // provisioned; otherwise bare `python` calls in the verifier's test.sh fail
  // with "python: command not found" and the task scores a false zero.
  const isPythonProject =
    lang === 'python' ||
    (await has('pyproject.toml')) ||
    (await has('setup.py')) ||
    (await has('requirements.txt'));
  if (isPythonProject) {
    if (lang !== 'python') {
      console.log(`[deepswe] Python project detected via repo layout (declared lang: ${lang || 'none'})`);
    }
    // DeepSWE Python tasks target a range of interpreters. Older task snapshots
    // pin native deps (pydantic-core, msgspec, orjson) that do not build on
    // python3.13+ (internal C API changes / PyO3 version ceilings). Prefer 3.12
    // first, then fall back through older and newer interpreters.
    const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3', 'python3.13', 'python3.14'];
    const errors: string[] = [];

    for (const pythonBin of candidates) {
      if (!(await commandExists(pythonBin))) continue;
      const venvPath = path.join(projectPath, '.venv');
      await fs.rm(venvPath, { recursive: true, force: true });
      const pipBin = path.join(venvPath, 'bin', 'pip');
      const venv = await runCommand(pythonBin, ['-m', 'venv', '.venv'], { cwd: projectPath, timeout: 120_000 });
      if (venv.exitCode !== 0) {
        errors.push(`${pythonBin} venv: ${venv.stderr}`);
        continue;
      }

      // Many DeepSWE test.sh scripts call `python` (not `python3`), and the
      // venv only creates `python3` on macOS. Create a `python` symlink so
      // those verifiers resolve instead of failing with "python: command
      // not found" (e.g. httpx-deterministic-cookie-store).
      const venvBin = path.join(venvPath, 'bin');
      const hasVenvPython = await fs.access(path.join(venvBin, 'python')).then(() => true, () => false);
      if (!hasVenvPython) {
        const hasPy3 = await fs.access(path.join(venvBin, 'python3')).then(() => true, () => false);
        await runCommand('ln', ['-sf', hasPy3 ? 'python3' : 'python', path.join(venvBin, 'python')], { cwd: projectPath, timeout: 10_000 });
      }

      const fail = (stage: string, stderr: string): boolean => {
        errors.push(`${pythonBin} ${stage}: ${stderr}`);
        return true;
      };
      let failed = false;

      if (await has('pyproject.toml') || await has('setup.py')) {
        // Ensure a modern pip that supports PEP 660 editable installs for
        // pyproject-only projects (poetry/hatchling/flit backends).
        await runCommand(pipBin, ['install', '--upgrade', 'pip'], { cwd: projectPath, timeout: 120_000 });
        const install = await runCommand(pipBin, ['install', '-e', '.'], { cwd: projectPath, timeout: 300_000 });
        if (install.exitCode !== 0) {
          // Older pip or non-setuptools pyproject backends: fall back to a
          // regular install so the package is importable during verification.
          const fallback = await runCommand(pipBin, ['install', '.'], { cwd: projectPath, timeout: 300_000 });
          if (fallback.exitCode !== 0) failed = fail('pip install -e .', install.stderr);
        }
      }
      // Projects often keep their dev/test dependencies in requirements.txt
      // while pyproject.toml only declares the runtime package (httpx pins
      // trio/trustme/uvicorn there). Without it, pytest configs referencing
      // those modules (e.g. a trio filterwarnings rule) abort collection and
      // the task scores a false zero. Install it whenever present.
      if (await has('requirements.txt')) {
        const install = await runCommand(pipBin, ['install', '-r', 'requirements.txt'], { cwd: projectPath, timeout: 300_000 });
        if (install.exitCode !== 0) failed = fail('pip install -r requirements.txt', install.stderr);
      }

      if (!failed) {
        // The DeepSWE verifier reuses this base repo .venv to run hidden tests.
        // Install any declared dev/test requirements and PEP 735 dependency groups.
        const reqFiles: string[] = [];
        const rootCandidates = ['requirements-dev.txt', 'requirements_test.txt', 'requirements-test.txt', 'dev-requirements.txt', 'test-requirements.txt'];
        for (const reqFile of rootCandidates) {
          if (await has(reqFile)) reqFiles.push(reqFile);
        }
        const requirementsDir = path.join(projectPath, 'requirements');
        try {
          const reqEntries = await fs.readdir(requirementsDir);
          for (const entry of reqEntries) {
            if (entry.endsWith('.txt')) reqFiles.push(path.join('requirements', entry));
            if (entry === 'extras') {
              const extrasDir = path.join(requirementsDir, 'extras');
              const extraEntries = await fs.readdir(extrasDir);
              for (const extra of extraEntries) {
                if (extra.endsWith('.txt')) reqFiles.push(path.join('requirements', 'extras', extra));
              }
            }
          }
        } catch {
          // no requirements directory
        }
        for (const reqFile of reqFiles) {
          const install = await runCommand(pipBin, ['install', '-r', reqFile], { cwd: projectPath, timeout: 300_000 });
          if (install.exitCode !== 0) {
            // Optional extras can be incompatible with the current interpreter.
            // If a native wheel build failed for a known pinned dep, treat this
            // interpreter as unsuitable so we retry with an older one.
            const stderr = install.stderr;
            console.warn(`[deepswe] optional requirements install failed for ${reqFile} with ${pythonBin}: ${stderr}`);
            if (/Failed (?:building wheel|to build).*\b(?:pydantic-core|msgspec|orjson)\b/is.test(stderr)) {
              failed = fail(`native wheel build in ${reqFile}`, stderr);
            }
          }
        }
        for (const group of ['dev', 'test', 'tests']) {
          const install = await runCommand(pipBin, ['install', '--group', group], { cwd: projectPath, timeout: 300_000 });
          if (install.exitCode !== 0) {
            // dependency group may not exist; that's fine.
          }
        }
        const pytestCheck = await runCommand(pipBin, ['show', 'pytest'], { cwd: projectPath, timeout: 30_000 });
        if (pytestCheck.exitCode !== 0) {
          const install = await runCommand(pipBin, ['install', 'pytest'], { cwd: projectPath, timeout: 300_000 });
          if (install.exitCode !== 0) failed = fail('pytest install', install.stderr);
        }
      }

      if (!failed) {
        // DeepSWE verifiers often use pytest-xdist (-n), pytest-timeout, pytest-asyncio,
        // pytest-benchmark, pytest-django, and pytest-mock.
        const testShPaths = [
          path.join(taskDir ?? '', 'tests', 'test.sh'),
          path.join(taskDir ?? '', 'test.sh'),
          path.join(projectPath, 'test.sh'),
        ];
        let testShText = '';
        for (const testShPath of testShPaths) {
          try {
            testShText += await fs.readFile(testShPath, 'utf-8');
          } catch {
            // ignore missing test.sh
          }
        }
        // Project pytest config (e.g. pyproject.toml addopts) may reference plugins
        // that the verifier needs but that are not listed in test.sh.
        testShText += await readPytestAddopts(projectPath);
        const pytestExtras: string[] = [];
        if (/pytest.*-n\b/.test(testShText) || /\bxdist\b/.test(testShText)) pytestExtras.push('pytest-xdist');
        if (/--timeout[ =]/.test(testShText) || /\bpytest-timeout\b/.test(testShText)) pytestExtras.push('pytest-timeout');
        if (testShText.includes('pytest-asyncio') || /\basyncio\b/.test(testShText)) pytestExtras.push('pytest-asyncio');
        if (testShText.includes('pytest-benchmark') || testShText.includes('--benchmark')) pytestExtras.push('pytest-benchmark');
        if (testShText.includes('pytest-django') || /\bdjango\b/.test(testShText)) pytestExtras.push('pytest-django');
        if (testShText.includes('pytest-mock') || /\bpytest-mock\b/.test(testShText)) pytestExtras.push('pytest-mock');
        if (testShText.includes('pytest-cov') || /\bcov\b/.test(testShText)) pytestExtras.push('pytest-cov');
        if (testShText.includes('pytest-sugar') || /\bsugar\b/.test(testShText)) pytestExtras.push('pytest-sugar');
        if (testShText.includes('pytest-rerunfailures') || /\brerunfailures\b/.test(testShText)) pytestExtras.push('pytest-rerunfailures');
        if (testShText.includes('pytest-check-links') || /\bcheck-links\b/.test(testShText)) pytestExtras.push('pytest-check-links');
        if (testShText.includes('--snapshot-warn-unused') || /\bsnapshot-warn-unused\b/.test(testShText)) pytestExtras.push('syrupy');
        if (testShText.includes('pytest-socket') || /\bpytest-socket\b/.test(testShText)) pytestExtras.push('pytest-socket');
        if (testShText.includes('pytest-codspeed') || /\bpytest-codspeed\b/.test(testShText)) pytestExtras.push('pytest-codspeed');
        if (testShText.includes('pytest-subtests') || /\bpytest-subtests\b/.test(testShText)) pytestExtras.push('pytest-subtests');
        if (/\bstestr\b/.test(testShText)) pytestExtras.push('stestr', 'subunit', 'junitxml');
        if (pytestExtras.length > 0) {
          const install = await runCommand(pipBin, ['install', ...pytestExtras], { cwd: projectPath, timeout: 300_000 });
          if (install.exitCode !== 0) failed = fail('pytest extras install', install.stderr);
        }
      }

      const extraDeps = taskName ? getTaskEnvironmentOverride(taskName) : undefined;
      if (!failed && extraDeps?.pip) {
        const extras = extraDeps.pip;
        console.log(`[deepswe] Installing extra deps for ${String(taskName)}: ${extras.join(' ')}`);
        const install = await runCommand(pipBin, ['install', ...extras], { cwd: projectPath, timeout: 300_000 });
        if (install.exitCode !== 0) {
          // Treat as fatal: the verifier is known to need these packages.
          failed = fail('extra task deps install', install.stderr);
        }
      }

      if (!failed) {
        // dateutil's test suite needs the bundled timezone database; the
        // verifier runs offline so the data tarball must be built during setup.
        if (taskName === 'dateutil-rfc5545-timezone-interop' && (await fs.access(path.join(projectPath, 'updatezinfo.py')).then(() => true, () => false))) {
          console.log('[deepswe] Rebuilding dateutil zoneinfo database');
          const update = await runCommand(path.join(venvPath, 'bin', 'python'), ['updatezinfo.py'], { cwd: projectPath, timeout: 300_000 });
          if (update.exitCode !== 0) {
            console.warn(`[deepswe] dateutil zoneinfo rebuild failed: ${update.stderr}`);
          }
        }
        // Make sure the venv and node_modules are never committed by the bench
        // init commit; otherwise the verifier's git checkout strips them out.
        await ensureGitignoreLines(projectPath, ['.venv/', 'node_modules/']);
        console.log(`[deepswe] Python venv ready with ${pythonBin}`);
        return;
      }
    }

    throw new Error(`Failed to create usable Python venv with any interpreter:\n${errors.join('\n---\n')}`);
  }

  if (lang === 'rust' && (await has('Cargo.toml'))) {
    const install = await runCommand('cargo', ['fetch'], { cwd: projectPath, timeout: 300_000 });
    if (install.exitCode !== 0) {
      throw new Error(`cargo fetch failed: ${install.stderr}\n${install.stdout}`);
    }
    // Some Rust workspaces (e.g. pest) require a bootstrap binary to be built
    // before the main crates can compile their build scripts.
    if (await has('bootstrap/Cargo.toml')) {
      const bootstrap = await runCommand('cargo', ['build', '--package', 'pest_bootstrap'], {
        cwd: projectPath,
        timeout: 300_000,
      });
      if (bootstrap.exitCode !== 0) {
        throw new Error(`cargo bootstrap build failed: ${bootstrap.stderr}\n${bootstrap.stdout}`);
      }
    }
  }
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function generateModelPatch(projectPath: string, baseCommit: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', projectPath, 'diff', '--binary', baseCommit, 'HEAD'], {
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

function normalisePatch(patch: string): string {
  if (patch.length === 0) return patch;
  // git apply expects the patch file itself to end with a newline.
  return patch.endsWith('\n') ? patch : `${patch}\n`;
}

function parseGitNumstatDestinationPaths(output: string): string[] {
  const fields = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < fields.length;) {
    const header = fields[index++];
    if (!header) continue;
    const firstTab = header.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : header.indexOf('\t', firstTab + 1);
    if (secondTab < 0) continue;
    const inlinePath = header.slice(secondTab + 1);
    if (inlinePath) {
      paths.push(inlinePath);
      continue;
    }
    // With -z, rename/copy entries put the old and new paths in the next two
    // NUL-delimited fields. Only the destination can block reapplication.
    index += 1;
    const destination = fields[index++];
    if (destination) paths.push(destination);
  }
  return [...new Set(paths)];
}

async function hasSymlinkParent(projectPath: string, relativePath: string): Promise<boolean> {
  const parentParts = path.dirname(relativePath).split(path.sep).filter((part) => part && part !== '.');
  let current = projectPath;
  for (const part of parentParts) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return true;
    } catch {
      // A missing parent means the destination itself cannot currently exist.
      return false;
    }
  }
  return false;
}

/**
 * Remove only model-patch destinations that have no preimage at base.
 * `git checkout -f` resets tracked files but leaves additions from a previous
 * verifier invocation untracked; those additions otherwise make the same
 * stored patch fail to apply on the same-tree confirmation run.
 */
export async function removePatchPathsMissingFromBase(
  projectPath: string,
  baseCommit: string,
  patchFile: string,
): Promise<number> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', projectPath, 'apply', '--numstat', '-z', patchFile],
    { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const resolvedProjectPath = path.resolve(projectPath);
  let cleanedCount = 0;
  for (const relativePath of parseGitNumstatDestinationPaths(stdout)) {
    if (path.isAbsolute(relativePath)) continue;
    const resolvedPath = path.resolve(resolvedProjectPath, relativePath);
    const pathWithinProject = path.relative(resolvedProjectPath, resolvedPath);
    if (!pathWithinProject || pathWithinProject === '..' || pathWithinProject.startsWith(`..${path.sep}`)) {
      continue;
    }
    try {
      await execFileAsync('git', ['-C', resolvedProjectPath, 'cat-file', '-e', `${baseCommit}:${relativePath}`], {
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      continue;
    } catch {
      // No base preimage: this is a patch-created path, not persisted state.
    }
    if (await hasSymlinkParent(resolvedProjectPath, relativePath)) continue;
    if (!(await fs.lstat(resolvedPath).then(() => true, () => false))) continue;
    await fs.rm(resolvedPath, { recursive: true, force: true });
    cleanedCount++;
  }
  return cleanedCount;
}

async function patchMoblyForDarwin(projectPath: string): Promise<void> {
  if (os.platform() !== 'darwin') return;

  // Mobly's _collect_process_tree uses macOS-specific `pgrep -P`, but the
  // DeepSWE verifier's mocked test expects Linux `ps --ppid` syntax. Force
  // the Linux command so the mocked p2p test passes.
  const utilsPath = path.join(projectPath, 'mobly', 'utils.py');
  try {
    const utilsSource = await fs.readFile(utilsPath, 'utf-8');
    const patched = utilsSource.replace(
      /\s{4}if platform\.system\(\) == 'Darwin':\n\s{6}command = \['pgrep', '-P', str\(pid\)\]\n\s{4}else:\n\s{6}command = \[/g,
      '    command = ['
    );
    if (patched !== utilsSource) {
      await fs.writeFile(utilsPath, patched, 'utf-8');
      console.log('[deepswe] Patched mobly/utils.py for Darwin ps compatibility');
    }
  } catch {
    // ignore missing or unpatchable utils.py
  }

  // The p2p whitelist includes a Linux-only test that is skipped on Darwin.
  // The test mocks subprocess.check_output, so it is safe to run it here once
  // we force the Linux code path above.
  const utilsTestPath = path.join(projectPath, 'tests', 'mobly', 'utils_test.py');
  try {
    const utilsTestSource = await fs.readFile(utilsTestPath, 'utf-8');
    const patched = utilsTestSource.replace(
      /\n\s*@unittest\.skipIf\(\s*\n\s*platform\.system\(\) != 'Linux',\s*\n\s*'collect_process_tree only available on Unix like system\.',\s*\n\s*\)\s*\n/g,
      '\n'
    );
    if (patched !== utilsTestSource) {
      await fs.writeFile(utilsTestPath, patched, 'utf-8');
      console.log('[deepswe] Patched mobly/utils_test.py for Darwin p2p compatibility');
    }
  } catch {
    // ignore missing or unpatchable utils_test.py
  }
}

async function forceCheckout(
  projectPath: string,
  baseCommit: string,
): Promise<void> {
  let lockFile = path.join(projectPath, '.git', 'index.lock');
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'rev-parse', '--git-path', 'index.lock'], {
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    lockFile = path.resolve(projectPath, stdout.trim());
  } catch {
    // Keep the ordinary-repository path as a conservative fallback.
  }
  const startedAt = Date.now();
  const maxWaitMs = 60_000;
  let attempt = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    attempt++;
    try {
      await execFileAsync('git', ['-C', projectPath, 'checkout', '-f', baseCommit], {
        timeout: 60000,
        maxBuffer: 32 * 1024 * 1024,
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('index.lock')) {
        try {
          const stat = await fs.stat(lockFile);
          const lockAgeMs = Date.now() - stat.mtime.getTime();
          // If the lock is stale, remove it; otherwise keep waiting for the
          // owning Git process to finish.
          if (lockAgeMs > 30_000) {
            await fs.unlink(lockFile);
            console.log(`[deepswe] Removed stale .git/index.lock in ${projectPath}`);
          }
        } catch {
          // lock file may have been removed by another process
        }
        const backoff = Math.min(1000, 200 * attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Timed out waiting for .git/index.lock in ${projectPath}`);
}

async function ensureTaskDepsInstalled(
  projectPath: string,
  taskName: string
): Promise<AppliedTaskEnvironmentOverride[]> {
  const extraDeps = getTaskEnvironmentOverride(taskName);
  if (!extraDeps) return [];

  const appliedRequirements: string[] = [];
  const failedRequirements: string[] = [];

  const venvBin = path.join(projectPath, '.venv', 'bin');
  const pipBin = path.join(venvBin, 'pip');
  const hasVenv = await fs.access(pipBin).then(() => true, () => false);

  if (extraDeps.pip && extraDeps.pip.length > 0 && hasVenv) {
    console.log(`[deepswe] Ensuring verifier deps for ${taskName}: ${extraDeps.pip.join(' ')}`);
    const envPath = `${venvBin}${path.delimiter}${process.env.PATH ?? ''}`;
    const result = await runCommand(pipBin, ['install', ...extraDeps.pip], {
      cwd: projectPath,
      env: { ...process.env, PATH: envPath, VIRTUAL_ENV: path.dirname(venvBin) },
      timeout: 300_000,
    });
    if (result.exitCode !== 0) {
      // A failed repair that is only a console line manufactures an
      // unexplained wall of p2p failures that reads like a model regression.
      // Record it so the verdict carries the reason.
      console.warn(`[deepswe] Verifier dep install failed for ${taskName}: ${result.stderr}`);
      failedRequirements.push(...extraDeps.pip);
    } else {
      appliedRequirements.push(...extraDeps.pip);
    }
  }

  if (extraDeps.npm && extraDeps.npm.length > 0) {
    const nodeModulesDir = await findNodePackageDir(projectPath);
    if (nodeModulesDir) {
      console.log(`[deepswe] Ensuring verifier npm deps for ${taskName}: ${extraDeps.npm.join(' ')}`);
      const result = await runCommand('npm', ['install', '--no-save', ...extraDeps.npm], {
        cwd: nodeModulesDir,
        timeout: 300_000,
      });
      if (result.exitCode !== 0) {
        console.warn(`[deepswe] Verifier npm dep install failed for ${taskName}: ${result.stderr}`);
      } else {
        appliedRequirements.push(...extraDeps.npm);
      }
    }
  }

  const records: AppliedTaskEnvironmentOverride[] = [];
  if (appliedRequirements.length > 0) {
    records.push({
      kind: 'dependency',
      task: taskName,
      requirements: appliedRequirements,
      // Every pin changes behaviour, so every pin is disclosed. Gating this
      // on an author-supplied reason meant most of the override table
      // installed silently and an absent disclosure implied "no override".
      reason: extraDeps.dependencyReason ?? 'undeclared verifier dependency required by the local environment',
    });
  }
  if (failedRequirements.length > 0) {
    records.push({
      kind: 'dependency',
      task: taskName,
      requirements: failedRequirements,
      reason: 'environment repair FAILED to install; results below may reflect the broken environment, not the patch',
    });
  }
  return records;
}

async function rewriteConfig(
  taskDir: string,
  taskName: string,
  copiedTestsDir: string,
  appDir: string,
  verifierDir: string,
  artifactsDir: string
): Promise<{ config: Record<string, unknown>; applied: AppliedTaskEnvironmentOverride[] }> {
  const configPath = path.join(taskDir, 'tests', 'config.json');
  const raw = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(raw) as Record<string, unknown>;

  const replacer = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return rewriteContainerPaths(value, {
        '/logs/verifier': verifierDir,
        '/logs/artifacts': artifactsDir,
        '/tests': copiedTestsDir,
        '/app': appDir,
      });
    }
    if (Array.isArray(value)) {
      return value.map(replacer);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = replacer(v);
      }
      return out;
    }
    return value;
  };

  const rewritten = replacer(config) as Record<string, unknown>;
  // Verify the asserted cause of each port-based exclusion before honouring
  // it — an unchecked exclusion forgives real regressions.
  const declaredPorts = [
    ...new Set(
      (getTaskEnvironmentOverride(taskName)?.knownP2PEnvironmentFailures ?? [])
        .map((failure) => failure.requiresBusyPort)
        .filter((port): port is number => typeof port === 'number'),
    ),
  ];
  const busyPorts = new Set<number>();
  for (const port of declaredPorts) {
    if (await isPortBusy(port)) busyPorts.add(port);
  }
  const overrideResult = applyKnownEnvironmentFailures(taskName, rewritten, busyPorts);
  await writeFile(path.join(copiedTestsDir, 'config.json'), JSON.stringify(overrideResult.config, null, 2));
  return overrideResult;
}

/**
 * Rewrite the container-rooted paths (/app, /tests, /logs/…) a task config
 * uses into their host equivalents.
 *
 * ORDER-SENSITIVE, and the naive chained-replace this replaces had a bug that
 * silently zeroed whole tasks: `/tests` was rewritten BEFORE `/app`, so a
 * parametrized test id like `test_read[/app/tests/psd_files/0layers.psb]`
 * became `<appDir>/<testsDir>/psd_files/…` — an id pytest can never emit.
 * On psd-tools that made 428 of 979 p2p ids structurally unmatchable for
 * every model on every run.
 *
 * `/app` paths are therefore protected as whole tokens FIRST. The `\b` is
 * load-bearing in both patterns: without it, `/app` matches inside ordinary
 * words and re-creates the same class of corruption elsewhere — an adversarial
 * review caught this mangling 20 ids across four other tasks (e.g. tomlkit's
 * `invalid/table/append-with-dotted-keys-01`, pebble's `TestBatchGet/apply,…`),
 * which the tests below pin.
 */
export function rewriteContainerPaths(
  value: string,
  targets: { '/logs/verifier': string; '/logs/artifacts': string; '/tests': string; '/app': string },
): string {
  // Private-use codepoint as the sentinel: it cannot appear in a real test id
  // or shell line, and unlike NUL it is not a control character. A stray one
  // in the input would otherwise be resolved against our table on the way
  // out, so strip it before minting any of our own.
  const SENTINEL = '\uE000';
  const source = value.includes(SENTINEL) ? value.split(SENTINEL).join('') : value;
  const protectedPaths: string[] = [];
  let out = source.replace(/\/app\b(?:\/[^\s"'\])},:]*)?/g, (match) => {
    protectedPaths.push(match.replace(/^\/app/, targets['/app']));
    return `${SENTINEL}${String(protectedPaths.length - 1)}${SENTINEL}`;
  });
  out = out
    .replace(/\/logs\/verifier/g, targets['/logs/verifier'])
    .replace(/\/logs\/artifacts/g, targets['/logs/artifacts'])
    .replace(/\/tests\b/g, targets['/tests']);
  return out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => protectedPaths[Number(i)]);
}

const PATH_TO_ENV: Record<string, string> = {
  '/logs/verifier': 'VERIFIER_DIR',
  '/logs/artifacts': 'ARTIFACTS_DIR',
  '/tests': 'TESTS_DIR',
  '/app': 'APP_DIR',
};

function applyShellReplacements(line: string): string {
  let replaced = rewriteContainerPaths(line, {
    '/logs/verifier': '${VERIFIER_DIR}',
    '/logs/artifacts': '${ARTIFACTS_DIR}',
    '/tests': '${TESTS_DIR}',
    '/app': '${APP_DIR}',
  });
  // Single-quoted shell strings do not expand variables; convert any that now
  // contain rewritten harness paths to double-quoted so the env vars resolve.
  replaced = replaced.replace(
    /'([^']*\$\{(?:VERIFIER_DIR|ARTIFACTS_DIR|TESTS_DIR|APP_DIR)\}[^']*)'/g,
    '"$1"'
  );
  return replaced;
}

function applyPythonReplacements(line: string): string {
  // Inside single-quoted heredocs shell variables are not expanded, so rewrite
  // any literal harness paths to Python env lookups.
  function rewrite(prefix: string, quote: string, body: string): string {
    for (const [literalPath, envVar] of Object.entries(PATH_TO_ENV)) {
      if (body.startsWith(`${literalPath}/`)) {
        const rest = body.slice(literalPath.length + 1);
        const fallback = literalPath.replace(/'/g, "\\'");
        return `__import__('os').path.join(__import__('os').environ.get('${envVar}', '${fallback}'), ${prefix}${quote}${rest}${quote})`;
      }
    }
    return `${prefix}${quote}${body}${quote}`;
  }
  return line.replace(/(f?)(["'])(\/[^"']+\/[^"']*)\2/gi, (_m, prefix: string, quote: string, body: string) => rewrite(prefix, quote, body));
}

function replaceTestShPaths(script: string): string {
  const lines = script.split('\n');
  let inSingleQuotedHeredoc = false;
  let heredocTerminator: string | null = null;
  const result: string[] = [];

  for (const line of lines) {
    if (!inSingleQuotedHeredoc) {
      const heredocMatch = /<<-?'(\w+)'/.exec(line);
      if (heredocMatch) {
        inSingleQuotedHeredoc = true;
        heredocTerminator = heredocMatch[1];
        result.push(applyShellReplacements(line));
        continue;
      }
      result.push(applyShellReplacements(line));
    } else {
      if (heredocTerminator && line.trim() === heredocTerminator) {
        inSingleQuotedHeredoc = false;
        heredocTerminator = null;
      }
      result.push(applyPythonReplacements(line));
    }
  }

  return result.join('\n');
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        // Corepack 0.29 + Node 22.9 fails to verify pnpm/yarn tarball
        // signatures; disable integrity checks and auto-pinning so installs
        // use a compatible package-manager version.
        COREPACK_INTEGRITY_KEYS: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
        ...options.env,
      },
      timeout: options.timeout ?? 600000,
      // Docker build/test logs are huge; the default 1MB buffer truncates
      // them and misclassifies successful builds as failures.
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string; killed?: boolean; signal?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: e.code ?? 1,
      timedOut: e.killed === true || e.signal === 'SIGTERM',
    };
  }
}

const JUNIT_TO_CTRF_VERSION = '0.0.14';
const JEST_CTRF_VERSION = '0.0.11';
const MOCHA_CTRF_VERSION = '0.0.11';

async function ensureJunitToCtrf(): Promise<string> {
  const cacheDir = omegaVerifierToolsDir();
  const binDir = path.join(cacheDir, 'node_modules', '.bin');
  const binary = path.join(binDir, 'junit-to-ctrf');
  try {
    await fs.access(binary);
    return binDir;
  } catch {
    // not cached; install on demand
  }
  const install = await runCommand(
    'npm',
    ['install', '--prefix', cacheDir, `junit-to-ctrf@${JUNIT_TO_CTRF_VERSION}`],
    { timeout: 120000 }
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install junit-to-ctrf: ${install.stderr}\n${install.stdout}`);
  }
  return binDir;
}

async function ensureJestCtrf(): Promise<string> {
  const cacheDir = path.join(omegaVerifierToolsDir(), 'jest-ctrf');
  const reporterPath = path.join(cacheDir, 'node_modules', 'jest-ctrf-json-reporter', 'dist', 'index.js');
  const envPath = path.join(cacheDir, 'node_modules', 'jest-environment-node');
  try {
    await fs.access(reporterPath);
    await fs.access(envPath);
    return cacheDir;
  } catch {
    // not cached; install on demand
  }
  const install = await runCommand(
    'npm',
    ['install', '--prefix', cacheDir, `jest-ctrf-json-reporter@${JEST_CTRF_VERSION}`, 'jest-environment-node'],
    { timeout: 120000 }
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install jest-ctrf-json-reporter: ${install.stderr}\n${install.stdout}`);
  }
  return cacheDir;
}

async function ensureMochaCtrf(): Promise<string> {
  const cacheDir = path.join(omegaVerifierToolsDir(), 'mocha-ctrf');
  const reporterPath = path.join(cacheDir, 'node_modules', 'mocha-ctrf-json-reporter', 'dist', 'index.js');
  try {
    await fs.access(reporterPath);
    return cacheDir;
  } catch {
    // not cached; install on demand
  }
  const install = await runCommand(
    'npm',
    ['install', '--prefix', cacheDir, `mocha-ctrf-json-reporter@${MOCHA_CTRF_VERSION}`],
    { timeout: 120000 }
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install mocha-ctrf-json-reporter: ${install.stderr}\n${install.stdout}`);
  }
  return cacheDir;
}

async function ensureDeno(): Promise<string | undefined> {
  if (await commandExists('deno')) return undefined;
  const cacheDir = path.join(omegaVerifierToolsDir(), 'deno');
  const binary = path.join(cacheDir, 'bin', 'deno');
  try {
    await fs.access(binary);
    return path.join(cacheDir, 'bin');
  } catch {
    // not cached; install on demand
  }
  const platform = os.platform();
  const arch = os.arch();
  let suffix: string;
  if (platform === 'darwin' && arch === 'arm64') {
    suffix = 'aarch64-apple-darwin';
  } else if (platform === 'darwin') {
    suffix = 'x86_64-apple-darwin';
  } else if (platform === 'linux' && arch === 'arm64') {
    suffix = 'aarch64-unknown-linux-gnu';
  } else if (platform === 'linux') {
    suffix = 'x86_64-unknown-linux-gnu';
  } else {
    return undefined;
  }
  const url = `https://github.com/denoland/deno/releases/latest/download/deno-${suffix}.zip`;
  const zipPath = path.join(cacheDir, 'deno.zip');
  await fs.mkdir(cacheDir, { recursive: true });
  const download = await runCommand('curl', ['-fsSL', url, '-o', zipPath], { timeout: 300_000 });
  if (download.exitCode !== 0) {
    throw new Error(`Failed to download deno: ${download.stderr}\n${download.stdout}`);
  }
  await fs.mkdir(path.join(cacheDir, 'bin'), { recursive: true });
  const unzip = await runCommand('unzip', ['-o', '-q', zipPath, '-d', path.join(cacheDir, 'bin')], { timeout: 60_000 });
  if (unzip.exitCode !== 0) {
    throw new Error(`Failed to unzip deno: ${unzip.stderr}\n${unzip.stdout}`);
  }
  await fs.chmod(binary, 0o755).catch(() => undefined);
  await fs.rm(zipPath, { force: true }).catch(() => undefined);
  return path.join(cacheDir, 'bin');
}

async function ensureNextest(): Promise<string> {
  const cacheDir = path.join(omegaVerifierToolsDir(), 'nextest');
  const binary = path.join(cacheDir, 'bin', 'cargo-nextest');
  const configPath = path.join(cacheDir, 'nextest.toml');
  try {
    await fs.access(binary);
    await fs.access(configPath);
    return cacheDir;
  } catch {
    // not cached; install on demand
  }
  const cargoHome = path.join(os.homedir(), '.cargo', 'bin');
  const cargoBin = path.join(cargoHome, 'cargo');
  // cargo-nextest is a Rust tool; compile it once. --root puts the binary under cacheDir/bin.
  const install = await runCommand(
    cargoBin,
    ['install', 'cargo-nextest', '--locked', '--root', cacheDir],
    { timeout: 600_000 }
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install cargo-nextest: ${install.stderr}\n${install.stdout}`);
  }
  // The DeepSWE verifier selects a 'junit' profile and copies
  // target/nextest/junit/junit.xml after each run.
  await fs.writeFile(
    configPath,
    '[profile.junit]\njunit = { path = "junit.xml" }\n',
    'utf-8'
  );
  return cacheDir;
}

// Node 22's built-in junit reporter does not include a `file` attribute on
// <testcase>, so DeepSWE's report fixup cannot build whitelisted test ids for
// node:test suites (e.g. optique). This small reporter emits JUnit XML with the
// file attribute populated from the test runner events.
async function ensureNodeJUnitReporter(): Promise<string> {
  const cacheDir = omegaVerifierToolsDir();
  const reporterPath = path.join(cacheDir, 'node-junit-with-file.js');
  // Always rewrite the reporter so bug fixes are picked up; the file is tiny.
  await fs.rm(reporterPath, { force: true });
  const source = String.raw`'use strict';
const os = require('os');

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = async function * (source) {
  const events = [];
  for await (const event of source) {
    events.push(event);
  }

  const root = { name: 'Root', children: [], nesting: -1 };
  const stack = [root];
  for (const event of events) {
    if (event.type === 'test:start') {
      let parent = root;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].nesting < event.data.nesting) {
          parent = stack[i];
          break;
        }
      }
      const node = {
        name: event.data.name,
        file: event.data.file,
        line: event.data.line,
        children: [],
        status: undefined,
        duration: 0,
        error: undefined,
        skip: false,
        nesting: event.data.nesting,
      };
      parent.children.push(node);
      stack.push(node);
    } else if (event.type === 'test:pass') {
      for (let i = stack.length - 1; i >= 0; i--) {
        const n = stack[i];
        if (n.name === event.data.name && n.nesting === event.data.nesting) {
          n.status = 'passed';
          n.duration = event.data.details?.duration_ms ?? 0;
          break;
        }
      }
    } else if (event.type === 'test:fail') {
      for (let i = stack.length - 1; i >= 0; i--) {
        const n = stack[i];
        if (n.name === event.data.name && n.nesting === event.data.nesting) {
          n.status = 'failed';
          n.duration = event.data.details?.duration_ms ?? 0;
          const err = event.data.details?.error;
          n.error = err ? (err.message || String(err)) : 'failed';
          break;
        }
      }
    } else if (event.type === 'test:skip' || event.type === 'test:todo') {
      for (let i = stack.length - 1; i >= 0; i--) {
        const n = stack[i];
        if (n.name === event.data.name && n.nesting === event.data.nesting) {
          n.status = 'skipped';
          n.skip = true;
          break;
        }
      }
    }
  }

  function count(node) {
    let tests = 0;
    let failures = 0;
    let skipped = 0;
    let time = 0;
    if (node.children.length === 0) {
      tests = 1;
      if (node.status === 'failed') failures = 1;
      if (node.status === 'skipped') skipped = 1;
      time = node.duration || 0;
    } else {
      for (const c of node.children) {
        const cc = count(c);
        tests += cc.tests;
        failures += cc.failures;
        skipped += cc.skipped;
        time += cc.time;
      }
    }
    return { tests, failures, skipped, time };
  }

  function renderNode(node, depth) {
    const indent = '  '.repeat(depth);
    if (node.children.length === 0) {
      let out = indent + '<testcase name="' + escapeXml(node.name) + '" time="' + (node.duration / 1000).toFixed(6) + '" file="' + escapeXml(node.file ?? '') + '" classname="test"';
      if (node.status === 'failed' && node.error) {
        out += '>\n' + indent + '  <failure message="' + escapeXml(node.error) + '">' + escapeXml(node.error) + '</failure>\n' + indent + '</testcase>';
      } else if (node.status === 'skipped') {
        out += '>\n' + indent + '  <skipped/>\n' + indent + '</testcase>';
      } else {
        out += '/>';
      }
      return out + '\n';
    }
    const c = count(node);
    let out = indent + '<testsuite name="' + escapeXml(node.name) + '" time="' + (c.time / 1000).toFixed(6) + '" disabled="0" errors="0" tests="' + c.tests + '" failures="' + c.failures + '" skipped="' + c.skipped + '" hostname="' + escapeXml(os.hostname()) + '">\n';
    for (const child of node.children) {
      out += renderNode(child, depth + 1);
    }
    out += indent + '</testsuite>\n';
    return out;
  }

  yield '<?xml version="1.0" encoding="utf-8"?>\n';
  yield '<testsuites>\n';
  for (const child of root.children) {
    yield renderNode(child, 1);
  }
  yield '</testsuites>\n';
};
`;
  await fs.writeFile(reporterPath, source, 'utf-8');
  return reporterPath;
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const { exitCode } = await runCommand('docker', ['info'], { timeout: 10000 });
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function imageExists(tag: string): Promise<boolean> {
  const { exitCode } = await runCommand('docker', ['image', 'inspect', tag], { timeout: 10000 });
  return exitCode === 0;
}

async function buildDeepSWEImage(taskDir: string, taskName: string): Promise<string | undefined> {
  const dockerfileDir = path.join(taskDir, 'environment');
  const dockerfilePath = path.join(dockerfileDir, 'Dockerfile');
  try {
    await fs.access(dockerfilePath);
  } catch {
    return undefined;
  }
  const tag = `omega-deepswe-${taskName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (await imageExists(tag)) {
    return tag;
  }
  const build = await runCommand('docker', ['build', '-t', tag, '-f', dockerfilePath, dockerfileDir], {
    timeout: 1200000,
  });
  if (build.exitCode !== 0) {
    throw new Error(`Docker build failed for ${taskName}:\n${build.stderr}\n${build.stdout}`);
  }
  return tag;
}

async function runDeepSWEVerifierDocker(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  taskName: string,
  modelPatchArg?: string
): Promise<DeepSWEVerifierResult> {
  const absoluteTaskDir = path.resolve(taskDir);
  const testsDir = path.join(absoluteTaskDir, 'tests');
  const workDir = path.join(omegaWorkDir(), 'deepswe', `${path.basename(taskDir)}-${String(Date.now())}`);
  const verifierDir = path.join(workDir, 'logs', 'verifier');
  const artifactsDir = path.join(workDir, 'logs', 'artifacts');
  const logFile = path.join(workDir, 'verifier.log');

  await fs.mkdir(verifierDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  const modelPatch = normalisePatch(modelPatchArg ?? (await generateModelPatch(projectPath, baseCommit)));
  await writeFile(path.join(artifactsDir, 'model.patch'), modelPatch);

  const image = await buildDeepSWEImage(absoluteTaskDir, taskName);
  if (!image) {
    throw new Error(`No Dockerfile found for DeepSWE task ${taskName}`);
  }

  const logLines: string[] = [];
  function log(line: string): void {
    logLines.push(line);
  }
  log(`Using Docker image ${image}`);

  const args = [
    'run',
    '--rm',
    '-v',
    `${testsDir}:/tests:ro`,
    '-v',
    `${artifactsDir}:/logs/artifacts`,
    '-v',
    `${verifierDir}:/logs/verifier`,
    image,
    'bash',
    '/tests/test.sh',
  ];

  const testRun = await runCommand('docker', args, { timeout: 1_800_000 });
  log(`=== test.sh stdout ===\n${testRun.stdout}`);
  log(`=== test.sh stderr ===\n${testRun.stderr}`);

  let reward: Reward = {};
  try {
    const rewardRaw = await fs.readFile(path.join(verifierDir, 'reward.json'), 'utf-8');
    reward = JSON.parse(rewardRaw) as Reward;
  } catch {
    // reward.json may be missing if verifier crashed.
  }

  const logs = logLines.join('\n');
  await fs.writeFile(logFile, logs, 'utf-8').catch(() => {
    // ignore write errors
  });

  return {
    reward,
    logs,
    gradingLogs: logs,
    verifierMode: 'docker',
    logFile,
    exitCode: testRun.exitCode,
    timedOut: testRun.timedOut,
    appliedEnvironmentOverrides: [],
    patchPathsCleanedCount: 0,
  };
}

async function runDeepSWEVerifier(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  useDocker: boolean,
  taskName: string,
  modelPatchArg?: string,
): Promise<DeepSWEVerifierResult> {
  if (useDocker && (await dockerAvailable())) {
    try {
      const dockerResult = await runDeepSWEVerifierDocker(
        projectPath,
        taskDir,
        baseCommit,
        path.basename(taskDir),
        modelPatchArg
      );
      // If Docker ran but produced no usable reward (e.g. build/infra failure),
      // fall back to the local verifier so a correct patch is not punished for
      // environment issues. A docker timeout → exitCode 1 → docker-validity
      // check fails → falls back to a fresh local run; verifier_timed_out only
      // surfaces on the local path.
      if (dockerResult.exitCode === 0 && (dockerResult.reward.reward === 1 || dockerResult.reward.partial !== undefined)) {
        return dockerResult;
      }
      // A docker timeout surfaces as exitCode 1 → the validity check above fails →
      // fall back to a fresh local run (verifier_timed_out only surfaces on the
      // local path). Preserve the docker-side evidence so the timeout is diagnosable.
      const fallbackLogs = `[Docker verifier ${dockerResult.timedOut ? 'timed out' : 'failed'}, falling back to local]\n${dockerResult.logs}\n\n`;
      const fallback = await runDeepSWEVerifierLocal(
        projectPath,
        taskDir,
        baseCommit,
        taskName,
        modelPatchArg,
      );
      return { ...fallback, logs: fallbackLogs + fallback.logs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Docker build or runtime failure: try local verifier as fallback.
      const fallback = await runDeepSWEVerifierLocal(
        projectPath,
        taskDir,
        baseCommit,
        taskName,
        modelPatchArg,
      );
      return {
        ...fallback,
        logs: `[Docker verifier failed, falling back to local]\n${message}\n\n${fallback.logs}`,
      };
    }
  }

  return runDeepSWEVerifierLocal(
    projectPath,
    taskDir,
    baseCommit,
    taskName,
    modelPatchArg,
  );
}

async function runDeepSWEVerifierLocal(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  taskName: string,
  modelPatchArg?: string,
): Promise<DeepSWEVerifierResult> {
  const testsDir = path.join(taskDir, 'tests');
  const workDir = path.join(omegaWorkDir(), 'deepswe', `${path.basename(taskDir)}-${String(Date.now())}`);
  const verifierDir = path.join(workDir, 'logs', 'verifier');
  const artifactsDir = path.join(workDir, 'logs', 'artifacts');
  const copiedTestsDir = path.join(workDir, 'tests');
  const logFile = path.join(workDir, 'verifier.log');

  await fs.mkdir(verifierDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  await execFileAsync('cp', ['-R', testsDir, copiedTestsDir], { timeout: 60000 });
  const configOverrideResult = await rewriteConfig(
    taskDir,
    taskName,
    copiedTestsDir,
    projectPath,
    verifierDir,
    artifactsDir
  );

  const modelPatch = normalisePatch(modelPatchArg ?? (await generateModelPatch(projectPath, baseCommit)));
  const modelPatchPath = path.join(artifactsDir, 'model.patch');
  await writeFile(modelPatchPath, modelPatch);
  await forceCheckout(projectPath, baseCommit);
  const patchPathsCleanedCount = await removePatchPathsMissingFromBase(
    projectPath,
    baseCommit,
    modelPatchPath,
  ).catch(() => {
    // A malformed patch will be reported by the grader as apply_failed. This
    // targeted rerun preparation must never become a new grading failure.
    return 0;
  });

  // Re-install any task-specific verifier dependencies that may be missing from
  // a cached or reused project worktree.
  const dependencyOverrides = await ensureTaskDepsInstalled(projectPath, taskName);
  const appliedEnvironmentOverrides = [...configOverrideResult.applied, ...dependencyOverrides];

  // Re-apply per-task environment fixups after the force-checkout, which
  // discards any uncommitted changes made during initial setup.
  if (taskName === 'mobly-grouped-test-barriers') {
    await patchMoblyForDarwin(projectPath);
  }

  const junitBinDir = await ensureJunitToCtrf();

  const testShPath = path.join(copiedTestsDir, 'test.sh');
  const testShRaw = await fs.readFile(testShPath, 'utf-8');
  let rewritten = replaceTestShPaths(testShRaw);
  // The shared verifier frame single-quotes the base JUnit glob, which
  // prevents ${VERIFIER_DIR} from expanding after our path rewrite. Switch to
  // double quotes so the absolute path is passed to junit-to-ctrf.
  rewritten = rewritten.replace(/'(\$\{VERIFIER_DIR\}\/base\*\.xml)'/g, '"$1"');
  if (rewritten.includes('/opt/jest-ctrf')) {
    const jestCtrfDir = await ensureJestCtrf();
    rewritten = rewritten.replace(/\/opt\/jest-ctrf/g, jestCtrfDir);
  }
  if (rewritten.includes('/opt/ctrf')) {
    const mochaCtrfDir = await ensureMochaCtrf();
    rewritten = rewritten.replace(/\/opt\/ctrf/g, mochaCtrfDir);
  }
  const nextestDir = rewritten.includes('/opt/nextest') ? await ensureNextest() : undefined;
  if (nextestDir) {
    rewritten = rewritten.replace(/\/opt\/nextest/g, nextestDir);
  }
  const denoDir = /\bdeno\b/.test(rewritten) ? await ensureDeno() : undefined;
  // Deno-only verifiers run `deno test --cached-only`, but the new-mode test
  // file is only added by test.patch, so its JSR deps are not cached during
  // setup. Cache them after the grader applies test.patch. Mixed projects with
  // a Node lockfile use the normal Node toolchain instead.
  const hasDenoConfig =
    (await fs.access(path.join(projectPath, 'deno.json')).then(() => true, () => false)) ||
    (await fs.access(path.join(projectPath, 'deno.jsonc')).then(() => true, () => false));
  const hasNodePackage =
    (await fs.access(path.join(projectPath, 'package.json')).then(() => true, () => false)) ||
    (await fs.access(path.join(projectPath, 'pnpm-lock.yaml')).then(() => true, () => false)) ||
    (await fs.access(path.join(projectPath, 'package-lock.json')).then(() => true, () => false)) ||
    (await fs.access(path.join(projectPath, 'yarn.lock')).then(() => true, () => false));
  if (hasDenoConfig && !hasNodePackage) {
    rewritten = rewritten.replace(
      /python3 \$\{TESTS_DIR\}\/grader\.py prepare \|\| exit \$\?/,
      'python3 ${TESTS_DIR}/grader.py prepare || exit $?\ndeno test --no-run --no-check || true'
    );
  }
  // Node 22's built-in junit reporter omits the `file` attribute that DeepSWE
  // needs to build whitelisted ids. Swap it for a custom reporter when the
  // test frame uses node:test with JUnit output.
  if (rewritten.includes('--test-reporter=junit') && rewritten.includes('node --experimental-transform-types --test')) {
    const reporterPath = await ensureNodeJUnitReporter();
    rewritten = rewritten.replace(/--test-reporter=junit\b/g, `--test-reporter=${reporterPath}`);
  }
  // happy-dom's hidden IntersectionObserver tests wait for async polling and
  // can exceed the default 500ms vitest timeout configured in the repo.
  if (rewritten.includes('IntersectionObserver.challenge.test.ts') && !rewritten.includes('--testTimeout')) {
    rewritten = rewritten.replace(
      /IntersectionObserver\.challenge\.test\.ts/g,
      'IntersectionObserver.challenge.test.ts --testTimeout=10000'
    );
  }

  const pnpPath = path.join(projectPath, '.pnp.cjs');
  const hasPnp = await fs.access(pnpPath).then(() => true, () => false);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: projectPath,
    TESTS_DIR: copiedTestsDir,
    VERIFIER_DIR: verifierDir,
    ARTIFACTS_DIR: artifactsDir,
    // Kysely's .mocharc.js requires std-env@4 which is ESM-only.
    // Yarn 2+ PnP projects need .pnp.cjs preloaded so npx jest/node resolve deps.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-require-module${hasPnp ? ` --require ${pnpPath}` : ''}`.trim(),
    // Suppress Node 22 experimental-warning noise that leaks into testem/child assertions.
    NODE_NO_WARNINGS: '1',
    // Kombu's SQS tests hard-code us-east-1 expectations; neutralise local AWS region.
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    // Pin a deterministic timezone so property tests (e.g. dateutil) do not fail
    // because of mismatched local-DST assumptions on the host.
    TZ: 'UTC',
    // dateutil's base suite triggers a pytest deprecation warning that is
    // promoted to an error by its pytest config and aborts the verifier before
    // most p2p tests run. Suppress only that specific warning for this task.
    PYTHONWARNINGS:
      taskName === 'dateutil-rfc5545-timezone-interop'
        ? (process.env.PYTHONWARNINGS ? `${process.env.PYTHONWARNINGS},ignore::pytest.PytestRemovedIn10Warning` : 'ignore::pytest.PytestRemovedIn10Warning')
        : process.env.PYTHONWARNINGS,
    PATH: `${path.join(projectPath, '.venv', 'bin')}${path.delimiter}${junitBinDir}${path.delimiter}${nextestDir ? path.join(nextestDir, 'bin') + path.delimiter : ''}${denoDir ? denoDir + path.delimiter : ''}${process.env.PATH ?? ''}:${process.env.HOME ?? '/Users/benebsworth'}/go/bin`,
  };

  const logLines: string[] = [];
  function log(line: string): void {
    logLines.push(line);
  }

  const localTestSh = path.join(workDir, 'test.sh');
  await writeFile(localTestSh, rewritten);
  await fs.chmod(localTestSh, 0o755);

  const testRun = await runCommand('bash', [localTestSh], {
    cwd: projectPath,
    env,
    timeout: 1_800_000,
  });
  log(`=== test.sh stdout ===\n${testRun.stdout}`);
  log(`=== test.sh stderr ===\n${testRun.stderr}`);
  if (appliedEnvironmentOverrides.length > 0) {
    log(
      `=== environment overrides applied ===\n${appliedEnvironmentOverrides.map(formatAppliedEnvironmentOverride).join('\n')}`
    );
  }

  let reward: Reward = {};
  try {
    const rewardRaw = await fs.readFile(path.join(verifierDir, 'reward.json'), 'utf-8');
    reward = JSON.parse(rewardRaw) as Reward;
  } catch {
    // reward.json may be missing if verifier crashed.
  }

  const logs = logLines.join('\n');
  await fs.writeFile(logFile, logs, 'utf-8').catch(() => {
    // ignore write errors
  });

  return {
    reward,
    logs,
    gradingLogs: logs,
    verifierMode: 'local',
    logFile,
    exitCode: testRun.exitCode,
    timedOut: testRun.timedOut,
    appliedEnvironmentOverrides,
    patchPathsCleanedCount,
  };
}

export interface DeepSWEVerifierInvocation {
  projectPath: string;
  taskDir: string;
  baseCommit: string;
  useDocker: boolean;
  taskName: string;
  modelPatch: string;
}

export type DeepSWEVerifierRunner = (
  invocation: DeepSWEVerifierInvocation,
) => Promise<DeepSWEVerifierResult>;

export type FlakeRerunBudgetDecision =
  | { acquired: true }
  | { acquired: false; skippedReason: string };

export interface FlakeRerunBudget {
  acquire: () => FlakeRerunBudgetDecision;
}

export function createFlakeRerunBudget(
  environment: NodeJS.ProcessEnv = process.env,
): FlakeRerunBudget {
  const raw = environment.OMEGA_DEEPSWE_FLAKE_MAX_RERUNS;
  const parsed = raw === undefined || raw.trim() === '' ? 1_024 : Number(raw);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  let used = 0;

  return {
    acquire: (): FlakeRerunBudgetDecision => {
      if (!valid) {
        return {
          acquired: false,
          skippedReason: 'OMEGA_DEEPSWE_FLAKE_MAX_RERUNS is invalid',
        };
      }
      if (used >= parsed) {
        return {
          acquired: false,
          skippedReason: `sweep-level flake re-run budget exhausted (${String(used)}/${String(parsed)})`,
        };
      }
      used++;
      return { acquired: true };
    },
  };
}

export interface DeepSWEFlakeEvaluationInput {
  invocation: DeepSWEVerifierInvocation;
  environment?: NodeJS.ProcessEnv;
  rerunBudget: FlakeRerunBudget;
}

export async function evaluateDeepSWEWithFlakeRerun(
  input: DeepSWEFlakeEvaluationInput,
  runVerifier: DeepSWEVerifierRunner,
): Promise<BenchmarkEvaluation> {
  const environment = input.environment ?? process.env;
  const firstResult = await runVerifier(input.invocation);
  const { reward, logs, logFile, exitCode, timedOut, appliedEnvironmentOverrides } = firstResult;
  const originalPassed = reward.reward === 1;
  const configuredMaxRaw = environment.OMEGA_DEEPSWE_FLAKE_MAX_P2P_FAILURES;
  const configuredMax = configuredMaxRaw === undefined || configuredMaxRaw.trim() === ''
    ? undefined
    : Number(configuredMaxRaw);
  const gate = decideFlakeRerun({
    reward,
    timedOut,
    disabled: environment.OMEGA_DEEPSWE_DISABLE_FLAKE_RERUN === '1',
    maxP2PFailures: configuredMax,
  });
  const firstRun: FlakeVerifierRun = {
    reward,
    timedOut,
    verifierMode: firstResult.verifierMode,
    failingP2PTests: parseFailingP2PTestIds(firstResult.gradingLogs),
  };
  let rerunAttempted = false;
  let rerunResult: DeepSWEVerifierResult | undefined;
  let flakeVerdict: FlakeAwareVerdict | undefined;
  let flakeRerunSkippedReason: string | undefined;

  if (!gate.shouldRerun) {
    flakeRerunSkippedReason = gate.skippedReason;
  } else {
    const budgetDecision = input.rerunBudget.acquire();
    if (!budgetDecision.acquired) {
      flakeRerunSkippedReason = budgetDecision.skippedReason;
    } else {
      // Reserve the sweep budget synchronously above, then run one complete
      // confirmation pass in the same project tree. forceCheckout plus the
      // targeted patch-path cleanup make the stored patch re-applicable while
      // preserving the first run's installed dependency/runtime environment.
      // No test invokes runDeepSWEVerifierLocal twice: the first production
      // confirmation re-run is the first end-to-end exercise of same-tree
      // stored-patch reapplication, so its first-sweep evidence needs review.
      rerunAttempted = true;
      try {
        rerunResult = await runVerifier(input.invocation);
        flakeVerdict = synthesizeFlakeAwareVerdict({
          originalPassed,
          firstRun,
          rerun: {
            reward: rerunResult.reward,
            timedOut: rerunResult.timedOut,
            verifierMode: rerunResult.verifierMode,
            failingP2PTests: parseFailingP2PTestIds(rerunResult.gradingLogs),
          },
        });
      } catch (error) {
        flakeVerdict = synthesizeFlakeAwareVerdict({
          originalPassed,
          firstRun,
          rerun: {
            failingP2PTests: [],
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      flakeRerunSkippedReason = flakeVerdict.reason;
    }
  }

  const passed = flakeVerdict?.passed ?? originalPassed;
  const flakyTests = flakeVerdict?.flakyTests ?? [];
  const confirmedFailingTests = flakeVerdict?.confirmedFailingTests ?? [];
  const environmentOverrideDisclosure = appliedEnvironmentOverrides
    .map(formatAppliedEnvironmentOverride)
    .join('; ');
  const environmentOverrideSuffix = environmentOverrideDisclosure
    ? `; ${environmentOverrideDisclosure}`
    : '';
  const metrics: Record<string, number | string> = {
    f2p_passed: reward.f2p_passed ?? 0,
    f2p_total: reward.f2p_total ?? 0,
    p2p_passed: reward.p2p_passed ?? 0,
    p2p_total: reward.p2p_total ?? 0,
    partial: reward.partial ?? 0,
    verifier_exit_code: exitCode,
    verifier_log_file: logFile,
    verifier_mode: firstResult.verifierMode,
    ...(timedOut ? { verifier_timed_out: 1 } : {}),
    flake_rerun: rerunAttempted ? 1 : 0,
    p2p_flaky_count: flakyTests.length,
    p2p_flaky_tests: flakyTests.join('\n'),
    p2p_confirmed_failing_count: confirmedFailingTests.length,
    p2p_confirmed_failing_tests: confirmedFailingTests.join('\n'),
    ...(flakeRerunSkippedReason ? { flake_rerun_skipped_reason: flakeRerunSkippedReason } : {}),
    ...(
      !originalPassed &&
      flakeVerdict?.passed === true &&
      !flakeVerdict.originalVerdictRetained
        ? { flake_forgiven_pass: 1 }
        : {}
    ),
    ...(flakeVerdict?.p2pRerunFailureDisjoint
      ? { p2p_rerun_failure_disjoint: 1 }
      : {}),
    ...(firstResult.patchPathsCleanedCount > 0
      ? { patch_paths_cleaned_count: firstResult.patchPathsCleanedCount }
      : {}),
  };
  if (reward.apply_failed) metrics.apply_failed = 1;
  if (appliedEnvironmentOverrides.length > 0) {
    metrics.environment_override_count = appliedEnvironmentOverrides.length;
    metrics.known_environment_p2p_exclusion_count = appliedEnvironmentOverrides.filter(
      (override) => override.kind === 'known-p2p-environment-failure',
    ).length;
    metrics.environment_overrides = appliedEnvironmentOverrides
      .map(formatAppliedEnvironmentOverride)
      .join('\n');
  }
  // Persisted evidence stays bounded, but all grading decisions above parse
  // gradingLogs in full so an early failure line can never be truncated away.
  metrics.verifier_logs = logs.slice(-4096);
  if (rerunResult) {
    metrics.f2p_passed_rerun = rerunResult.reward.f2p_passed ?? 0;
    metrics.f2p_total_rerun = rerunResult.reward.f2p_total ?? 0;
    metrics.p2p_passed_rerun = rerunResult.reward.p2p_passed ?? 0;
    metrics.p2p_total_rerun = rerunResult.reward.p2p_total ?? 0;
    metrics.partial_rerun = rerunResult.reward.partial ?? 0;
    metrics.verifier_exit_code_rerun = rerunResult.exitCode;
    metrics.verifier_log_file_rerun = rerunResult.logFile;
    metrics.verifier_mode_rerun = rerunResult.verifierMode;
    metrics.verifier_logs_rerun = rerunResult.logs.slice(-4096);
    if (rerunResult.timedOut) metrics.verifier_timed_out_rerun = 1;
    if (rerunResult.reward.apply_failed) metrics.apply_failed_rerun = 1;
    if (rerunResult.patchPathsCleanedCount > 0) {
      metrics.patch_paths_cleaned_count_rerun = rerunResult.patchPathsCleanedCount;
    }
    if (rerunResult.appliedEnvironmentOverrides.length > 0) {
      metrics.environment_override_count_rerun = rerunResult.appliedEnvironmentOverrides.length;
      metrics.known_environment_p2p_exclusion_count_rerun = rerunResult.appliedEnvironmentOverrides.filter(
        (override) => override.kind === 'known-p2p-environment-failure',
      ).length;
      metrics.environment_overrides_rerun = rerunResult.appliedEnvironmentOverrides
        .map(formatAppliedEnvironmentOverride)
        .join('\n');
    }
  }

  const primaryMessage = timedOut
    ? `DeepSWE verifier timeout (reward=${String(reward.reward ?? 'missing')})`
    : originalPassed
      ? `DeepSWE verifier passed (f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`
      : `DeepSWE tests failed (reward=${String(reward.reward ?? 'missing')}, f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`;
  let message: string;
  if (!rerunAttempted) {
    message = `${primaryMessage}; flake re-run skipped (see flake_rerun_skipped_reason)`;
  } else if (flakeVerdict?.reason) {
    message = `${primaryMessage}; flake re-run inconclusive (see flake_rerun_skipped_reason)`;
  } else if (passed) {
    const disjointDisclosure = flakeVerdict?.p2pRerunFailureDisjoint
      ? '; p2p_rerun_failure_disjoint=1'
      : '';
    message = `DeepSWE verifier passed after flake re-run (${String(flakyTests.length)} flaky p2p: ${flakyTests.join(', ')}${disjointDisclosure})`;
  } else {
    const confirmed = `${String(confirmedFailingTests.length)} confirmed failing p2p: ${confirmedFailingTests.join(', ')}`;
    const flaky = flakyTests.length > 0
      ? `; ${String(flakyTests.length)} flaky p2p: ${flakyTests.join(', ')}`
      : '';
    message = `DeepSWE tests failed after flake re-run (${confirmed}${flaky})`;
  }
  return {
    passed,
    score: reward.partial,
    message: message + environmentOverrideSuffix,
    metrics,
  };
}

export async function loadDeepSWESuite(options: DeepSWEOptions): Promise<BenchmarkTask[]> {
  const entries = await fs.readdir(options.tasksDir, { withFileTypes: true });
  const taskDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(options.tasksDir, e.name));

  let loaded: { dir: string; toml: DeepSWETaskToml; instruction: string }[] = [];
  for (const dir of taskDirs) {
    try {
      const data = await readTask(dir);
      loaded.push({ dir, ...data });
    } catch {
      // Skip directories that don't look like DeepSWE tasks.
    }
  }

  if (options.taskIds && options.taskIds.length > 0) {
    loaded = loaded.filter((t) => {
      const id = t.toml.metadata?.task_id ?? path.basename(t.dir);
      return options.taskIds?.includes(id);
    });
  }

  if (options.nTasks && options.nTasks > 0 && options.nTasks < loaded.length) {
    const seed = options.sampleSeed ?? 0;
    const rnd = mulberry32(seed);
    loaded = loaded
      .map((t) => ({ t, sort: rnd() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, options.nTasks)
      .map((x) => x.t);
  }

  // One synchronously acquired budget is shared by every task produced by
  // this suite load, even when evaluations execute concurrently.
  const flakeRerunBudget = createFlakeRerunBudget(process.env);
  const tasks: BenchmarkTask[] = [];
  for (const { dir, toml, instruction } of loaded) {
    const id = toml.metadata?.task_id ?? path.basename(dir);
    const title = toml.metadata?.display_title ?? toml.metadata?.original_title ?? id;
    const repo = toml.metadata?.repository_url;
    const commit = toml.metadata?.base_commit_hash;
    const language = toml.metadata?.language;

    tasks.push({
      id: `deepswe-${id}`,
      name: id,
      title,
      description: buildDeepSweDescription(instruction, language, options.timeoutMs),
      complexity: (process.env.OMEGA_DEEPSWE_COMPLEXITY as 'simple' | 'medium' | 'complex' | undefined) ?? 'medium',
      tags: [id],
      setup: async (projectPath: string) => {
        if (!repo || !commit) {
          throw new Error(`DeepSWE task ${id} is missing repository_url or base_commit_hash`);
        }
        await cloneRepo(repo, commit, projectPath);
        await installProjectDependencies(projectPath, language, dir, id);
      },
      evaluate: async (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        if (!commit) {
          return {
            passed: false,
            message: 'Missing base_commit_hash; flake re-run skipped: no commit to verify',
            metrics: {
              flake_rerun: 0,
              p2p_flaky_count: 0,
              p2p_flaky_tests: '',
              p2p_confirmed_failing_count: 0,
              p2p_confirmed_failing_tests: '',
              flake_rerun_skipped_reason: 'no base commit to verify',
            },
          };
        }
        const storedPatch = ctx.diffs
          .slice()
          .reverse()
          .find((d) => typeof d.patch === 'string' && d.patch.trim().length > 0)?.patch;
        const patchAuditMetrics = deepSwePatchAuditMetrics(
          storedPatch ?? '',
          ctx.agentRun?.validationSummary,
        );
        if (!storedPatch) {
          // No agent patch → the task already failed. Running the full
          // verifier with an empty patch burns up to 30 min per no-patch
          // failure (all fail-to-pass tests fail + the whole suite runs).
          // Report immediately instead.
          return {
            passed: false,
            score: 0,
            message: 'DeepSWE verifier skipped (no patch produced by agent); flake re-run skipped: no patch to verify',
            metrics: {
              f2p_passed: 0,
              f2p_total: 0,
              p2p_passed: 0,
              p2p_total: 0,
              partial: 0,
              ...patchAuditMetrics,
              verifier_skipped: 1,
              flake_rerun: 0,
              p2p_flaky_count: 0,
              p2p_flaky_tests: '',
              p2p_confirmed_failing_count: 0,
              p2p_confirmed_failing_tests: '',
              flake_rerun_skipped_reason: 'no model patch to verify',
            },
          };
        }
        const evaluation = await evaluateDeepSWEWithFlakeRerun(
          {
            invocation: {
              projectPath: ctx.projectPath,
              taskDir: dir,
              baseCommit: commit,
              useDocker: options.useDocker ?? false,
              taskName: id,
              modelPatch: storedPatch,
            },
            environment: process.env,
            rerunBudget: flakeRerunBudget,
          },
          async (invocation) => runDeepSWEVerifier(
            invocation.projectPath,
            invocation.taskDir,
            invocation.baseCommit,
            invocation.useDocker,
            invocation.taskName,
            invocation.modelPatch,
          ),
        );
        const addedTestCount = patchAuditMetrics.graded_patch_added_test_paths;
        const addedTestPaths = patchAuditMetrics.graded_patch_added_test_path_list;
        const addedTestDisclosure = addedTestCount > 0
          ? `Graded patch adds ${String(addedTestCount)} test-like path${addedTestCount === 1 ? '' : 's'} absent from the base commit` +
            `${addedTestPaths ? `: ${addedTestPaths.slice(0, 512)}` : ''}. `
          : '';
        return {
          ...evaluation,
          message: `${addedTestDisclosure}${evaluation.message ?? ''}`.trim(),
          metrics: {
            ...evaluation.metrics,
            ...patchAuditMetrics,
          },
        };
      },
    });
  }
  return tasks;
}
