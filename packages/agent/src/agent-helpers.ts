import type { PrismaClient } from '@omega/db';
import type { ResolvedSkill } from './skill-resolver.js';
import type { AgentContext } from './agent-types.js';
import { logger } from './logger.js';
import { sanitizeForDb } from './utils.js';
import { parseProviderResponse, parseToolCalls } from './provider-client.js';
import { buildReflectionPrompt } from './prompts.js';
import { hasChanges, stageAllChanges, commit, getDiff } from './git.js';
import {
  boundedExecutionTimeoutMs,
  isTypeScriptProject,
  remainingDeadlineMs,
  type ExecutionDeadlineOptions,
} from './project-utils.js';
import { abortableOperation } from './retry.js';
import { runTypeCheck } from './ts-runner.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function extractPatch(raw: string): string | undefined {
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

export async function addTrace(
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

export async function failTask(prisma: PrismaClient, taskId: string, error: string): Promise<void> {
  const reason = error.trim() || 'Task failed without an error message.';
  // `error` is always overwritten (a failure must state why), but `result`
  // is only filled when empty: a late failure after the loop already wrote a
  // real summary must not destroy it, or the record of successful work is
  // lost and a retry re-spends on work that already landed.
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    select: { result: true },
  });
  const keepResult = (existing?.result ?? '').trim().length > 0;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error: sanitizeForDb(reason),
      ...(keepResult ? {} : { result: sanitizeForDb(reason) }),
    },
  });
}

export async function tryStuckSolve(ctx: AgentContext): Promise<boolean> {
  if (ctx.stuckSolveAttempted) return false;
  ctx.stuckSolveAttempted = true;
  // Pull the agent's exploration so far so the draft patch is grounded in the
  // actual repo contents the agent already read, instead of being generated
  // blind from the task title alone (which produced unapplyable patches).
  let explorationContext = '';
  try {
    const recentTraces = await ctx.prisma.taskTrace.findMany({
      where: { taskId: ctx.task.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    explorationContext = recentTraces
      .reverse()
      .map((t) => {
        const prefix = t.role === 'user' ? '## exploration step' : '## tool result';
        const content = (t.content ?? '').slice(0, 600);
        return `${prefix}:\n${content}`;
      })
      .join('\n\n')
      .slice(0, 16_000);
  } catch {
    // Trace fetch is best-effort; fall back to a context-less patch attempt.
  }
  const prompt = `Task: ${ctx.task.title}\n\nDescription:\n${ctx.task.description ?? ''}\n\n${ctx.repoOverview ?? ''}\n\nRecent exploration the agent has already done (file contents, tool outputs):\n${explorationContext || '(none)'}\n\nProduce the smallest unified diff patch (git apply format) that makes concrete progress on this task. Use the exact file paths and content from the exploration above. Output ONLY the diff, no explanation, no markdown fences.`;
  try {
    const raw = await abortableOperation(() => ctx.provider.send(prompt, {
      system: 'You are a senior software engineer. Output ONLY a unified diff patch in git apply format. No explanation, no markdown fences.',
      model: ctx.model,
      temperature: 0.2,
      timeoutMs: remainingDeadlineMs(ctx.deadlineMs),
    }), ctx.signal);
    const patch = extractPatch(raw);
    if (!patch) return false;
    const tmp = path.join(ctx.projectPath, '.stuck-solve.patch');
    await fs.writeFile(tmp, patch, 'utf-8');
    try {
      // Try strict apply first (fast, catches real conflicts).
      await execFileAsync('git', ['-C', ctx.projectPath, 'apply', '--whitespace=nowarn', tmp]);
      logger.info('Stuck-solver applied a draft patch', { taskId: ctx.task.id, agentRunId: ctx.agentRunId });
      return true;
    } catch {
      // Fallback: --3way uses merge-based application which is more forgiving
      // when the working tree has drifted from the patch context — mirrors the
      // bench evaluator's applyLatestPatch pattern.
      try {
        await execFileAsync('git', ['-C', ctx.projectPath, 'apply', '--3way', '--whitespace=nowarn', tmp]);
        logger.info('Stuck-solver applied a draft patch (3way)', { taskId: ctx.task.id, agentRunId: ctx.agentRunId });
        return true;
      } catch (err) {
        logger.warn('Stuck-solver patch failed to apply', {
          taskId: ctx.task.id,
          agentRunId: ctx.agentRunId,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
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

export async function reflectOnTrace(ctx: AgentContext, maxTurns: number): Promise<string | undefined> {
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
    const raw = await abortableOperation(() => ctx.provider.send(
      buildReflectionPrompt(ctx.task, summary),
      {
        system: ctx.systemPrompt,
        model: ctx.model,
        timeoutMs: remainingDeadlineMs(ctx.deadlineMs),
      },
    ), ctx.signal);
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

export async function checkpointCommit(ctx: AgentContext): Promise<void> {
  if (ctx.modifiedFiles.size === 0 && !(await hasChanges(ctx.projectPath))) return;
  await stageAllChanges(ctx.projectPath);
  await commit(ctx.projectPath, `agent checkpoint: ${ctx.task.title}`, true);
}

export async function getModifiedTsFiles(ctx: AgentContext): Promise<string[]> {
  const modified = Array.from(ctx.modifiedFiles).filter((p) => /\.(ts|tsx|mts|cts)$/i.test(p));
  if (modified.length > 0) return modified;
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

export async function applySkillPatches(
  projectPath: string,
  baseCommit: string,
  skills: ResolvedSkill[]
): Promise<{ applied: string[]; patch: string }> {
  const applied: string[] = [];
  let appliedPatchPath: string | undefined;
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
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to apply skill patch', { skill: skill.name, patchPath, error: message });
    }
  }
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

export async function runAutoApiChecks(
  projectPath: string,
  checks: { label: string; script: string /* must write its own result with console.log('true'/'false') */ }[],
  options: ExecutionDeadlineOptions = {},
): Promise<{ success: boolean; output: string }> {
  const isTs = await isTypeScriptProject(projectPath);

  if (isTs) {
    const typeCheck = await runTypeCheck(projectPath, options);
    if (!typeCheck.success) {
      return {
        success: false,
        output: `TypeScript typecheck failed before automatic API surface check:\n${typeCheck.output}`,
      };
    }
  }

  const results: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    let passed: boolean;
    let output: string;
    if (isTs) {
      const tmpFile = path.join(projectPath, `.omega-api-check-${String(Date.now())}-${String(Math.random()).slice(2)}.ts`);
      const esmScript = check.script
        .replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import { $1 } from '$2';")
        .replace(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import * as $1 from '$2';")
        .replace(/require\(['"]([^'"]+)['"]\)/g, "await import('$1')");
      await fs.writeFile(tmpFile, `${esmScript}\n`, 'utf-8');
      try {
        const { stdout, stderr } = await execFileAsync('npx', ['tsx', tmpFile], {
          cwd: projectPath,
          timeout: boundedExecutionTimeoutMs(30_000, options),
          signal: options.signal,
        });
        output = (stdout + stderr).trim();
        passed = output === 'true';
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
        passed = false;
      } finally {
        await fs.unlink(tmpFile).catch(() => undefined);
      }
    } else {
      try {
        const { stdout } = await execFileAsync('node', ['-e', check.script], {
          cwd: projectPath,
          timeout: boundedExecutionTimeoutMs(30_000, options),
          signal: options.signal,
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
