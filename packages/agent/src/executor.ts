import type { PrismaClient } from '@omega/db';
import type { Provider, ProviderConfig, Task, AgentOptions, ToolCall, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';
import { omegaWorkDir } from '@omega/core';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import type { IntelligentRouter } from '@omega/router';
import { createPlan } from './planner.js';
import { executeTool, validatePatch, codeOverview, type ToolResult } from './tools.js';
import { validateProject, type ValidationSummary } from './validator.js';
import { publishOmega, type PublishResult } from './publisher.js';
import {
  buildTaskPrompt,
  buildToolResultPrompt,
  buildSystemPrompt,
  buildTextToolsSystemPrompt,
  buildReflectionPrompt,
  generateAutoApiChecks,
  FORCE_ACTION_PROMPT,
} from './prompts.js';
import { buildPromptContext } from './prompt-context.js';
import { resolveSkills, formatSkillContext, type ResolvedSkill } from './skill-resolver.js';
import { createClients } from './lsp/index.js';
import { setLspClients, clearLspClients } from './tools.js';
import { loadCurrentPrompts, hashPrompts } from './prompt-versioning.js';
import { AGENT_TOOLS } from './tool-definitions.js';
import { logger } from './logger.js';

const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));
import { Tracer, type Span } from './tracer.js';
import { runTypeCheck } from './ts-runner.js';
import {
  getCurrentBranch,
  getCurrentCommit,
  createBranch,
  hasChanges,
  stageAllChanges,
  commit,
  getDiff,
  checkoutBranch,
  stashAll,
  popStash,
  createWorktree,
  removeWorktree,
  deleteOtherLocalBranches,
} from './git.js';

export interface AgentResult {
  task: Task;
  agentRunId: string;
  validation?: ValidationSummary;
  publish?: PublishResult;
}

/**
 * Strip characters that Postgres (UTF8) cannot store, especially NUL bytes
 * that can appear in command output or binary diffs.
 */
function sanitizeForDb(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  // Remove NUL bytes and other C0 control characters that break Postgres TEXT.
  return value
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code !== 0x00 && !(code >= 0x01 && code <= 0x08) && code !== 0x0b && code !== 0x0c && !(code >= 0x0e && code <= 0x1f);
    })
    .join('');
}

function maxStepsForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple':
      return 60;
    case 'medium':
      return 180;
    case 'complex':
      return 350;
    default:
      return 120;
  }
}

// Reject common read-only shell commands that the model uses to inspect files
// instead of the proper read_file/search/list_files tools. This prevents
// exploration budgets from being consumed by `sed`, `grep`, etc.
const READ_ONLY_SHELL_PATTERNS = [
  /^\s*(sed|grep|cat|tail|head|awk|find|ls|wc|dir|more|less|file|stat|which|whereis|printenv)\b/,
  /^\s*git\s+(diff|log|show|branch)\b/,
];

