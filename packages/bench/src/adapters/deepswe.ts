import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { omegaVerifierToolsDir, omegaWorkDir } from '@omega/core';
import type { BenchmarkTask, BenchmarkEvaluation, EvaluationContext } from '../types.js';

const execFileAsync = promisify(execFile);

export interface DeepSWEOptions {
  tasksDir: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  useDocker?: boolean;
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

interface Reward {
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
- Install deps if missing: python3 -m venv .venv && source .venv/bin/activate && pip install -e .  (or: pip install -r requirements.txt)
- Run existing tests: python3 -m pytest -q  (uses .venv if present)
- If no pytest, fall back to: python3 -m unittest`;
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
- Lint: npm run lint  (or: pnpm lint)`;
  } else {
    cmds = `Language: unknown. Detect the project's test/build command from package.json, go.mod, Cargo.toml, or pyproject.toml, then run it.`;
  }
  return cmds;
}

function buildDeepSweDescription(instruction: string, language: string | undefined): string {
  const guidance = languageGuidance(language);
  // Strip branch-management instructions that conflict with the harness's
  // isolated worktree branch; the agent must stay on its assigned branch.
  const cleanedInstruction = instruction
    .replace(/IMPORTANT:[\s\S]*?new branch from main[\s\S]*?(?=\n\n|\n*$)/gi, '')
    .replace(/work on this in a new branch from main[\s\S]*?(?=\n\n|\n*$)/gi, '')
    .trim();
  return `${guidance}

BUILD GATE (critical): the verifier scores you zero if the project does not compile or the existing test suite breaks. Before calling finish you MUST:
   1. Run the build/compile command above and confirm zero errors.
   2. Run the existing test command above and confirm the pre-existing tests still pass.
   3. If either fails, fix it before finishing. Do NOT finish while the build is broken.

SCOPE CONSTRAINT: Only edit source files directly related to the task. Do NOT modify CI/CD configs (.github/, .coderabbit.yaml, .codesandbox/), documentation (README.md, AUTHORS, CONTRIBUTING.md), meta files (.release-it.json, .prettierignore), build configs (package.json, rollup.config.js, webpack.config.js, tsconfig.json), or project scaffolding. Do NOT delete existing files. Do NOT create new files unless necessary for the implementation. Every extraneous change wastes steps and risks breaking the verifier.

Implement precisely to the spec below - the hidden test suite checks exact behaviour (error message text, formatting, attribute names, signatures).

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

async function cloneRepo(repoUrl: string, commit: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // Ensure a clean clone so leftover state from previous runs cannot pollute
  // the worktree or branch list.
  await fs.rm(targetPath, { recursive: true, force: true });
  await execFileAsync('git', ['clone', repoUrl, targetPath], { timeout: 120000 });
  await execFileAsync('git', ['-C', targetPath, 'checkout', commit], { timeout: 60000 });
}

async function installProjectDependencies(projectPath: string, language?: string, taskDir?: string): Promise<void> {
  const has = (f: string) => fs.access(path.join(projectPath, f)).then(() => true, () => false);
  const lang = (language ?? '').toLowerCase();

  if (await has('package.json')) {
    const lock = (await has('pnpm-lock.yaml')) ? 'pnpm-lock.yaml' : (await has('yarn.lock')) ? 'yarn.lock' : undefined;
    const cmd = lock === 'pnpm-lock.yaml' && (await commandExists('pnpm')) ? ['pnpm', 'install'] :
                lock === 'yarn.lock' && (await commandExists('yarn')) ? ['yarn', 'install'] :
                ['npm', 'install'];
    const install = await runCommand(cmd[0], cmd.slice(1), { cwd: projectPath, timeout: 300_000 });
    if (install.exitCode !== 0) {
      throw new Error(`Dependency install failed: ${install.stderr}\n${install.stdout}`);
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

  if (lang === 'python') {
    const venvPath = path.join(projectPath, '.venv');
    const pipBin = path.join(venvPath, 'bin', 'pip');
    const venv = await runCommand('python3', ['-m', 'venv', '.venv'], { cwd: projectPath, timeout: 120_000 });
    if (venv.exitCode !== 0) {
      throw new Error(`venv creation failed: ${venv.stderr}\n${venv.stdout}`);
    }
    if (await has('pyproject.toml')) {
      const install = await runCommand(pipBin, ['install', '-e', '.'], { cwd: projectPath, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`pip install failed: ${install.stderr}\n${install.stdout}`);
      }
    } else if (await has('requirements.txt')) {
      const install = await runCommand(pipBin, ['install', '-r', 'requirements.txt'], { cwd: projectPath, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`pip install failed: ${install.stderr}\n${install.stdout}`);
      }
    }
    // The DeepSWE verifier reuses this base repo .venv to run hidden tests.
    // Ensure pytest and any declared dev dependencies are available there.
    const devReqCandidates = ['requirements-dev.txt', 'requirements_test.txt', 'requirements-test.txt', 'dev-requirements.txt', 'test-requirements.txt'];
    for (const reqFile of devReqCandidates) {
      if (await has(reqFile)) {
        const install = await runCommand(pipBin, ['install', '-r', reqFile], { cwd: projectPath, timeout: 300_000 });
        if (install.exitCode !== 0) {
          throw new Error(`dev dependency install failed: ${install.stderr}\n${install.stdout}`);
        }
      }
    }
    const pytestCheck = await runCommand(pipBin, ['show', 'pytest'], { cwd: projectPath, timeout: 30_000 });
    if (pytestCheck.exitCode !== 0) {
      const install = await runCommand(pipBin, ['install', 'pytest'], { cwd: projectPath, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`pytest install failed: ${install.stderr}\n${install.stdout}`);
      }
    }
    // DeepSWE verifiers often use pytest-xdist (-n), pytest-timeout, and pytest-asyncio.
    // Install them on demand when the verifier references them so base/new suites can run.
    const testShPath = path.join(taskDir ?? '', 'tests', 'test.sh');
    let testShText = '';
    if (taskDir) {
      try {
        testShText = await fs.readFile(testShPath, 'utf-8');
      } catch {
        // ignore missing test.sh
      }
    }
    const pytestExtras: string[] = [];
    if (/pytest.*-n\b/.test(testShText) || /\bxdist\b/.test(testShText)) {
      pytestExtras.push('pytest-xdist');
    }
    if (/--timeout[ =]/.test(testShText) || /\bpytest-timeout\b/.test(testShText)) {
      pytestExtras.push('pytest-timeout');
    }
    if (testShText.includes('pytest-asyncio') || /\basyncio\b/.test(testShText)) {
      pytestExtras.push('pytest-asyncio');
    }
    if (pytestExtras.length > 0) {
      const install = await runCommand(pipBin, ['install', ...pytestExtras], { cwd: projectPath, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`pytest extras install failed: ${install.stderr}\n${install.stdout}`);
      }
    }
    return;
  }

  if (lang === 'rust' && (await has('Cargo.toml'))) {
    const install = await runCommand('cargo', ['fetch'], { cwd: projectPath, timeout: 300_000 });
    if (install.exitCode !== 0) {
      throw new Error(`cargo fetch failed: ${install.stderr}\n${install.stdout}`);
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

async function rewriteConfig(
  taskDir: string,
  copiedTestsDir: string,
  appDir: string,
  verifierDir: string,
  artifactsDir: string
): Promise<Record<string, unknown>> {
  const configPath = path.join(taskDir, 'tests', 'config.json');
  const raw = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(raw) as Record<string, unknown>;

  const replacer = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(/\/logs\/verifier/g, verifierDir)
        .replace(/\/logs\/artifacts/g, artifactsDir)
        .replace(/\/tests/g, copiedTestsDir)
        .replace(/\/app\b/g, appDir)
        .replace(/\/app\//g, `${appDir}/`);
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
  await writeFile(path.join(copiedTestsDir, 'config.json'), JSON.stringify(rewritten, null, 2));
  return rewritten;
}

function replaceTestShPaths(script: string): string {
  let replaced = script;
  replaced = replaced.replace(/\/logs\/verifier/g, '${VERIFIER_DIR}');
  replaced = replaced.replace(/\/logs\/artifacts/g, '${ARTIFACTS_DIR}');
  replaced = replaced.replace(/\/tests/g, '${TESTS_DIR}');
  replaced = replaced.replace(/\/app\b/g, '${APP_DIR}');
  replaced = replaced.replace(/\/app\//g, '${APP_DIR}/');
  return replaced;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? 600000,
      // Docker build/test logs are huge; the default 1MB buffer truncates
      // them and misclassifies successful builds as failures.
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
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
  // The DeepSWE verifier selects a 'junit' profile that writes to target/nextest/junit/junit.xml.
  await fs.writeFile(
    configPath,
    '[profile.junit]\npath = "junit"\n',
    'utf-8'
  );
  return cacheDir;
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
): Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number }> {
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

  const testRun = await runCommand('docker', args, { timeout: 600000 });
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

  return { reward, logs, logFile, exitCode: testRun.exitCode };
}

async function runDeepSWEVerifier(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  useDocker: boolean,
  modelPatchArg?: string
): Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number }> {
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
      // environment issues.
      if (dockerResult.exitCode === 0 && (dockerResult.reward.reward === 1 || dockerResult.reward.partial !== undefined)) {
        return dockerResult;
      }
      const fallback = await runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, modelPatchArg);
      return fallback;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Docker build or runtime failure: try local verifier as fallback.
      const fallback = await runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, modelPatchArg);
      return {
        ...fallback,
        logs: `[Docker verifier failed, falling back to local]\n${message}\n\n${fallback.logs}`,
      };
    }
  }

  return runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, modelPatchArg);
}

async function runDeepSWEVerifierLocal(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  modelPatchArg?: string
): Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number }> {
  const testsDir = path.join(taskDir, 'tests');
  const workDir = path.join(omegaWorkDir(), 'deepswe', `${path.basename(taskDir)}-${String(Date.now())}`);
  const verifierDir = path.join(workDir, 'logs', 'verifier');
  const artifactsDir = path.join(workDir, 'logs', 'artifacts');
  const copiedTestsDir = path.join(workDir, 'tests');
  const logFile = path.join(workDir, 'verifier.log');

  await fs.mkdir(verifierDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  await execFileAsync('cp', ['-R', testsDir, copiedTestsDir], { timeout: 60000 });
  await rewriteConfig(taskDir, copiedTestsDir, projectPath, verifierDir, artifactsDir);

  const modelPatch = normalisePatch(modelPatchArg ?? (await generateModelPatch(projectPath, baseCommit)));
  await writeFile(path.join(artifactsDir, 'model.patch'), modelPatch);
  await execFileAsync('git', ['-C', projectPath, 'checkout', '-f', baseCommit], { timeout: 60000 });

  const junitBinDir = await ensureJunitToCtrf();

  const testShPath = path.join(copiedTestsDir, 'test.sh');
  const testShRaw = await fs.readFile(testShPath, 'utf-8');
  let rewritten = replaceTestShPaths(testShRaw);
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

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: projectPath,
    TESTS_DIR: copiedTestsDir,
    VERIFIER_DIR: verifierDir,
    ARTIFACTS_DIR: artifactsDir,
    PATH: `${path.join(projectPath, '.venv', 'bin')}${path.delimiter}${junitBinDir}${path.delimiter}${nextestDir ? path.join(nextestDir, 'bin') + path.delimiter : ''}${process.env.PATH ?? ''}:${process.env.HOME ?? '/Users/benebsworth'}/go/bin`,
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
    timeout: 600000,
  });
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

  return { reward, logs, logFile, exitCode: testRun.exitCode };
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
      description: buildDeepSweDescription(instruction, language),
      complexity: 'medium',
      tags: [id],
      setup: async (projectPath: string) => {
        if (!repo || !commit) {
          throw new Error(`DeepSWE task ${id} is missing repository_url or base_commit_hash`);
        }
        await cloneRepo(repo, commit, projectPath);
        await installProjectDependencies(projectPath, language, dir);
      },
      evaluate: async (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        if (!commit) {
          return { passed: false, message: 'Missing base_commit_hash' };
        }
        const storedPatch = ctx.diffs.length > 0 ? ctx.diffs[0].patch : undefined;
        const { reward, logs, logFile, exitCode } = await runDeepSWEVerifier(
          ctx.projectPath,
          dir,
          commit,
          options.useDocker ?? false,
          storedPatch
        );
        const passed = reward.reward === 1;
        const metrics: Record<string, number | string> = {
          f2p_passed: reward.f2p_passed ?? 0,
          f2p_total: reward.f2p_total ?? 0,
          p2p_passed: reward.p2p_passed ?? 0,
          p2p_total: reward.p2p_total ?? 0,
          partial: reward.partial ?? 0,
          verifier_exit_code: exitCode,
          verifier_log_file: logFile,
        };
        if (reward.apply_failed) {
          metrics.apply_failed = 1;
        }
        metrics.verifier_logs = logs.slice(-4096);
        return {
          passed,
          score: reward.partial,
          message: passed
            ? `DeepSWE verifier passed (f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`
            : `DeepSWE verifier failed (reward=${String(reward.reward ?? 'missing')}, f2p ${String(reward.f2p_passed ?? 0)}/${String(reward.f2p_total ?? 0)}, p2p ${String(reward.p2p_passed ?? 0)}/${String(reward.p2p_total ?? 0)})`,
          metrics,
        };
      },
    });
  }
  return tasks;
}
