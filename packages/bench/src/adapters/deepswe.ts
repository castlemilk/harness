import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
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

// Per-task dependency/environment overrides. These cover test-only or
// environment-drift packages that are not declared in the project's own
// install metadata but are required for the DeepSWE verifier to pass.
const EXTRA_TASK_DEPS: Record<string, { pip?: string[]; npm?: string[] }> = {
  'mobly-grouped-test-barriers': { pip: ['pytz'] },
  'dateutil-rfc5545-timezone-interop': { pip: ['pytest<8'] },
  'bandit-incremental-cache-control': { pip: ['GitPython', 'sarif-om', 'jschema_to_python'] },
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

  const nodePackageDir = await findNodePackageDir(projectPath);
  if (nodePackageDir) {
    // pnpm workspaces keep the lockfile at the workspace root; installing from
    // a sub-package fails when dependencies use workspace/catalog protocols.
    const workspaceRoot = await findPnpmWorkspaceRoot(nodePackageDir);
    const installDir = workspaceRoot ?? nodePackageDir;
    const nodeHas = (f: string) => fs.access(path.join(installDir, f)).then(() => true, () => false);
    const lock = (await nodeHas('pnpm-lock.yaml')) ? 'pnpm-lock.yaml' : (await nodeHas('yarn.lock')) ? 'yarn.lock' : undefined;
    const cmd = lock === 'pnpm-lock.yaml' && (await commandExists('pnpm')) ? ['pnpm', 'install'] :
                lock === 'yarn.lock' && (await commandExists('yarn')) ? ['yarn', 'install'] :
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
    const runInstall = async (): Promise<void> => {
      const install = await runCommand(cmd[0], cmd.slice(1), { cwd: installDir, timeout: 300_000 });
      if (install.exitCode !== 0) {
        throw new Error(`Dependency install failed: ${install.stderr}\n${install.stdout}`);
      }
    };
    await runInstall();
    if (!(await ensureNodeBinaries())) {
      console.warn('[deepswe] node_modules missing test binaries, reinstalling');
      await fs.rm(path.join(installDir, 'node_modules'), { recursive: true, force: true });
      await runInstall();
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

      const fail = (stage: string, stderr: string): boolean => {
        errors.push(`${pythonBin} ${stage}: ${stderr}`);
        return true;
      };
      let failed = false;

      if (await has('pyproject.toml') || await has('setup.py')) {
        const install = await runCommand(pipBin, ['install', '-e', '.'], { cwd: projectPath, timeout: 300_000 });
        if (install.exitCode !== 0) failed = fail('pip install -e .', install.stderr);
      } else if (await has('requirements.txt')) {
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
        if (pytestExtras.length > 0) {
          const install = await runCommand(pipBin, ['install', ...pytestExtras], { cwd: projectPath, timeout: 300_000 });
          if (install.exitCode !== 0) failed = fail('pytest extras install', install.stderr);
        }
      }

      const extraDeps = taskName ? EXTRA_TASK_DEPS[taskName] : undefined;
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
        // Mobly's _collect_process_tree uses macOS-specific `pgrep -P`, but the
        // DeepSWE verifier's mocked test expects Linux `ps --ppid` syntax. On
        // Darwin, force the Linux command so the mocked p2p test passes.
        if (taskName === 'mobly-grouped-test-barriers' && os.platform() === 'darwin') {
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

async function forceCheckout(projectPath: string, baseCommit: string): Promise<void> {
  const lockFile = path.join(projectPath, '.git', 'index.lock');
  const startedAt = Date.now();
  const maxWaitMs = 60_000;
  let attempt = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    attempt++;
    try {
      await execFileAsync('git', ['-C', projectPath, 'checkout', '-f', baseCommit], { timeout: 60000 });
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

async function ensureTaskDepsInstalled(projectPath: string, taskName: string): Promise<void> {
  const extraDeps = EXTRA_TASK_DEPS[taskName] as { pip?: string[]; npm?: string[] } | undefined;
  if (!extraDeps) return;

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
      console.warn(`[deepswe] Verifier dep install failed for ${taskName}: ${result.stderr}`);
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
      }
    }
  }
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

const PATH_TO_ENV: Record<string, string> = {
  '/logs/verifier': 'VERIFIER_DIR',
  '/logs/artifacts': 'ARTIFACTS_DIR',
  '/tests': 'TESTS_DIR',
  '/app': 'APP_DIR',
};

function applyShellReplacements(line: string): string {
  let replaced = line
    .replace(/\/logs\/verifier/g, '${VERIFIER_DIR}')
    .replace(/\/logs\/artifacts/g, '${ARTIFACTS_DIR}')
    .replace(/\/tests/g, '${TESTS_DIR}')
    .replace(/\/app\b/g, '${APP_DIR}')
    .replace(/\/app\//g, '${APP_DIR}/');
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
  taskName: string,
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
      const fallback = await runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, taskName, modelPatchArg);
      return fallback;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Docker build or runtime failure: try local verifier as fallback.
      const fallback = await runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, taskName, modelPatchArg);
      return {
        ...fallback,
        logs: `[Docker verifier failed, falling back to local]\n${message}\n\n${fallback.logs}`,
      };
    }
  }

  return runDeepSWEVerifierLocal(projectPath, taskDir, baseCommit, taskName, modelPatchArg);
}

async function runDeepSWEVerifierLocal(
  projectPath: string,
  taskDir: string,
  baseCommit: string,
  taskName: string,
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
  await forceCheckout(projectPath, baseCommit);

  // Re-install any task-specific verifier dependencies that may be missing from
  // a cached or reused project worktree.
  await ensureTaskDepsInstalled(projectPath, taskName);

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

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: projectPath,
    TESTS_DIR: copiedTestsDir,
    VERIFIER_DIR: verifierDir,
    ARTIFACTS_DIR: artifactsDir,
    // Kysely's .mocharc.js requires std-env@4 which is ESM-only.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-require-module`.trim(),
    // Suppress Node 22 experimental-warning noise that leaks into testem/child assertions.
    NODE_NO_WARNINGS: '1',
    // Kombu's SQS tests hard-code us-east-1 expectations; neutralise local AWS region.
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    // Pin a deterministic timezone so property tests (e.g. dateutil) do not fail
    // because of mismatched local-DST assumptions on the host.
    TZ: 'UTC',
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
        await installProjectDependencies(projectPath, language, dir, id);
      },
      evaluate: async (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        if (!commit) {
          return { passed: false, message: 'Missing base_commit_hash' };
        }
        const storedPatch = ctx.diffs
          .slice()
          .reverse()
          .find((d) => typeof d.patch === 'string' && d.patch.length > 0)?.patch;
        const { reward, logs, logFile, exitCode } = await runDeepSWEVerifier(
          ctx.projectPath,
          dir,
          commit,
          options.useDocker ?? false,
          id,
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