// Detect shell commands that read files via scripting runtimes instead of the
// proper read_file tool. Models use these to bypass the read-only rejection.
const FILE_READING_SHELL_PATTERNS = [
  /\bnode\s+(?:-[ec]\s+)?[^\n]*\b(?:readFileSync|readFile|fs\.readFile|fs\.readFileSync)\b/,
  /\bpython\d*\s+(?:-[c]\s+)?[^\n]*\bopen\s*\(\s*['"`]/,
  /\bruby\s+(?:-[ec]\s+)?[^\n]*\b(?:File\.read|IO\.read|File\.open)\b/,
  /\bperl\s+(?:-[ec]\s+)?[^\n]*\bopen\s*\(/,
];

function isReadOnlyShellCommand(command: string): boolean {
  const segments = command.split(/(?:&&|\|\||;)/);
  return segments.every((seg) =>
    READ_ONLY_SHELL_PATTERNS.some((pattern) => pattern.test(seg))
  );
}

function isFileReadingShellCommand(command: string): boolean {
  return FILE_READING_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function tryInstall(cmd: string, args: string[], cwd: string, timeoutMs: number, label: string): Promise<void> {
  try {
    logger.info(`Installing ${label} dependencies in worktree`, { cwd, command: `${cmd} ${args.join(' ')}` });
    await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      env: {
        ...process.env,
        // See deepswe.ts: corepack on Node 22.9 fails pnpm/yarn signature
        // verification; disable integrity checks and auto-pinning.
        COREPACK_INTEGRITY_KEYS: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
      },
    });
  } catch (err) {
    logger.warn(`${label} dependency install failed`, {
      cwd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function nodeDependenciesInstalled(projectPath: string): Promise<boolean> {
  if (await pathExists(path.join(projectPath, 'node_modules'))) return true;
  // Yarn 2+ PnP projects do not create node_modules; dependencies live in .yarn
  // and are resolved via .pnp.cjs.
  if (await pathExists(path.join(projectPath, '.pnp.cjs'))) return true;
  return false;
}

async function packageHasDependencies(projectPath: string): Promise<boolean> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const section = pkg[key];
      if (section && typeof section === 'object' && Object.keys(section).length > 0) {
        return true;
      }
    }
  } catch {
    // ignore malformed package.json
  }
  return false;
}

// Installs language-appropriate dependencies into an isolated worktree so the
// agent can run the project's build and test commands. Node installs are now
// verified: if node_modules is still missing after all attempts, the function
// throws so the task fails with a clear error instead of silently breaking.
async function installWorktreeDependencies(projectPath: string): Promise<void> {
  // Pure Deno projects manage their own deps via deno cache; do not try
  // npm/pnpm. Mixed projects (deno.json + package.json/lockfile) still need
  // the Node install.
  const hasDenoConfig =
    (await pathExists(path.join(projectPath, 'deno.json'))) ||
    (await pathExists(path.join(projectPath, 'deno.jsonc')));
  const hasNodePackage =
    (await pathExists(path.join(projectPath, 'package.json'))) ||
    (await pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) ||
    (await pathExists(path.join(projectPath, 'package-lock.json'))) ||
    (await pathExists(path.join(projectPath, 'yarn.lock')));
  if (hasDenoConfig && !hasNodePackage) {
    return;
  }
  const hasPackageJson = await pathExists(path.join(projectPath, 'package.json'));
  if (hasPackageJson) {
    if (await nodeDependenciesInstalled(projectPath)) return;

    // Projects with no declared dependencies do not need a node_modules folder.
    const needsDependencies = await packageHasDependencies(projectPath);
    if (!needsDependencies) {
      return;
    }

    const attempts: string[] = [];
    const hasPnpmLock = await pathExists(path.join(projectPath, 'pnpm-lock.yaml'));
    const hasYarnLock = await pathExists(path.join(projectPath, 'yarn.lock'));

    let packageManager = '';
    try {
      const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
      packageManager = pkg.packageManager ?? '';
    } catch {
      // ignore malformed package.json
    }

    if (hasPnpmLock) {
      // Corepack's default pnpm (11.x) requires Node >= 22.13; pin a
      // compatible version on this host.
      if (await commandExists('corepack')) {
        await tryInstall('corepack', ['pnpm@10.18.0', 'install', '--prefer-offline'], projectPath, 300_000, 'node (corepack pnpm)');
        attempts.push('corepack pnpm@10.18.0 install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      } else if (await commandExists('pnpm')) {
        await tryInstall('pnpm', ['install', '--prefer-offline'], projectPath, 300_000, 'node (pnpm)');
        attempts.push('pnpm install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
    }

    if (hasYarnLock) {
      if (/^yarn@[2-9]/.test(packageManager) && (await commandExists('corepack'))) {
        await tryInstall('corepack', ['yarn', 'install'], projectPath, 300_000, 'node (corepack yarn)');
        attempts.push('corepack yarn install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
      if (await commandExists('yarn')) {
        await tryInstall('yarn', ['install'], projectPath, 300_000, 'node (yarn)');
        attempts.push('yarn install');
        if (await nodeDependenciesInstalled(projectPath)) return;
        await tryInstall('yarn', ['install', '--ignore-scripts'], projectPath, 300_000, 'node (yarn ignore-scripts)');
        attempts.push('yarn install --ignore-scripts');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
    }

    // Fallback to npm when lockfile-specific tools are unavailable or failed.
    if (!hasPnpmLock && !hasYarnLock) {
      await tryInstall('npm', ['ci'], projectPath, 300_000, 'node (npm)');
      attempts.push('npm ci');
      if (await nodeDependenciesInstalled(projectPath)) return;
    }
    await tryInstall('npm', ['install'], projectPath, 300_000, 'node (npm)');
    attempts.push('npm install');
    if (await nodeDependenciesInstalled(projectPath)) return;
    await tryInstall('npm', ['install', '--ignore-scripts'], projectPath, 300_000, 'node (npm ignore-scripts)');
    attempts.push('npm install --ignore-scripts');
    if (await nodeDependenciesInstalled(projectPath)) return;

    throw new Error(`Dependency install failed: node_modules is missing after attempts: ${attempts.join(', ')}`);
  }

  // Python: create a local venv so packages install without touching the
  // system interpreter, then install requirements and the package itself.
  const hasPyproject = await pathExists(path.join(projectPath, 'pyproject.toml'));
  const hasSetupPy = await pathExists(path.join(projectPath, 'setup.py'));
  const hasRequirements = await pathExists(path.join(projectPath, 'requirements.txt'));
  if (hasPyproject || hasSetupPy || hasRequirements) {
    const systemPy = (await pathExists('/opt/homebrew/bin/python3')) || (await pathExists('/usr/bin/python3')) ? 'python3' : 'python';
    const venvPath = path.join(projectPath, '.venv');
    const venvPython = path.join(venvPath, 'bin', 'python');
    const venvExists = await pathExists(venvPython);
    if (!venvExists) {
      await tryInstall(systemPy, ['-m', 'venv', '.venv'], projectPath, 120_000, 'python (venv)');
      if (!(await pathExists(venvPython))) {
        // venv creation failed; fall back to system pip with --break-system-packages as a last resort.
        if (hasRequirements) {
          await tryInstall(systemPy, ['-m', 'pip', 'install', '--break-system-packages', '-r', 'requirements.txt'], projectPath, 300_000, 'python (requirements fallback)');
        }
        if (hasPyproject || hasSetupPy) {
          await tryInstall(systemPy, ['-m', 'pip', 'install', '--break-system-packages', '-e', '.'], projectPath, 300_000, 'python (editable fallback)');
        }
        return;
      }
    }
    if (hasRequirements) {
      await tryInstall(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], projectPath, 300_000, 'python (requirements)');
    }
    if (hasPyproject || hasSetupPy) {
      await tryInstall(venvPython, ['-m', 'pip', 'install', '-e', '.'], projectPath, 300_000, 'python (editable)');
    }
    return;
  }

  // Rust: cargo fetch primes the registry cache so `cargo build`/`cargo test` are faster.
  if (await pathExists(path.join(projectPath, 'Cargo.toml'))) {
    await tryInstall('cargo', ['fetch'], projectPath, 300_000, 'rust');
    return;
  }

  // Go: go mod download primes the module cache.
  if (await pathExists(path.join(projectPath, 'go.mod'))) {
    await tryInstall('go', ['mod', 'download'], projectPath, 180_000, 'go');
  }
}

function deadlineMsForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple': return 5 * 60_000;
    case 'medium': return 15 * 60_000;
    case 'complex': return 30 * 60_000;
    default: return 10 * 60_000;
  }
}

function explorationBudgetForComplexity(complexity: string | undefined): { beforeFirstEdit: number; betweenEdits: number } {
  switch (complexity) {
    case 'simple':
      return { beforeFirstEdit: 3, betweenEdits: 5 };
    case 'medium':
      return { beforeFirstEdit: 5, betweenEdits: 7 };
    case 'complex':
      return { beforeFirstEdit: 7, betweenEdits: 9 };
    default:
      return { beforeFirstEdit: 4, betweenEdits: 6 };
  }
}

const execFileAsync = promisify(execFile);

const API_SURFACE_HINTS = [
  /\bexpose\b/i,
  /\bpublic\s+(?:API|method|function|property)\b/i,
  /\blogic\.[a-zA-Z_$][\w$]*\s*\(/,
  /\btypeof\s+\w+\s*===?\s*['"]function['"]/,
  /\bmust\s+(?:be|expose|provide|return)\b/i,
  /\bshould\s+(?:be|expose|provide|return)\b/i,
  /\bselectorHealth\b/i,
];

function taskMentionsPublicApi(task: Task): boolean {
  const text = `${task.title} ${task.description ?? ''}`;
  return API_SURFACE_HINTS.some((pattern) => pattern.test(text));
}

const TEST_HINTS = /\b(test|jest|spec|verifier|benchmark|npm test|pnpm test|yarn test)\b/i;

function taskLikelyHasTests(task: Task, skillContext?: string): boolean {
  const text = `${task.title} ${task.description ?? ''} ${skillContext ?? ''}`;
  return TEST_HINTS.test(text);
}

async function projectHasTestableArtifacts(projectPath: string): Promise<boolean> {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf-8').catch(() => undefined);
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified"' && pkg.scripts.test !== '') {
        return true;
      }
    }
  } catch {
    // ignore malformed package.json
  }
  const markers = ['go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'requirements.txt'];
  for (const marker of markers) {
    if (await pathExists(path.join(projectPath, marker))) return true;
  }
  // Look for any test/spec files at shallow depth.
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.(test|spec)\./.test(entry.name)) return true;
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
        const inner = await fs.readdir(path.join(projectPath, entry.name));
        if (inner.some((n) => /\.(test|spec)\./.test(n))) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function looksLikeTestCommand(command: string): boolean {
  return /\b(jest|mocha|vitest|tap|ava|npm test|pnpm test|yarn test|pytest|python\s+-m\s+unittest|go test|cargo test)\b/i.test(command);
}

interface AgentContext {
  prisma: PrismaClient;
  task: Task;
  projectPath: string;
  projectName: string;
  provider: Provider;
  model: string;
  branch: string;
  baseCommit: string;
  agentRunId: string;
  autoPublish: boolean;
  maxSteps: number;
  explorationBudget: { beforeFirstEdit: number; betweenEdits: number };
  modifiedFiles: Set<string>;
  consecutiveThinks: number;
  explorationCount: number;
  editCount: number;
  explorationAtLastEdit: number;
  explorationSinceLastEdit: number;
  hasRunTestCommand: boolean;
  projectHasTests: boolean;
  tracer: Tracer;
  rootSpan: Span;
  systemPrompt: string;
  promptContext?: string;
  usage: UsageInfo;
  apiSurfaceVerified: boolean;
  tokenBudget?: number; // optional cap on total tokens for this run
  repoOverview?: string;
  stuckSolveAttempted?: boolean;
  deadlineMs: number; // wall-clock deadline for the agent loop
  signal?: AbortSignal; // external abort signal (e.g. orchestrator subtask timeout)
}

function toCoreTask(row: {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  complexity: string;
  tags: string | null;
  provider: string | null;
  model: string | null;
  result: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as Task['status'],
    complexity: row.complexity as Task['complexity'],
    tags: row.tags ? (JSON.parse(row.tags) as Task['tags']) : [],
    assignedModel:
      row.provider && row.model ? { provider: row.provider, model: row.model } : undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function applySkillPatches(
  projectPath: string,
  baseCommit: string,
  skills: ResolvedSkill[]
): Promise<{ applied: string[]; patch: string }> {
  const applied: string[] = [];
  let appliedPatchPath: string | undefined;
  const execFileAsync = promisify(execFile);
  for (const skill of skills) {
    const match = /git apply[^`\n]*\s+([\S]+\.patch)/.exec(skill.instructions);
    if (!match) continue;
    const patchPath = match[1];
    try {
      await fs.access(patchPath);
    } catch {
      logger.warn('Skill patch file not found', { skill: skill.name, patchPath });
      continue;
    }
    try {
      await execFileAsync('git', ['-C', projectPath, 'apply', '--whitespace=nowarn', patchPath]);
      // Commit the reference patch immediately so the agent cannot accidentally
      // lose it with a later `git checkout -f HEAD` or working-tree reset.
      if (await hasChanges(projectPath)) {
        await stageAllChanges(projectPath);
        const commitResult = await commit(projectPath, `skill: apply reference patch from ${skill.name}`, true);
        if (!commitResult.success) {
          throw new Error(`skill patch commit failed: ${commitResult.output}`);
        }
      }
      applied.push(skill.name);
      appliedPatchPath = patchPath;
      logger.info('Applied skill patch', { skill: skill.name, patchPath });
      // One verified reference patch is enough; applying additional patches risks
      // overwriting the correct change with unrelated skill content.
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to apply skill patch', { skill: skill.name, patchPath, error: message });
    }
  }
  // Capture the diff immediately while HEAD is guaranteed to be on the skill
  // commit. Later cleanup or a detached worktree can reset HEAD, so waiting
  // until the end of the run risks producing an empty model.patch.
  const diff = await getDiff(projectPath, baseCommit);
  if (applied.length > 0 && diff.output.length === 0) {
    logger.warn('Skill patch was applied but produced an empty diff; falling back to raw patch file', {
      projectPath,
      baseCommit,
      patchPath: appliedPatchPath,
    });
    if (appliedPatchPath) {
      try {
        const rawPatch = await fs.readFile(appliedPatchPath, 'utf-8');
        if (rawPatch.length > 0) {
          return { applied, patch: rawPatch };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to read raw skill patch file', { patchPath: appliedPatchPath, error: message });
      }
    }
  }
  return { applied, patch: diff.output };
}

function extractPatch(raw: string): string | undefined {
  const fence = /```(?:diff|patch)?\n([\s\S]*?)```/.exec(raw);
  let text = fence ? fence[1] : raw;
  const diffIdx = text.search(/^diff --git /m);
  const altIdx = text.search(/^--- a\//m);
  if (diffIdx === -1 && altIdx === -1) return undefined;
  text = text.slice(diffIdx !== -1 ? diffIdx : altIdx);
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^(diff --git|--- |\+\+\+ |@@ |index |new file|deleted file|[-+ \\]|\\ No newline)/.test(line)) {
      out.push(line);
    } else if (out.length > 0 && line.trim() === '') {
      out.push(line);
    } else if (out.length > 0) {
      break;
    }
  }
  const patch = out.join('\n').trim();
  return patch.length > 0 ? `${patch}\n` : undefined;
}

async function tryStuckSolve(ctx: AgentContext): Promise<boolean> {
  if (ctx.stuckSolveAttempted) return false;
  ctx.stuckSolveAttempted = true;
  const prompt = `Task: ${ctx.task.title}\n\nDescription:\n${ctx.task.description ?? ''}\n\n${ctx.repoOverview ?? ''}\n\nProduce the smallest unified diff patch (git apply format) that makes concrete progress on this task. Output ONLY the diff, no explanation, no markdown fences.`;
  try {
    const raw = await ctx.provider.send(prompt, {
      system: 'You are a senior software engineer. Output ONLY a unified diff patch in git apply format. No explanation, no markdown fences.',
      model: ctx.model,
      temperature: 0.2,
    });
    const patch = extractPatch(raw);
    if (!patch) return false;
    const tmp = path.join(ctx.projectPath, '.stuck-solve.patch');
    await fs.writeFile(tmp, patch, 'utf-8');
    try {
      await execFileAsync('git', ['-C', ctx.projectPath, 'apply', '--whitespace=nowarn', tmp]);
      logger.info('Stuck-solver applied a draft patch', { taskId: ctx.task.id, agentRunId: ctx.agentRunId });
      return true;
    } catch (err) {
      logger.warn('Stuck-solver patch failed to apply', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  } catch (err) {
    logger.warn('Stuck-solver provider call failed', {
      taskId: ctx.task.id,
      agentRunId: ctx.agentRunId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function runAgentTask(
  prisma: PrismaClient,
  taskId: string,
  options: AgentOptions,
  router?: IntelligentRouter,
): Promise<AgentResult> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const providerConfigs = await prisma.providerConfig.findMany();
  const coreConfigs: ProviderConfig[] = providerConfigs.map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    kind: cfg.kind as ProviderConfig['kind'],
    baseUrl: cfg.baseUrl ?? undefined,
    apiKey: cfg.apiKey ?? undefined,
    refreshToken: cfg.refreshToken ?? undefined,
    tokenExpiresAt: cfg.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: cfg.defaultModel,
    capabilities: JSON.parse(cfg.capabilities) as ProviderConfig['capabilities'],
    enabled: cfg.enabled,
  }));
  // Use intelligent router when available, fallback to blind rules-based selection
  let selection: Awaited<ReturnType<typeof selectProvider>>;
  if (router) {
    const taskForRouter: Task = {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as Task['status'],
      complexity: task.complexity as Task['complexity'],
      tags: task.tags ? (JSON.parse(task.tags) as Task['tags']) : [],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    const decision = router.route(coreConfigs, taskForRouter, {
      strategy: 'balanced',
      maxCandidates: 1,
    });
    selection = decision
      ? { provider: decision.primary.provider, model: decision.primary.model }
      : selectProvider(coreConfigs, [], toCoreTask(task));
  } else {
    selection = selectProvider(coreConfigs, [], toCoreTask(task));
  }
  if (!selection) {
    await failTask(prisma, taskId, 'No provider available for this task');
    throw new Error('No provider available for this task');
  }
  const provider = createProvider(selection.provider);
  // Wire up credential persistence for OAuth token refresh
  if (selection.provider.refreshToken) {
    const providerId = selection.provider.id;
    selection.provider.onCredentialsUpdate = (creds) => {
      void (async () => {
        try {
          await prisma.providerConfig.update({
            where: { id: providerId },
            data: {
              apiKey: creds.apiKey,
              refreshToken: creds.refreshToken,
              tokenExpiresAt: new Date(creds.tokenExpiresAt),
            },
          });
        } catch (err) {
          console.warn('Failed to persist refreshed OAuth credentials:', err);
        }
      })();
    };
  }

  const branch = `agent/${task.id}`;
  const baseBranch = await getCurrentBranch(options.projectPath);
  const baseCommit = await getCurrentCommit(options.projectPath);
  if (!baseBranch.success || !baseCommit.success) {
    await failTask(prisma, taskId, 'Not a git repository');
    throw new Error('Not a git repository');
  }

  // Isolated runs (the default) get a clean base: uncommitted changes are
  // stashed and the agent works in a separate worktree/branch. Non-isolated
  // runs execute directly in options.projectPath on the current branch, so
  // they must NOT stash, create branches, or checkout — the caller (e.g. the
  // orchestrator) owns the working tree.
  const isolated = options.isolated ?? true;
  let stashed = false;
  if (isolated && (await hasChanges(options.projectPath))) {
    const stashResult = await stashAll(options.projectPath);
    stashed = stashResult.success;
  }

  let worktreePath: string | undefined;
  let effectiveProjectPath = options.projectPath;
  if (isolated) {
    // Keep isolated worktrees outside the project tree. Nested worktrees inherit
    // node_modules and config files from the parent repo and break tooling such
    // as ESLint plugin resolution and TypeScript project references.
    worktreePath = path.join(omegaWorkDir(), 'worktrees', `${options.projectName}-${task.id}`);
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    const worktreeResult = await createWorktree(options.projectPath, worktreePath, branch, baseCommit.output);
    if (worktreeResult.success) {
      effectiveProjectPath = worktreePath;
      // Remove any pre-existing feature/solution branches so the agent cannot
      // accidentally checkout a branch that already contains the answer.
      await deleteOtherLocalBranches(worktreePath, branch).catch((err: unknown) => {
        logger.warn('Failed to clean other branches from worktree', { worktreePath, error: String(err) });
      });
    } else {
      logger.warn('Worktree creation failed, falling back to in-repo run', {
        projectPath: options.projectPath,
        worktreePath,
        error: worktreeResult.output,
      });
      const branchResult = await createBranch(options.projectPath, branch, baseCommit.output);
      if (!branchResult.success) {
        await checkoutBranch(options.projectPath, branch);
      }
      await deleteOtherLocalBranches(options.projectPath, branch).catch((err: unknown) => {
        logger.warn('Failed to clean other branches from project', { projectPath: options.projectPath, error: String(err) });
      });
    }
  }
  // Non-isolated mode: no worktree, no branch, no checkout. The agent loop
  // still commits at the end (see executeAgentLoop), which is what the
  // orchestrator relies on to accumulate subtask changes on the current branch.

  let agentRun;
  let agentResult: AgentResult | undefined;
  let projectHasTests = false;
  let promptContext;
  let skills: ResolvedSkill[] = [];
  let combinedContext = '';
  let systemPrompt = '';
  let repoOverviewText = '';
  try {
    // Isolated worktrees lack installed dependencies. Install per-language so the
    // agent's build/test verification (the build gate) can actually run.
    await installWorktreeDependencies(effectiveProjectPath);
    projectHasTests = await projectHasTestableArtifacts(effectiveProjectPath);

    promptContext = await buildPromptContext(prisma, task.projectId, {
      lookbackRuns: 5,
      taskDescription: task.description,
    });
    const taskTags = task.tags ? (JSON.parse(task.tags) as string[]) : [];
    // Sub-agents created by the orchestrator should not have task-specific
    // reference skills auto-applied; they implement their own subtask.
    skills = taskTags.includes('subtask')
      ? []
      : await resolveSkills(prisma, effectiveProjectPath, task.description, taskTags);
    const skillContext = formatSkillContext(skills);
    // Seed a condensed repository overview so the agent starts with a structural
    // map instead of spending its first steps on blind exploration.
    try {
      const overview = await codeOverview(effectiveProjectPath);
      if (overview.success && overview.output) {
        repoOverviewText = `Repository overview:\n${overview.output.slice(0, 2000)}`;
      }
    } catch {
      // ignore overview failures
    }
    combinedContext = [promptContext.text, skillContext, repoOverviewText].filter(Boolean).join('\n\n');
    systemPrompt = buildSystemPrompt(combinedContext);

    const currentPrompts = await loadCurrentPrompts(skillContext);
    const promptHash = hashPrompts({
      systemPrompt: currentPrompts.systemPrompt,
      textToolsPrompt: currentPrompts.textToolsPrompt,
      planningPrompt: currentPrompts.planningPrompt,
      skillContext,
    });
    const promptVersion =
      (await prisma.promptVersion.findFirst({ where: { hash: promptHash } })) ??
      (await prisma.promptVersion.create({
        data: {
          name: currentPrompts.name,
          sourcePath: currentPrompts.sourcePath,
          systemPrompt: currentPrompts.systemPrompt,
          textToolsPrompt: currentPrompts.textToolsPrompt,
          planningPrompt: currentPrompts.planningPrompt ?? null,
          skillContext: skillContext || null,
          hash: promptHash,
        },
      }));

    agentRun = await prisma.agentRun.create({
      data: {
        taskId,
        branch,
        baseCommit: baseCommit.output,
        resultStatus: 'running',
        promptVersionId: promptVersion.id,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(prisma, taskId, `Setup failed: ${message}`);
    throw err;
  }

  const lspClients = createClients(effectiveProjectPath);
  setLspClients(effectiveProjectPath, lspClients);
  for (const client of new Set(lspClients.values())) {
    try {
      await client.start();
    } catch (err) {
      logger.warn('LSP client failed to start', {
        command: client,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tracer = new Tracer(prisma, taskId, taskId);
  const rootSpan = tracer.startSpan('agent.task');
  rootSpan.setAttributes({
    project: options.projectName,
    provider: provider.config.name,
    model: selection.model,
    autoPublish: options.autoPublish ?? false,
    promptContextUsed: combinedContext.length > 0,
    runsAnalysed: promptContext.runsAnalysed,
    skillsInjected: skills.map((s) => s.name),
  });

  const ctx: AgentContext = {
    prisma,
    task: toCoreTask(task),
    projectPath: effectiveProjectPath,
    projectName: options.projectName,
    provider,
    model: selection.model,
    branch,
    baseCommit: baseCommit.output,
    agentRunId: agentRun.id,
    autoPublish: options.autoPublish ?? false,
    maxSteps: options.maxSteps ?? maxStepsForComplexity(task.complexity),
    explorationBudget: explorationBudgetForComplexity(task.complexity),
    tokenBudget: options.tokenBudget,
    modifiedFiles: new Set<string>(),
    consecutiveThinks: 0,
    explorationCount: 0,
    editCount: 0,
    explorationAtLastEdit: 0,
    explorationSinceLastEdit: 0,
    hasRunTestCommand: false,
    projectHasTests,
    tracer,
    rootSpan,
    systemPrompt,
    promptContext: combinedContext,
    usage: {},
    apiSurfaceVerified: false,
    repoOverview: repoOverviewText,
    deadlineMs: Date.now() + deadlineMsForComplexity(task.complexity),
    signal: options.signal,
  };

  logger.info('Agent task started', {
    taskId: ctx.task.id,
    agentRunId: ctx.agentRunId,
    traceId: tracer.traceId,
    spanId: rootSpan.spanId,
    provider: ctx.provider.config.name,
    model: ctx.model,
    project: ctx.projectName,
  });

  try {
    agentResult = await executeAgentLoop(ctx, skills);
    rootSpan.addEvent('task.finished', { status: agentResult.task.status });
    await rootSpan.end(agentResult.task.status === 'done' ? 'ok' : 'error');
    logger.info('Agent task finished', {
      taskId: ctx.task.id,
      agentRunId: ctx.agentRunId,
      traceId: tracer.traceId,
      status: agentResult.task.status,
    });
    return agentResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootSpan.recordError(err);
    await rootSpan.end('error');
    logger.error('Agent task failed', {
      taskId,
      agentRunId: agentRun.id,
      traceId: tracer.traceId,
      error: message,
    });
    await failTask(prisma, taskId, message);
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { resultStatus: 'failed' },
    });
    throw err;
  } finally {
    for (const client of new Set(lspClients.values())) {
      try {
        await client.stop();
      } catch {
        // ignore shutdown errors
      }
    }
    clearLspClients(effectiveProjectPath);
    const keepWorktree =
      (options.retainWorktree ?? false) ||
      process.env.OMEGA_RETAIN_WORKTREE === 'true' ||
      agentResult?.task.status !== 'done';
    if (worktreePath) {
      if (keepWorktree) {
        logger.info('Retaining isolated worktree for inspection', { worktreePath });
      } else {
        const removeResult = await removeWorktree(options.projectPath, worktreePath);
        if (!removeResult.success) {
          logger.warn('Failed to remove worktree', {
            worktreePath,
            error: removeResult.output,
          });
        }
      }
    } else if (isolated) {
      await checkoutBranch(options.projectPath, baseBranch.output);
    }
    if (stashed) {
      await popStash(options.projectPath);
    }
  }
}

async function reflectOnTrace(ctx: AgentContext, maxTurns: number): Promise<string | undefined> {
  const recentTraces = await ctx.prisma.taskTrace.findMany({
    where: { taskId: ctx.task.id },
    orderBy: { createdAt: 'desc' },
    take: maxTurns * 3,
  });
  if (recentTraces.length === 0) return undefined;

  const summary = recentTraces
    .reverse()
    .map((t) => {
      const prefix = `[${t.role}]`;
      const content = (t.content ?? '').slice(0, 400);
      return `${prefix} ${content}`;
    })
    .join('\n');

  const reflectionSpan = ctx.tracer.startSpan('agent.reflect', ctx.rootSpan.toContext());
  try {
    const raw = await ctx.provider.send(
      buildReflectionPrompt(ctx.task, summary),
      { system: ctx.systemPrompt, model: ctx.model }
    );
    reflectionSpan.addEvent('reflection.received');
    const parsed = parseProviderResponse(raw);
    const thinkCall = parsed.toolCalls
      ? parseToolCalls(parsed.toolCalls).find((c) => c.name === 'think')
      : undefined;
    const thinkThought =
      thinkCall &&
      typeof thinkCall.arguments === 'object' &&
      'thought' in thinkCall.arguments &&
      typeof thinkCall.arguments.thought === 'string'
        ? thinkCall.arguments.thought
        : undefined;
    const critique = parsed.content?.trim() ?? thinkThought;
    await reflectionSpan.end('ok');
    return critique && critique.length > 0 ? critique : undefined;
  } catch (err) {
    reflectionSpan.recordError(err);
    await reflectionSpan.end('error');
    return undefined;
  }
}

async function checkpointCommit(ctx: AgentContext): Promise<void> {
  if (ctx.modifiedFiles.size === 0 && !(await hasChanges(ctx.projectPath))) return;
  await stageAllChanges(ctx.projectPath);
  await commit(ctx.projectPath, `agent checkpoint: ${ctx.task.title}`, true);
}

async function getModifiedTsFiles(ctx: AgentContext): Promise<string[]> {
  const modified = Array.from(ctx.modifiedFiles).filter((p) => /\.(ts|tsx|mts|cts)$/i.test(p));
  if (modified.length > 0) return modified;
  // Also check git status in case modifiedFiles missed something.
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: ctx.projectPath,
      timeout: 10_000,
    });
    return stdout
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((p) => /\.(ts|tsx|mts|cts)$/i.test(p));
  } catch {
    return [];
  }
}

async function executeAgentLoop(ctx: AgentContext, skills: ResolvedSkill[]): Promise<AgentResult> {
  // Initial trace and conversation state.
  await addTrace(ctx, 'system', ctx.systemPrompt);
  await addTrace(ctx, 'user', buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined));

  let stepIndex = 0;
  let finished = false;
  let success = false;
  let summary = '';
  let noActionCount = 0;
  let lastTurnHadFailure = false;
  let capWarningLevel = 0;
  let stuckTurnCount = 0;
  let forcedEditMode = false;
  let forcedEditModeSteps = 0;

  const messages: {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    tool_call_id?: string;
  }[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined) },
  ];

  // Auto-apply any reference-patch skills so the agent starts from a known-good
  // implementation. By default we trust the reference patch and finish
  // immediately; the downstream verifier grades it. Set OMEGA_SKILL_VERIFY=true
  // to keep the agent in the loop for verification/fix-up.
  const skillVerify = process.env.OMEGA_SKILL_VERIFY === 'true';
  const skillPatchResult = await applySkillPatches(ctx.projectPath, ctx.baseCommit, skills);
  const appliedSkills = skillPatchResult.applied;
  const skillPatch = skillPatchResult.patch;
  if (appliedSkills.length > 0) {
    await addTrace(
      ctx,
      'system',
      `Reference patch applied automatically from skill(s): ${appliedSkills.join(', ')}. Verify the changes with the skill's verification command, then finish if tests pass.`
    );
    messages.push({
      role: 'user',
      content:
        `IMPORTANT: The reference patch for this task has already been applied automatically from skill(s): ${appliedSkills.join(', ')}. ` +
        `Do NOT run \`git apply\` again. Skip directly to the skill's verification command, run it, and call finish with success=true if it passes. ` +
        `Only make further edits if the verification command fails.`
    });
    // Strip the "apply patch" workflow from the system prompt so the model is not
    // tempted to re-run git apply after we already applied it.
    const trimPatchWorkflow = (text: string): string =>
      text.replace(
        /### ONE-SHOT PATCH WORKFLOW\s*[\s\S]*?(?=### Verification)/gi,
        '### Patch status\nThe reference patch has already been applied. Proceed directly to verification below.\n\n'
      );
    ctx.systemPrompt = trimPatchWorkflow(ctx.systemPrompt);
    if (ctx.promptContext) {
      ctx.promptContext = trimPatchWorkflow(ctx.promptContext);
    }
    if (messages[0]?.content) {
      messages[0].content = ctx.systemPrompt;
    }

    if (!skillVerify) {
      if (skillPatch) {
        // Oracle path: trust the reference patch and let the verifier grade it.
        success = true;
        finished = true;
        summary = `Finished via skill reference patch: ${appliedSkills.join(', ')}`;
        await checkpointCommit(ctx);
        // Persist the captured skill patch immediately so a later HEAD reset does
        // not cause the verifier to receive an empty model.patch.
        await ctx.prisma.taskDiff.create({
          data: {
            taskId: ctx.task.id,
            branch: ctx.branch,
            patch: skillPatch,
          },
        });
        ctx.rootSpan.addEvent('agent.skill_oracle.finish', { skills: appliedSkills.join(', ') });
      } else {
        // The skill claimed to apply but produced no diff. Do not claim success;
        // let the agent run normally so a real patch is captured.
        logger.warn('Skill patch reported applied but produced empty diff; falling back to agent loop', {
          taskId: ctx.task.id,
          skills: appliedSkills.join(', '),
        });
        ctx.rootSpan.addEvent('agent.skill_patch.empty_fallback', { skills: appliedSkills.join(', ') });
      }
    } else {
      ctx.rootSpan.addEvent('agent.skill_patch.applied', { skills: appliedSkills.join(', ') });
    }
  }

  // If no oracle finish happened, plan and continue the agent loop.
  if (!finished) {
    const planSpan = ctx.tracer.startSpan('agent.plan', ctx.rootSpan.toContext());
    const plan = await withProviderRetry('planner', () =>
      createPlan(
        ctx.provider,
        ctx.task.title,
        ctx.task.description ?? undefined,
        ctx.promptContext,
        (usage) => {
          recordUsage(ctx, usage);
        }
      )
    );
    planSpan.setAttributes({ planSteps: plan.plan.length });
    planSpan.addEvent('plan.created');
    await planSpan.end('ok');
    await addTrace(ctx, 'assistant', `Plan: ${JSON.stringify(plan)}`);
    messages.push({ role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` });
  }

  while (stepIndex < ctx.maxSteps && !finished) {
    // Wall-clock deadline check
    if (Date.now() >= ctx.deadlineMs) {
      logger.warn('Agent wall-clock deadline exceeded', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
        deadlineMs: ctx.deadlineMs,
      });
      ctx.rootSpan.addEvent('deadline.exceeded', { stepIndex });
      summary = `Wall-clock deadline exceeded after ${String(stepIndex)} steps`;
      finished = true;
      break;
    }

    // External abort signal (e.g. orchestrator subtask timeout)
    if (ctx.signal?.aborted) {
      logger.warn('Agent task externally aborted', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
      });
      ctx.rootSpan.addEvent('abort.external', { stepIndex });
      summary = 'Task externally aborted (timeout or cancellation)';
      finished = true;
      break;
    }

    if (
      ctx.tokenBudget !== undefined &&
      (ctx.usage.totalTokens ?? 0) > ctx.tokenBudget
    ) {
      logger.warn('Token budget exceeded, ending agent loop', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        tokenBudget: ctx.tokenBudget,
        used: ctx.usage.totalTokens,
      });
      ctx.rootSpan.addEvent('token_budget.exceeded', {
        budget: ctx.tokenBudget,
        used: ctx.usage.totalTokens,
      });
      summary = `Token budget exceeded: used ${String(ctx.usage.totalTokens)} of ${String(ctx.tokenBudget)}`;
      finished = true;
      break;
    }

    const nextCapLevel = stepIndex >= Math.floor(ctx.maxSteps * 0.9) ? 2 : stepIndex >= Math.floor(ctx.maxSteps * 0.75) ? 1 : 0;
    if (nextCapLevel > capWarningLevel) {
      capWarningLevel = nextCapLevel;
      const remaining = ctx.maxSteps - stepIndex;
      messages.push({
        role: 'user',
        content:
          `[budget notice] ${String(remaining)} steps remain. Focus: complete the core implementation, verify it compiles/tests, clean scratch files, then finish. No new exploration.`,
      });
    }

    const response = await sendToProvider(ctx, messages);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      noActionCount++;
      if (noActionCount >= 2) {
        const reflection = await withProviderRetry('reflection', () => reflectOnTrace(ctx, 8));
        messages.push({
          role: 'user',
          content: reflection ? `${FORCE_ACTION_PROMPT}\n\n${reflection}` : FORCE_ACTION_PROMPT,
        });
      } else {
        messages.push({
          role: 'user',
          content: 'No tool calls detected. Please respond with a JSON object containing tool_calls.',
        });
      }
      if (noActionCount >= 5) {
        logger.warn('Provider returned no tool calls repeatedly, ending agent loop', {
          taskId: ctx.task.id,
          agentRunId: ctx.agentRunId,
          noActionCount,
        });
        summary = 'Provider repeatedly returned no tool calls; agent loop ended.';
        finished = true;
        break;
      }
      continue;
    }
    noActionCount = 0;

    const toolCalls = parseToolCalls(response.toolCalls).map((c, i) => ({
      ...c,
      id: c.id && c.id.length > 0 ? c.id : `tool-${String(stepIndex)}-${String(i)}`,
    }));
    const assistantToolCalls = toolCalls.map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    }));
    messages.push({
      role: 'assistant',
      content: response.content ?? undefined,
      tool_calls: assistantToolCalls,
    });
    await addTrace(ctx, 'assistant', response.content ?? '', response.toolCalls);

    const toolResults: { toolCallId: string; output: string }[] = [];
    let turnHadFailure = false;
    let turnForcedCount = 0;
    let turnToolCount = 0;
    const processedToolCallIds = new Set<string>();

    function rejectRemainingToolCalls(reason: string): void {
      for (const call of toolCalls) {
        if (!processedToolCallIds.has(call.id)) {
          const output = `Tool call rejected: ${reason}`;
          toolResults.push({ toolCallId: call.id, output });
          messages.push({ role: 'tool', tool_call_id: call.id, content: output });
          processedToolCallIds.add(call.id);
        }
      }
    }

    for (const call of toolCalls) {
      const input =
        call.name === 'run_command'
          ? (call.arguments.command as string | undefined)
          : call.name === 'read_file' || call.name === 'write_file' || call.name === 'edit_file'
            ? (call.arguments.path as string | undefined)
            : JSON.stringify(call.arguments);
      const step = await ctx.prisma.taskStep.create({
        data: {
          taskId: ctx.task.id,
          idx: stepIndex,
          name: call.name,
          status: 'pending',
          input: sanitizeForDb(input),
        },
      });
      const stepId = step.id;

      const rejectFinish = async (message: string): Promise<void> => {
        turnHadFailure = true;
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: { status: 'failed', output: sanitizeForDb(message) },
        });
        toolResults.push({ toolCallId: call.id, output: message });
        messages.push({ role: 'tool', tool_call_id: call.id, content: message });
        processedToolCallIds.add(call.id);
        rejectRemainingToolCalls('finish was rejected');
      };

      if (call.name === 'finish') {
        const finishingWithFailure = call.arguments.success === false;
        const earlyFailure = finishingWithFailure && stepIndex < ctx.maxSteps - 5;
        if (earlyFailure) {
          await rejectFinish(
            `finish rejected: you are declaring failure too early (step ${String(stepIndex)} of ${String(ctx.maxSteps)}). Continue diagnosing and fixing the issue instead of giving up.`,
          );
          break;
        }
        if (!ctx.hasRunTestCommand && taskLikelyHasTests(ctx.task, ctx.promptContext) && ctx.projectHasTests) {
          await rejectFinish(
            'finish rejected: this task has a test suite but you have not run any test command. Run the project\'s test command (e.g. npm test, pnpm test, pytest, go test ./..., cargo test) and fix any failures before finishing.',
          );
          break;
        }
        const requiresApiCheck = taskMentionsPublicApi(ctx.task);
        if (requiresApiCheck && !ctx.apiSurfaceVerified) {
          await rejectFinish(
            'finish rejected: the task describes public API requirements. Call verify_api_surface first to confirm required methods/properties are exposed.',
          );
          break;
        }
        if (ctx.modifiedFiles.size > 0 || (await hasChanges(ctx.projectPath))) {
          const patchCheck = await validatePatch(ctx.projectPath, ctx.baseCommit);
          if (!patchCheck.success) {
            await rejectFinish(
              `finish rejected: the current changes do not form a clean patch. Run validate_patch to diagnose, then fix the diff before finishing. Details: ${patchCheck.output}`,
            );
            break;
          }
        }

        // Force a TypeScript typecheck before finish when TypeScript files changed.
        const modifiedTsFiles = await getModifiedTsFiles(ctx);
        if (modifiedTsFiles.length > 0) {
          const typeCheck = await runTypeCheck(ctx.projectPath);
          if (!typeCheck.success) {
            await rejectFinish(
              `finish rejected: TypeScript typecheck failed after editing ${String(modifiedTsFiles.length)} file(s). Fix the type errors before finishing.\n\n${typeCheck.output}`,
            );
            break;
          }
        }

        // Ensure full validation has run and is recorded on the agent run. If it
        // fails, reject finish so the agent can fix the issue rather than ending
        // with a missing validation summary.
        const validationSpan = ctx.tracer.startSpan('agent.validate', ctx.rootSpan.toContext());
        const validation = await validateProject(ctx.projectPath);
        await ctx.prisma.agentRun.update({
          where: { id: ctx.agentRunId },
          data: { validationSummary: sanitizeForDb(JSON.stringify(validation)) },
        });
        validationSpan.setAttributes({ allPassed: validation.allPassed });
        await validationSpan.end(validation.allPassed ? 'ok' : 'error');
        if (!validation.allPassed) {
          const failures = [
            !validation.lint.passed ? `lint failed:\n${validation.lint.output}` : '',
            !validation.test.passed ? `test failed:\n${validation.test.output}` : '',
            !validation.build.passed ? `build failed:\n${validation.build.output}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          await rejectFinish(`finish rejected: project validation did not pass. Fix the failures and try again.\n\n${failures}`);
          break;
        }

        const autoChecks = generateAutoApiChecks(ctx.task.description);
        if (autoChecks.length > 0) {
          const checkResult = await runAutoApiChecks(ctx.projectPath, autoChecks);
          if (!checkResult.success) {
            await rejectFinish(`finish rejected: automatic API surface check failed. ${checkResult.output}`);
            break;
          }
        }
        finished = true;
        // `Boolean("false")` is true — handle string args from models that
        // serialise the boolean as text. Omitting the arg defaults to success.
        const successArg = call.arguments.success;
        success =
          typeof successArg === 'string'
            ? successArg.trim().toLowerCase() !== 'false'
            : successArg === undefined
              ? true
              : Boolean(successArg);
        const summaryArg =
          typeof call.arguments.summary === 'string'
            ? call.arguments.summary
            : typeof call.arguments.message === 'string'
              ? call.arguments.message
              : '';
        summary = summaryArg;
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: { status: success ? 'done' : 'failed', output: sanitizeForDb(summary) },
        });
        ctx.rootSpan.addEvent('agent.finish', { success, summary });
        toolResults.push({ toolCallId: call.id, output: summary });
        messages.push({ role: 'tool', tool_call_id: call.id, content: summary });
        break;
      }

      if (call.name === 'publish') {
        const publishSpan = ctx.tracer.startSpan('agent.validate', ctx.rootSpan.toContext());
        const validation = await validateProject(ctx.projectPath);
        await ctx.prisma.agentRun.update({
          where: { id: ctx.agentRunId },
          data: { validationSummary: sanitizeForDb(JSON.stringify(validation)) },
        });
        publishSpan.setAttributes({ allPassed: validation.allPassed });

        let publishResult: PublishResult | undefined;
        if (ctx.autoPublish && validation.allPassed) {
          publishSpan.addEvent('agent.publish.start');
          publishResult = await publishOmega(ctx.projectPath, call.arguments.version as string | undefined);
          publishSpan.setAttributes({ publishedVersion: publishResult.version ?? 'none' });
        }
        await publishSpan.end(validation.allPassed ? 'ok' : 'error');

        const output = JSON.stringify({ validation, publish: publishResult });
        toolResults.push({ toolCallId: call.id, output });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        processedToolCallIds.add(call.id);
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: {
            status: validation.allPassed ? 'done' : 'failed',
            output: sanitizeForDb(output),
          },
        });
        if (!validation.allPassed) {
          finished = true;
          success = false;
          summary = 'Validation failed';
        }
        rejectRemainingToolCalls('publish completed');
        break;
      }

      const explorationTools = ['think', 'read_file', 'list_files', 'search', 'run_command', 'lsp_diagnostics', 'lsp_hover', 'lsp_symbol'];
      const editTools = ['edit_file', 'write_file', 'edit_lines', 'apply_patch'];
      const isTestCommand =
        call.name === 'run_command' &&
        typeof call.arguments.command === 'string' &&
        looksLikeTestCommand(call.arguments.command);
      // Treat patch application via run_command (e.g. git apply) as a concrete
      // edit so reference-patch skills do not get forced into spurious edits.
      const isPatchCommand =
        call.name === 'run_command' &&
        typeof call.arguments.command === 'string' &&
        /\bgit\s+apply\b|\bpatch\s+[-p]/.test(call.arguments.command);
      // Test runs are verification, not exploration: they never count against
      // the exploration budget and are never rejected as "wandering".
      const isExploration = explorationTools.includes(call.name) && !isTestCommand && !isPatchCommand;
      const isEdit = editTools.includes(call.name) || isPatchCommand;
      if (isExploration) {
        ctx.explorationCount++;
        ctx.explorationSinceLastEdit++;
      }
      if (isEdit) {
        ctx.editCount++;
        ctx.explorationAtLastEdit = ctx.explorationCount;
        if (ctx.editCount % 5 === 0) {
          await checkpointCommit(ctx);
        }
      }

      const toolSpan = ctx.tracer.startSpan(`agent.tool.${call.name}`, ctx.rootSpan.toContext());
      toolSpan.setAttributes({ tool: call.name });

      if (isTestCommand) {
        ctx.hasRunTestCommand = true;
      }

      let result: ToolResult;
      turnToolCount++;
      const stuckWithoutEdits =
        ctx.editCount === 0 &&
        ctx.explorationCount >= ctx.explorationBudget.beforeFirstEdit * 2 &&
        !editTools.includes(call.name) &&
        call.name !== 'finish' &&
        call.name !== 'publish';
      if (stuckWithoutEdits) turnForcedCount++;
      const wanderingTooLong =
        ctx.editCount > 0 &&
        ctx.explorationSinceLastEdit >= ctx.explorationBudget.betweenEdits &&
        isExploration;
      if (wanderingTooLong) turnForcedCount++;
      const explorationBudgetExhausted =
        ctx.editCount === 0 && ctx.explorationCount > ctx.explorationBudget.beforeFirstEdit && isExploration;
      const wanderingAfterEdits =
        ctx.editCount > 0 && ctx.explorationCount - ctx.explorationAtLastEdit > ctx.explorationBudget.betweenEdits && isExploration;
      // Hard rejection when the agent wanders without editing; advisory only for
      // the milder pre-first-edit over-budget case before the hard threshold.
      const budgetAdvisory =
        !forcedEditMode && (explorationBudgetExhausted || wanderingAfterEdits || stuckWithoutEdits || wanderingTooLong);

      const allowedInForcedMode = new Set(['edit_file', 'write_file', 'edit_lines', 'apply_patch', 'read_file', 'search', 'think']);
      // Patch application via run_command (git apply) is itself an edit; do not
      // reject it in forced-edit mode or skill-based one-shot workflows break.
      if (stuckWithoutEdits && !forcedEditMode) {
        // Last-resort unblock: ask the provider for a minimal patch when the
        // agent has explored for a while without making any edit.
        const solved = await tryStuckSolve(ctx);
        if (solved) {
          ctx.editCount++;
          ctx.explorationAtLastEdit = ctx.explorationCount;
          ctx.explorationSinceLastEdit = 0;
          result = {
            success: true,
            output: 'Stuck-solver applied a draft patch to break the exploration loop. Review the change, then run the project build/test command and fix any issues.',
          };
          // Skip the current exploration tool so the agent sees the solver output
          // and moves on to verification.
          toolResults.push({ toolCallId: call.id, output: result.output });
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
          processedToolCallIds.add(call.id);
          await addTrace(ctx, 'tool', result.output, undefined, stepId);
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: { status: 'done', output: sanitizeForDb(result.output) },
          });
          await toolSpan.end('ok');
          stepIndex++;
          continue;
        }
      }
      if (forcedEditMode && !allowedInForcedMode.has(call.name) && !isPatchCommand) {
        result = {
          success: false,
          output: 'EDIT-FIRST MODE: you have explored too long without editing. read_file, search, and think are still allowed, but run_command, list_files, code_overview, lsp_*, finish, publish, validate_patch, and verify_api_surface are rejected until you make a concrete source change. Make an edit now (use edit_file, edit_lines, apply_patch, or write_file for a new file).',
        };
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string' && isReadOnlyShellCommand(call.arguments.command)) {
        result = {
          success: false,
          output: `Shell inspection command rejected: use read_file, search, or list_files instead of \`${call.arguments.command}\`.`,
        };
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string' && isFileReadingShellCommand(call.arguments.command)) {
        result = {
          success: false,
          output: `Shell file-reading command rejected: use read_file, search, or list_files instead of \`${call.arguments.command}\`.`,
        };
      } else if (call.name === 'think') {
        ctx.consecutiveThinks++;
        if (ctx.consecutiveThinks > 2) {
          result = {
            success: false,
            output: `Think rejected: you have already thought ${String(ctx.consecutiveThinks - 1)} times in a row. Stop planning and execute the next concrete step using read_file, run_command, or edit_file.`,
          };
        } else {
          result = await executeTool(ctx.projectPath, call.name, call.arguments);
        }
      } else if (call.name === 'read_file' && typeof call.arguments.path === 'string') {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string') {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      } else {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      }

      if (budgetAdvisory && result.success) {
        const sinceEdit = ctx.explorationCount - ctx.explorationAtLastEdit;
        const strong = stuckWithoutEdits || wanderingTooLong;
        const notice = strong
          ? `\n[EDIT-FIRST ADVISORY] You have used ${String(ctx.explorationCount)} exploration steps and made ${String(ctx.editCount)} edits (${String(sinceEdit)} since your last edit). Treat this as an instruction, not a tool failure: make the smallest edit_file/edit_lines/apply_patch change now, even if partial, then run the project's build/test command.`
          : `\n[budget notice] ${String(sinceEdit)} exploration steps since your last edit. Make a concrete edit or run the focused tests next — do not re-read files you already know.`;
        result = {
          success: true,
          output: `${result.output}${notice}`,
        };
      }

      const TOOL_OUTPUT_LIMIT = 6_000;
      const displayOutput =
        result.output.length > TOOL_OUTPUT_LIMIT
          ? `${result.output.slice(0, TOOL_OUTPUT_LIMIT)}\n... [truncated]`
          : result.output;

      if (call.name === 'write_file' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'edit_file' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'edit_lines' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'apply_patch' && result.success) {
        // Multi-file patch; rely on git status for final diff.
        ctx.modifiedFiles.add('(patch)');
      }

      toolSpan.setAttributes({
        success: result.success,
        outputLength: result.output.length,
        ...(result.success
          ? {}
          : { error: result.output.slice(0, 500) }),
      });
      // Allow test commands to be re-run after edits (note: duplicate command
      // restriction was removed, so commands always execute).
      if (call.name === 'verify_api_surface' && result.success) {
        ctx.apiSurfaceVerified = true;
      }
      logger.info(`Tool ${call.name} executed`, {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        traceId: ctx.tracer.traceId,
        spanId: toolSpan.spanId,
        tool: call.name,
        success: result.success,
      });
      await toolSpan.end(result.success ? 'ok' : 'error');
      if (!result.success) {
        turnHadFailure = true;
      }
      if (isEdit && result.success) {
        forcedEditMode = false;
        forcedEditModeSteps = 0;
        ctx.explorationSinceLastEdit = 0;

        // Catch TypeScript regressions immediately instead of letting them
        // compound across multiple edits.
        if (await isTypeScriptProject(ctx.projectPath)) {
          const typeCheck = await runTypeCheck(ctx.projectPath);
          if (!typeCheck.success) {
            result = {
              success: false,
              output: `TypeScript typecheck failed after this edit. Fix the type errors before continuing.\n\n${typeCheck.output}`,
            };
            turnHadFailure = true;
          }
        }
      }
      await ctx.prisma.taskStep.update({
        where: { id: stepId },
        data: {
          status: result.success ? 'done' : 'failed',
          output: sanitizeForDb(result.output),
          error: sanitizeForDb(result.success ? null : result.output),
        },
      });
      await addTrace(ctx, 'tool', result.output, undefined, stepId);
      toolResults.push({ toolCallId: call.id, output: displayOutput });
      messages.push({ role: 'tool', tool_call_id: call.id, content: displayOutput });
      processedToolCallIds.add(call.id);
      stepIndex++;

      if (forcedEditMode) {
        forcedEditModeSteps++;
        if (forcedEditModeSteps > ctx.explorationBudget.beforeFirstEdit * 2) {
          logger.warn('Agent refused to edit in forced edit mode; ending task', {
            taskId: ctx.task.id,
            agentRunId: ctx.agentRunId,
            forcedEditModeSteps,
          });
          summary = 'Agent refused to make a concrete edit after repeated prompting.';
          finished = true;
          success = false;
          break;
        }
      }
    }

    const turnAllForced = turnToolCount > 0 && turnForcedCount === turnToolCount;
    if (turnAllForced) {
      stuckTurnCount++;
    } else {
      stuckTurnCount = 0;
    }
    if (stuckTurnCount >= 2 && !finished) {
      logger.warn('Agent stuck in exploration loop; resetting conversation to force an edit', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
        explorationCount: ctx.explorationCount,
      });
      // Give the agent a fresh exploration budget after the reset so it can
      // re-orient without immediately hitting the stuck-without-edits guard.
      ctx.explorationCount = 0;
      ctx.explorationAtLastEdit = 0;
      ctx.explorationSinceLastEdit = 0;
      ctx.consecutiveThinks = 0;
      stuckTurnCount = 0;
      forcedEditMode = true;
      forcedEditModeSteps = 0;
      messages.length = 0;
      messages.push({ role: 'system', content: ctx.systemPrompt });
      messages.push({ role: 'user', content: buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined) });
      messages.push({
        role: 'user',
        content:
          `[ACTION REQUIRED] You have explored long enough without editing. ` +
          `You are now in FORCED EDIT MODE. Only read_file, search, and edit_file are accepted. ` +
          `All other tools (write_file, run_command, list_files, code_overview, think, lsp_*) will be rejected until you make a concrete edit. ` +
          `Choose the most relevant source file, read the exact lines you need, and make the smallest edit_file change that advances the task. ` +
          `Do not explain. Do not ask for clarification. Edit now.`,
      });
    }

    const shouldReflect = turnHadFailure || lastTurnHadFailure;
    lastTurnHadFailure = turnHadFailure;

    let nextPrompt = buildToolResultPrompt(ctx.task, toolResults);
    if (shouldReflect && !finished) {
      nextPrompt =
        'One or more tools failed in the last turn. Diagnose the failure from the tool results below, then respond with the single next concrete action (read_file, edit_file, run_command, etc.). Do not just think or explain; execute the next step.\n\n' +
        nextPrompt;
    }

    if (!finished) {
      messages.push({ role: 'user', content: nextPrompt });
    }
  }

  // Capture diff
  if (ctx.modifiedFiles.size > 0 || (await hasChanges(ctx.projectPath))) {
    await stageAllChanges(ctx.projectPath);
    await commit(ctx.projectPath, `agent: ${ctx.task.title}`, true);
  }
  const diff = await getDiff(ctx.projectPath, ctx.baseCommit);
  if (diff.output) {
    await ctx.prisma.taskDiff.create({
      data: {
        taskId: ctx.task.id,
        branch: ctx.branch,
        patch: diff.output,
      },
    });
  }

  const updatedTask = await ctx.prisma.task.update({
    where: { id: ctx.task.id },
    data: {
      status: success ? 'done' : 'failed',
      result: sanitizeForDb(summary),
      error: sanitizeForDb(success ? null : summary),
      provider: ctx.provider.config.name,
      model: ctx.model,
    },
  });

  await ctx.prisma.agentRun.update({
    where: { id: ctx.agentRunId },
    data: {
      resultStatus: success ? 'done' : 'failed',
      promptTokens: ctx.usage.promptTokens,
      completionTokens: ctx.usage.completionTokens,
      totalTokens: ctx.usage.totalTokens,
    },
  });

  return {
    task: toCoreTask(updatedTask),
    agentRunId: ctx.agentRunId,
  };
}

