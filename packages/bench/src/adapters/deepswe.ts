import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

async function cloneRepo(repoUrl: string, commit: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await execFileAsync('git', ['clone', repoUrl, targetPath], { timeout: 120000 });
  await execFileAsync('git', ['-C', targetPath, 'checkout', commit], { timeout: 60000 });
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function generateModelPatch(projectPath: string, baseCommit: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', projectPath, 'diff', '--binary', baseCommit, 'HEAD'], {
    timeout: 60000,
  });
  return stdout;
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
  taskName: string
): Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number }> {
  const absoluteTaskDir = path.resolve(taskDir);
  const testsDir = path.join(absoluteTaskDir, 'tests');
  const workDir = path.join('/tmp', `deepswe-${path.basename(taskDir)}-${String(Date.now())}`);
  const verifierDir = path.join(workDir, 'logs', 'verifier');
  const artifactsDir = path.join(workDir, 'logs', 'artifacts');
  const logFile = path.join(workDir, 'verifier.log');

  await fs.mkdir(verifierDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  const modelPatch = await generateModelPatch(projectPath, baseCommit);
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
  useDocker: boolean
): Promise<{ reward: Reward; logs: string; logFile: string; exitCode: number }> {
  if (useDocker && (await dockerAvailable())) {
    return runDeepSWEVerifierDocker(projectPath, taskDir, baseCommit, path.basename(taskDir));
  }

  const testsDir = path.join(taskDir, 'tests');
  const workDir = path.join('/tmp', `deepswe-${path.basename(taskDir)}-${String(Date.now())}`);
  const verifierDir = path.join(workDir, 'logs', 'verifier');
  const artifactsDir = path.join(workDir, 'logs', 'artifacts');
  const copiedTestsDir = path.join(workDir, 'tests');
  const logFile = path.join(workDir, 'verifier.log');

  await fs.mkdir(verifierDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  await execFileAsync('cp', ['-R', testsDir, copiedTestsDir], { timeout: 60000 });
  await rewriteConfig(taskDir, copiedTestsDir, projectPath, verifierDir, artifactsDir);

  const modelPatch = await generateModelPatch(projectPath, baseCommit);
  await writeFile(path.join(artifactsDir, 'model.patch'), modelPatch);
  await execFileAsync('git', ['-C', projectPath, 'checkout', '-f', baseCommit], { timeout: 60000 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: projectPath,
    TESTS_DIR: copiedTestsDir,
    VERIFIER_DIR: verifierDir,
    ARTIFACTS_DIR: artifactsDir,
    PATH: `${process.env.PATH ?? ''}:${process.env.HOME ?? '/Users/benebsworth'}/go/bin`,
  };

  const logLines: string[] = [];
  function log(line: string): void {
    logLines.push(line);
  }

  const testShPath = path.join(copiedTestsDir, 'test.sh');
  const testShRaw = await fs.readFile(testShPath, 'utf-8');
  const rewritten = replaceTestShPaths(testShRaw);
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

    tasks.push({
      id: `deepswe-${id}`,
      name: id,
      title,
      description: instruction,
      complexity: 'complex',
      setup: async (projectPath: string) => {
        if (!repo || !commit) {
          throw new Error(`DeepSWE task ${id} is missing repository_url or base_commit_hash`);
        }
        await cloneRepo(repo, commit, projectPath);
      },
      evaluate: async (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        if (!commit) {
          return { passed: false, message: 'Missing base_commit_hash' };
        }
        const { reward, logs, logFile, exitCode } = await runDeepSWEVerifier(
          ctx.projectPath,
          dir,
          commit,
          options.useDocker ?? false
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