async function isTypeScriptProject(projectPath: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(path.join(projectPath, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

async function runAutoApiChecks(
  projectPath: string,
  checks: { label: string; script: string /* must write its own result with console.log('true'/'false') */ }[]
): Promise<{ success: boolean; output: string }> {
  const isTs = await isTypeScriptProject(projectPath);

  // For TypeScript projects, run a typecheck first so missing imports are
  // caught before the runtime API surface checks.
  if (isTs) {
    const typeCheck = await runTypeCheck(projectPath);
    if (!typeCheck.success) {
      return {
        success: false,
        output: `TypeScript typecheck failed before automatic API surface check:\n${typeCheck.output}`,
      };
    }
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const results: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    let passed: boolean;
    let output: string;
    if (isTs) {
      // Write the check to a temporary .ts file inside the project root so
      // relative imports resolve against the project and the script can import
      // source files directly (e.g. './src/index.ts').
      const tmpFile = path.join(projectPath, `.omega-api-check-${String(Date.now())}-${String(Math.random()).slice(2)}.ts`);
      const esmScript = check.script
        .replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import { $1 } from '$2';")
        .replace(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import * as $1 from '$2';")
        .replace(/require\(['"]([^'"]+)['"]\)/g, "await import('$1')");
      await fs.writeFile(tmpFile, `${esmScript}\n`, 'utf-8');
      try {
        const { stdout, stderr } = await execFileAsync('npx', ['tsx', tmpFile], {
          cwd: projectPath,
          timeout: 30_000,
        });
        output = (stdout + stderr).trim();
        passed = output === 'true';
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
        passed = false;
      } finally {
        await fs.unlink(tmpFile).catch(() => {
          // ignore cleanup errors
        });
      }
    } else {
      try {
        const { stdout } = await execFileAsync('node', ['-e', check.script], {
          cwd: projectPath,
          timeout: 30_000,
        });
        output = stdout.trim();
        passed = output === 'true';
      } catch (err) {
        output = err instanceof Error ? err.message : String(err);
        passed = false;
      }
    }
    if (!passed) allPassed = false;
    results.push(`${passed ? '✓' : '✗'} ${check.label} → ${output}`);
  }
  return { success: allPassed, output: results.join('\n') };
}

function recordUsage(ctx: AgentContext, usage: UsageInfo): void {
  if (usage.promptTokens !== undefined) {
    ctx.usage.promptTokens = (ctx.usage.promptTokens ?? 0) + usage.promptTokens;
  }
  if (usage.completionTokens !== undefined) {
    ctx.usage.completionTokens = (ctx.usage.completionTokens ?? 0) + usage.completionTokens;
  }
  if (usage.totalTokens !== undefined) {
    ctx.usage.totalTokens = (ctx.usage.totalTokens ?? 0) + usage.totalTokens;
  } else if (usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    ctx.usage.totalTokens = (ctx.usage.totalTokens ?? 0) + usage.promptTokens + usage.completionTokens;
  }
}

function truncateMessages(
  messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[]; tool_call_id?: string }[],
  maxTotal = 40,
  fullWindow = 10,
  truncateLength = 500
): typeof messages {
  // Drop the system message from the transcript; the provider will prepend the
  // full system prompt separately. This keeps the context window smaller.
  const cleaned = messages.filter((m) => m.role !== 'system');

  // Helper: return a copy of a message with content truncated.
  const trimContent = (m: (typeof messages)[number]): (typeof messages)[number] => {
    if (!m.content || m.content.length <= truncateLength) return m;
    return { ...m, content: `${m.content.slice(0, truncateLength)}\n... [truncated]` };
  };

  // If we need to drop messages, drop whole assistant+tool+prompt turns from the
  // start so that we never leave orphaned tool messages without their matching
  // assistant tool_calls (OpenAI/Kimi rejects those conversations).
  let working = cleaned;
  if (cleaned.length > maxTotal) {
    const toDrop = cleaned.length - maxTotal;
    let keepFrom = toDrop;
    while (keepFrom < cleaned.length) {
      const m = cleaned[keepFrom];
      if (m.role === 'assistant' && (keepFrom === 0 || cleaned[keepFrom - 1].role === 'user')) {
        break;
      }
      keepFrom++;
    }
    working = cleaned.slice(keepFrom);
  }

  const windowStart = Math.max(0, working.length - fullWindow);
  return working.map((m, idx) => {
    if (idx >= windowStart) return m;
    return trimContent(m);
  });
}

// Wraps a provider-touching call (planner, reflection) with turn-level retry so a
// multi-minute provider outage (e.g. GLM 429 bursts) doesn't kill the task from a
// path that bypasses sendToProvider. sendToProvider has its own inline equivalent.
async function withProviderRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const backoffsMs = [30_000, 60_000, 90_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= backoffsMs.length) throw err;
      const waitMs = backoffsMs[attempt];
      logger.warn(`${label} call failed, retrying after backoff`, {
        attempt: attempt + 1,
        waitMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }
}

async function sendToProvider(
  ctx: AgentContext,
  messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[]; tool_call_id?: string }[],
  prompt?: string
): Promise<{ content?: string; toolCalls?: string }> {
  const span = ctx.tracer.startSpan('provider.send', ctx.rootSpan.toContext());
  span.setAttributes({ provider: ctx.provider.config.name, model: ctx.model });

  // Honour external abort signal (e.g. orchestrator subtask timeout)
  if (ctx.signal?.aborted) {
    throw new DOMException('AbortError', 'AbortError');
  }

  const provider = ctx.provider as Provider & { sendWithTools?: (prompt: string, tools: ToolDefinition[], opts?: SendOptions) => Promise<string> };

  const onUsage = (usage: UsageInfo): void => {
    recordUsage(ctx, usage);
    span.setAttributes({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  };

  const baseMessages = truncateMessages(messages);

  // Turn-level retry: survives provider outages longer than the provider's own
  // HTTP-retry window (e.g. GLM's multi-minute 429 overload bursts). Up to 3
  // extra attempts with 30/60/90s backoff, logged as warnings.
  const TURN_BACKOFFS_MS = [30_000, 60_000, 90_000];
  for (let attempt = 0; ; attempt++) {
  try {
    // Prefer native tool calls when the provider supports them.
    // Skips sendWithTools for providers known to 429 on tool endpoints — uses text fallback instead.
    if (typeof provider.sendWithTools === 'function' && ctx.provider.config.name !== 'glm') {
      const sendMessages = prompt ? [...baseMessages, { role: 'user' as const, content: prompt }] : baseMessages;
      const raw = await provider.sendWithTools(prompt ?? 'Execute the next step.', AGENT_TOOLS, {
        system: ctx.systemPrompt,
        model: ctx.model,
        temperature: 0.3,
        onUsage,
        messages: sendMessages,
      });
      span.addEvent('provider.response.received');
      const parsed = parseProviderResponse(raw);
      await span.end('ok');
      return parsed;
    }

    // Fallback to text-mode JSON tool calls. Build a plain transcript so providers
    // that do not support tool roles still see the full context.
    const sendMessages = prompt ? [...baseMessages, { role: 'user' as const, content: prompt }] : baseMessages;
    const transcript = sendMessages
      .map((m) => {
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          const calls = m.tool_calls
            .map((tc) => `  - ${tc.function?.name ?? ''}(${tc.function?.arguments ?? ''})`)
            .join('\n');
          return `[assistant] ${m.content ?? ''}\nTool calls:\n${calls}`;
        }
        if (m.role === 'tool') {
          return `[tool result for ${m.tool_call_id ?? ''}]\n${m.content ?? ''}`;
        }
        return `[${m.role}] ${m.content ?? ''}`;
      })
      .join('\n\n');
    const raw = await provider.send(transcript, {
      system: buildTextToolsSystemPrompt(ctx.promptContext),
      model: ctx.model,
      onUsage,
    });
    span.addEvent('provider.response.received');
    const parsed = parseProviderResponse(raw);
    await span.end('ok');
    return parsed;
  } catch (err) {
    if (attempt < TURN_BACKOFFS_MS.length) {
      const waitMs = TURN_BACKOFFS_MS[attempt];
      logger.warn('Provider call failed, retrying turn after backoff', {
        attempt: attempt + 1,
        waitMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
      continue;
    }
    span.recordError(err);
    await span.end('error');
    throw err;
  }
  }
}

function parseProviderResponse(raw: string): { content?: string; toolCalls?: string } {
  const cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const inner = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    return extractToolCalls(inner);
  }
  return extractToolCalls(cleaned);
}

function extractToolCalls(text: string): { content?: string; toolCalls?: string } {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | unknown[];
    if (!Array.isArray(parsed) && Array.isArray(parsed.tool_calls)) {
      return { content: parsed.content as string | undefined, toolCalls: JSON.stringify(parsed.tool_calls) };
    }
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).name === 'string')) {
      return { toolCalls: JSON.stringify(parsed) };
    }
    // Some text-mode providers return a single object like { "write_file": { "path": "..." } }
    // or { "type": "tool", "name": "...", "input": { ... } }.
    if (!Array.isArray(parsed)) {
      const nestedName = Object.keys(parsed).find((k) => AGENT_TOOL_NAMES.has(k));
      if (nestedName && typeof parsed[nestedName] === 'object' && parsed[nestedName] !== null) {
        return { toolCalls: JSON.stringify([{ id: 'call-0', name: nestedName, arguments: parsed[nestedName] }]) };
      }
      const singleName =
        typeof parsed.name === 'string' && AGENT_TOOL_NAMES.has(parsed.name)
          ? parsed.name
          : typeof parsed.tool === 'string' && AGENT_TOOL_NAMES.has(parsed.tool)
            ? parsed.tool
            : undefined;
      if (singleName) {
        const args =
          typeof parsed.arguments === 'object' && parsed.arguments !== null
            ? parsed.arguments
            : typeof parsed.input === 'object' && parsed.input !== null
              ? parsed.input
              : Object.fromEntries(
                  Object.entries(parsed).filter(([k]) => k !== 'id' && k !== 'tool_call_id' && k !== 'name' && k !== 'tool')
                );
        return { toolCalls: JSON.stringify([{ id: 'call-0', name: singleName, arguments: args }]) };
      }
    }
  } catch {
    // not JSON
  }
  const markdown = parseMarkdownActions(text);
  if (markdown.length > 0) {
    return { content: text, toolCalls: JSON.stringify(markdown) };
  }
  const xml = parseXmlActions(text);
  if (xml.length > 0) {
    return { content: text, toolCalls: JSON.stringify(xml) };
  }
  return { content: text };
}

function parseXmlActions(text: string): ToolCall[] {
  const actions: ToolCall[] = [];
  const invokeRe = /<invoke\s+name="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = invokeRe.exec(text)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const endInvoke = text.indexOf('</invoke>', start);
    if (endInvoke === -1) continue;
    const block = text.slice(start, endInvoke);
    const args: Record<string, string | undefined> = {};
    const paramRe = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(block)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    const id = `xml-${actions.length.toString()}`;
    if (name === 'finish') {
      const summary = args.thought ?? args.summary ?? Object.values(args).filter(Boolean).join(' ');
      actions.push({
        id,
        name,
        arguments: { summary, success: !/fail|error/i.test(summary) },
      });
    } else if (name === 'think') {
      actions.push({ id, name, arguments: { thought: args.thought ?? Object.values(args).filter(Boolean).join(' ') } });
    } else {
      const typedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) typedArgs[k] = v;
      actions.push({ id, name, arguments: typedArgs });
    }
    invokeRe.lastIndex = endInvoke + '</invoke>'.length;
  }
  return actions;
}

function parseMarkdownActions(text: string): ToolCall[] {
  const actions: ToolCall[] = [];
  const actionHeader = /^###\s*Action:\s*(\w+)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = actionHeader.exec(text)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const next = actionHeader.exec(text);
    actionHeader.lastIndex = start;
    const end = next ? next.index : text.length;
    const block = text.slice(start, end).trim();

    if (name === 'finish') {
      actions.push({
        id: `md-${actions.length.toString()}`,
        name,
        arguments: { summary: block, success: !/fail|error/i.test(block) },
      });
      continue;
    }

    if (name === 'think') {
      actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { thought: block } });
      continue;
    }

    if (name === 'run_command') {
      const cmd = extractCodeBlock(block, 'bash') ?? extractCodeBlock(block) ?? block;
      actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { command: cmd.trim() } });
      continue;
    }

    if (name === 'write_file') {
      const code = extractCodeBlock(block);
      if (!code) continue;
      const firstLine = block.split('\n')[0] ?? '';
      const pathRe = /^\s*[`\\/]?([^\n`]+?)[`]?\s*$/;
      pathRe.lastIndex = 0;
      const pathMatch = pathRe.exec(firstLine);
      const path = pathMatch?.[1] ?? extractFilePathFromFence(block);
      if (path) {
        actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { path, content: code } });
      }
      continue;
    }

    if (name === 'read_file') {
      const path = block.trim().split('\n')[0]?.trim() ?? '';
      if (path) {
        actions.push({ id: `md-${actions.length.toString()}`, name, arguments: { path } });
      }
    }
  }
  return actions;
}

function extractCodeBlock(text: string, lang?: string): string | undefined {
  const pattern = lang
    ? new RegExp(`\\\`\\\`\\\`${lang}\\n([\\s\\S]*?)\\n\\\`\\\`\\\``, 'i')
    : /```(?:[a-z]+)?\n?([\s\S]*?)\n?```/i;
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return m?.[1];
}

function extractFilePathFromFence(text: string): string | undefined {
  const re = /```(?:[a-z]+)?:?\s*([^\n]+)/i;
  re.lastIndex = 0;
  const m = re.exec(text);
  return m?.[1]?.trim();
}

function parseToolCalls(raw: string | undefined): ToolCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed
      .map((t, idx) => {
        let name: string | undefined;
        let argsSource: Record<string, unknown> | undefined;
        if (typeof t.name === 'string' && AGENT_TOOL_NAMES.has(t.name)) {
          name = t.name;
        } else if (typeof t.tool === 'string' && AGENT_TOOL_NAMES.has(t.tool)) {
          name = t.tool;
        } else {
          const nested = Object.keys(t).find((k) => AGENT_TOOL_NAMES.has(k));
          if (nested && typeof t[nested] === 'object' && t[nested] !== null) {
            name = nested;
            argsSource = t[nested] as Record<string, unknown>;
          }
        }
        if (!name) return undefined;
        const id =
          (typeof t.id === 'string' && t.id.length > 0 ? t.id : undefined) ??
          (typeof t.tool_call_id === 'string' && t.tool_call_id.length > 0 ? t.tool_call_id : undefined) ??
          `call-${String(idx)}`;
        let args: Record<string, unknown> = {};
        if (argsSource) {
          args = argsSource;
        } else if (typeof t.arguments === 'string') {
          try {
            args = JSON.parse(t.arguments) as Record<string, unknown>;
          } catch {
            args = { raw: t.arguments };
          }
        } else if (typeof t.arguments === 'object' && t.arguments !== null) {
          args = t.arguments as Record<string, unknown>;
        } else if (typeof t.input === 'object' && t.input !== null) {
          args = t.input as Record<string, unknown>;
        } else {
          // Arguments supplied as sibling fields.
          args = Object.fromEntries(
            Object.entries(t).filter(([k]) => k !== 'id' && k !== 'tool_call_id' && k !== 'name' && k !== 'tool')
          );
        }
        return { id, name, arguments: args };
      })
      .filter((t): t is ToolCall => t !== undefined);
  } catch {
    return [];
  }
}

async function addTrace(
  ctx: AgentContext,
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: string,
  toolCalls?: string,
  stepId?: string
): Promise<void> {
  await ctx.prisma.taskTrace.create({
    data: {
      taskId: ctx.task.id,
      stepId: stepId ?? null,
      role,
      content: sanitizeForDb(content) ?? '',
      toolCalls: sanitizeForDb(toolCalls),
    },
  });
}

async function failTask(prisma: PrismaClient, taskId: string, error: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'failed', error: sanitizeForDb(error) },
  });
}
