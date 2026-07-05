import type { PrismaClient } from '@omega/db';
import type { Provider, ProviderConfig, Task, AgentOptions, ToolCall, SendOptions, ToolDefinition, UsageInfo } from '@omega/core';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import { createPlan } from './planner.js';
import { executeTool, type ToolResult } from './tools.js';
import { validateProject, type ValidationSummary } from './validator.js';
import { publishOmega, type PublishResult } from './publisher.js';
import {
  buildTaskPrompt,
  buildToolResultPrompt,
  buildSystemPrompt,
  buildTextToolsSystemPrompt,
  buildReflectionPrompt,
  FORCE_ACTION_PROMPT,
} from './prompts.js';
import { buildPromptContext } from './prompt-context.js';
import { resolveSkills, formatSkillContext } from './skill-resolver.js';
import { createClients } from './lsp/index.js';
import { setLspClients } from './tools.js';
import { loadCurrentPrompts, hashPrompts } from './prompt-versioning.js';
import { AGENT_TOOLS } from './tool-definitions.js';
import { logger } from './logger.js';
import { Tracer, type Span } from './tracer.js';
import {
  getCurrentBranch,
  getCurrentCommit,
  createBranch,
  hasChanges,
  stageFiles,
  commit,
  getDiff,
  checkoutBranch,
  stashAll,
  popStash,
  createWorktree,
  removeWorktree,
} from './git.js';

export interface AgentResult {
  task: Task;
  agentRunId: string;
  validation?: ValidationSummary;
  publish?: PublishResult;
}

function maxStepsForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple':
      return 30;
    case 'medium':
      return 60;
    case 'complex':
      return 150;
    default:
      return 50;
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
  modifiedFiles: Set<string>;
  recentCommands: Set<string>;
  recentReads: Map<string, number>;
  consecutiveThinks: number;
  explorationCount: number;
  editCount: number;
  tracer: Tracer;
  rootSpan: Span;
  systemPrompt: string;
  promptContext?: string;
  usage: UsageInfo;
  apiSurfaceVerified: boolean;
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

export async function runAgentTask(
  prisma: PrismaClient,
  taskId: string,
  options: AgentOptions
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
    defaultModel: cfg.defaultModel,
    capabilities: JSON.parse(cfg.capabilities) as ProviderConfig['capabilities'],
    enabled: cfg.enabled,
  }));
  const selection = selectProvider(coreConfigs, [], toCoreTask(task));
  if (!selection) {
    await failTask(prisma, taskId, 'No provider available for this task');
    throw new Error('No provider available for this task');
  }
  const provider = createProvider(selection.provider);

  const branch = `agent/${task.id}`;
  const baseBranch = await getCurrentBranch(options.projectPath);
  const baseCommit = await getCurrentCommit(options.projectPath);
  if (!baseBranch.success || !baseCommit.success) {
    await failTask(prisma, taskId, 'Not a git repository');
    throw new Error('Not a git repository');
  }

  // Stash any uncommitted changes so the agent starts from a clean base.
  let stashed = false;
  if (await hasChanges(options.projectPath)) {
    const stashResult = await stashAll(options.projectPath);
    stashed = stashResult.success;
  }

  const isolated = options.isolated ?? false;
  let worktreePath: string | undefined;
  let effectiveProjectPath = options.projectPath;
  if (isolated) {
    worktreePath = path.join(options.projectPath, '.omega', 'worktrees', `${options.projectName}-${task.id}`);
    const worktreeResult = await createWorktree(options.projectPath, worktreePath, branch, baseCommit.output);
    if (worktreeResult.success) {
      effectiveProjectPath = worktreePath;
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
    }
  } else {
    const branchResult = await createBranch(options.projectPath, branch, baseCommit.output);
    if (!branchResult.success) {
      await checkoutBranch(options.projectPath, branch);
    }
  }

  // Isolated worktrees often lack node_modules. Install dependencies so validation and LSP work.
  try {
    await fs.access(path.join(effectiveProjectPath, 'node_modules'));
  } catch {
    logger.info('Installing dependencies in worktree', { projectPath: effectiveProjectPath });
    try {
      await execFileAsync('pnpm', ['install'], { cwd: effectiveProjectPath, timeout: 300_000 });
    } catch (err) {
      logger.warn('Dependency install failed', {
        projectPath: effectiveProjectPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const promptContext = await buildPromptContext(prisma, task.projectId, {
    lookbackRuns: 5,
    taskDescription: task.description,
  });
  const skills = await resolveSkills(prisma, effectiveProjectPath, task.description);
  const skillContext = formatSkillContext(skills);
  const combinedContext = [promptContext.text, skillContext].filter(Boolean).join('\n\n');
  const systemPrompt = buildSystemPrompt(combinedContext);

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

  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      branch,
      baseCommit: baseCommit.output,
      resultStatus: 'running',
      promptVersionId: promptVersion.id,
    },
  });

  const lspClients = createClients(effectiveProjectPath);
  setLspClients(lspClients);
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
    modifiedFiles: new Set<string>(),
    recentCommands: new Set<string>(),
    recentReads: new Map<string, number>(),
    consecutiveThinks: 0,
    explorationCount: 0,
    editCount: 0,
    tracer,
    rootSpan,
    systemPrompt,
    promptContext: combinedContext,
    usage: {},
    apiSurfaceVerified: false,
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
    const result = await executeAgentLoop(ctx);
    rootSpan.addEvent('task.finished', { status: result.task.status });
    await rootSpan.end(result.task.status === 'done' ? 'ok' : 'error');
    logger.info('Agent task finished', {
      taskId: ctx.task.id,
      agentRunId: ctx.agentRunId,
      traceId: tracer.traceId,
      status: result.task.status,
    });
    return result;
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
    setLspClients(new Map());
    if (worktreePath) {
      const removeResult = await removeWorktree(options.projectPath, worktreePath);
      if (!removeResult.success) {
        logger.warn('Failed to remove worktree', {
          worktreePath,
          error: removeResult.output,
        });
      }
    } else {
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

async function executeAgentLoop(ctx: AgentContext): Promise<AgentResult> {
  // Initial planning trace
  await addTrace(ctx, 'system', ctx.systemPrompt);
  await addTrace(ctx, 'user', buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined));

  const planSpan = ctx.tracer.startSpan('agent.plan', ctx.rootSpan.toContext());
  const plan = await createPlan(
    ctx.provider,
    ctx.task.title,
    ctx.task.description ?? undefined,
    ctx.promptContext,
    (usage) => {
      recordUsage(ctx, usage);
    }
  );
  planSpan.setAttributes({ planSteps: plan.plan.length });
  planSpan.addEvent('plan.created');
  await planSpan.end('ok');
  await addTrace(ctx, 'assistant', `Plan: ${JSON.stringify(plan)}`);

  // Steps are recorded dynamically as the agent actually invokes tools, so the
  // persisted sequence matches real execution rather than the initial plan.
  let stepIndex = 0;
  let finished = false;
  let success = false;
  let summary = '';
  let noActionCount = 0;
  let turnCount = 0;
  let lastTurnHadFailure = false;

  // Maintain a full conversation transcript so the model remembers prior tool outputs.
  const messages: {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    tool_call_id?: string;
  }[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined) },
    { role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` },
  ];

  while (stepIndex < ctx.maxSteps && !finished) {
    turnCount++;
    const response = await sendToProvider(ctx, messages);

    const assistantToolCalls = response.toolCalls
      ? parseToolCalls(response.toolCalls).map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        }))
      : undefined;
    messages.push({
      role: 'assistant',
      content: response.content ?? undefined,
      tool_calls: assistantToolCalls,
    });
    await addTrace(ctx, 'assistant', response.content ?? '', response.toolCalls);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      noActionCount++;
      if (noActionCount >= 2) {
        const reflection = await reflectOnTrace(ctx, 8);
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
      continue;
    }
    noActionCount = 0;

    const toolCalls = parseToolCalls(response.toolCalls);
    const toolResults: { toolCallId: string; output: string }[] = [];
    let turnHadFailure = false;

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
          input,
        },
      });
      const stepId = step.id;

      if (call.name === 'finish') {
        const finishingWithFailure = call.arguments.success === false;
        const earlyFailure = finishingWithFailure && stepIndex < ctx.maxSteps - 5;
        if (earlyFailure) {
          const message = `finish rejected: you are declaring failure too early (step ${String(stepIndex)} of ${String(ctx.maxSteps)}). Continue diagnosing and fixing the issue instead of giving up.`;
          turnHadFailure = true;
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: { status: 'failed', output: message },
          });
          toolResults.push({ toolCallId: call.id, output: message });
          messages.push({ role: 'tool', tool_call_id: call.id, content: message });
          break;
        }
        const requiresApiCheck = taskMentionsPublicApi(ctx.task);
        if (requiresApiCheck && !ctx.apiSurfaceVerified) {
          const message =
            'finish rejected: the task describes public API requirements. Call verify_api_surface first to confirm required methods/properties are exposed.';
          turnHadFailure = true;
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: { status: 'failed', output: message },
          });
          toolResults.push({ toolCallId: call.id, output: message });
          messages.push({ role: 'tool', tool_call_id: call.id, content: message });
          break;
        }
        finished = true;
        success = Boolean(call.arguments.success);
        const summaryArg =
          typeof call.arguments.summary === 'string'
            ? call.arguments.summary
            : typeof call.arguments.message === 'string'
              ? call.arguments.message
              : '';
        summary = summaryArg;
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: { status: success ? 'done' : 'failed', output: summary },
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
          data: { validationSummary: JSON.stringify(validation) },
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
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: {
            status: validation.allPassed ? 'done' : 'failed',
            output,
          },
        });
        if (!validation.allPassed) {
          finished = true;
          success = false;
          summary = 'Validation failed';
        }
        break;
      }

      if (call.name === 'write_file' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }

      const explorationTools = ['think', 'read_file', 'list_files', 'run_command', 'lsp_diagnostics', 'lsp_hover', 'lsp_symbol'];
      const editTools = ['edit_file', 'write_file'];
      const isExploration = explorationTools.includes(call.name);
      const isEdit = editTools.includes(call.name);
      if (isExploration) ctx.explorationCount++;
      if (isEdit) ctx.editCount++;

      const toolSpan = ctx.tracer.startSpan(`agent.tool.${call.name}`, ctx.rootSpan.toContext());
      toolSpan.setAttributes({ tool: call.name });

      let result: ToolResult;
      const stuckWithoutEdits = ctx.editCount === 0 && stepIndex >= 40 && !editTools.includes(call.name) && call.name !== 'finish' && call.name !== 'publish';
      const explorationBudgetExhausted = ctx.editCount === 0 && ctx.explorationCount > 25 && isExploration;
      if (stuckWithoutEdits || explorationBudgetExhausted) {
        result = {
          success: false,
          output: `Forcing action: you have used ${String(ctx.explorationCount)} exploration steps and made ${String(ctx.editCount)} edits. Stop exploring and use edit_file or write_file to advance the task.`,
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
        const filePath = call.arguments.path.trim();
        const lastRead = ctx.recentReads.get(filePath);
        if (lastRead !== undefined && stepIndex - lastRead < 10) {
          result = {
            success: false,
            output: `Duplicate read rejected: "${filePath}" was already read at step ${String(lastRead)}. Use the previous content or move on to the next concrete step.`,
          };
        } else {
          ctx.recentReads.set(filePath, stepIndex);
          result = await executeTool(ctx.projectPath, call.name, call.arguments);
        }
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string') {
        ctx.consecutiveThinks = 0;
        const command = call.arguments.command.trim();
        if (ctx.recentCommands.has(command)) {
          result = {
            success: false,
            output: `Duplicate command rejected: "${command}" was already run in this session. Do not repeat commands. Use the previous output or move on to the next concrete step.`,
          };
        } else {
          ctx.recentCommands.add(command);
          result = await executeTool(ctx.projectPath, call.name, call.arguments);
        }
      } else {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      }
      toolSpan.setAttributes({ success: result.success });
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
      await ctx.prisma.taskStep.update({
        where: { id: stepId },
        data: {
          status: result.success ? 'done' : 'failed',
          output: result.output,
          error: result.success ? null : result.output,
        },
      });
      await addTrace(ctx, 'tool', result.output, undefined, stepId);
      toolResults.push({ toolCallId: call.id, output: result.output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
      stepIndex++;
    }

    const shouldReflect =
      turnHadFailure || lastTurnHadFailure || (turnCount > 0 && turnCount % 8 === 0);
    lastTurnHadFailure = turnHadFailure;

    if (shouldReflect && !finished) {
      const reflection = await reflectOnTrace(ctx, 6);
      if (reflection) {
        await addTrace(ctx, 'assistant', `Reflection: ${reflection}`);
        messages.push({ role: 'user', content: `Reflection: ${reflection}` });
      }
    }

    if (!finished) {
      messages.push({ role: 'user', content: buildToolResultPrompt(ctx.task, toolResults) });
    }
  }

  // Capture diff
  if (ctx.modifiedFiles.size > 0 || (await hasChanges(ctx.projectPath))) {
    await stageFiles(ctx.projectPath, Array.from(ctx.modifiedFiles));
    await commit(ctx.projectPath, `agent: ${ctx.task.title}`);
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
      result: summary,
      error: success ? null : summary,
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

async function sendToProvider(
  ctx: AgentContext,
  messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[]; tool_call_id?: string }[],
  prompt?: string
): Promise<{ content?: string; toolCalls?: string }> {
  const span = ctx.tracer.startSpan('provider.send', ctx.rootSpan.toContext());
  span.setAttributes({ provider: ctx.provider.config.name, model: ctx.model });
  const provider = ctx.provider as Provider & { sendWithTools?: (prompt: string, tools: ToolDefinition[], opts?: SendOptions) => Promise<string> };

  const onUsage = (usage: UsageInfo): void => {
    recordUsage(ctx, usage);
    span.setAttributes({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  };

  const sendMessages = prompt ? [...messages, { role: 'user' as const, content: prompt }] : messages;

  try {
    // Prefer native tool calls when the provider supports them (including Kimi).
    if (typeof provider.sendWithTools === 'function') {
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

    // Fallback to text-mode JSON tool calls for providers without native tool support.
    const transcript = sendMessages
      .map((m) => {
        const prefix = m.role === 'assistant' && m.tool_calls ? '[assistant tool_calls]' : `[${m.role}]`;
        return `${prefix}\n${m.content ?? ''}`;
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
    span.recordError(err);
    await span.end('error');
    throw err;
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
    const parsed = JSON.parse(text) as { tool_calls?: unknown[]; content?: string };
    if (Array.isArray(parsed.tool_calls)) {
      return { content: parsed.content, toolCalls: JSON.stringify(parsed.tool_calls) };
    }
  } catch {
    // not JSON
  }
  const markdown = parseMarkdownActions(text);
  if (markdown.length > 0) {
    return { content: text, toolCalls: JSON.stringify(markdown) };
  }
  return { content: text };
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
    const parsed = JSON.parse(raw) as {
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
    }[];
    return parsed
      .filter(
        (t): t is { id: string; name: string; arguments?: unknown } =>
          typeof t.id === 'string' && typeof t.name === 'string'
      )
      .map((t) => {
        let args: Record<string, unknown> = {};
        if (typeof t.arguments === 'string') {
          try {
            args = JSON.parse(t.arguments) as Record<string, unknown>;
          } catch {
            args = { raw: t.arguments };
          }
        } else if (typeof t.arguments === 'object' && t.arguments !== null) {
          args = t.arguments as Record<string, unknown>;
        }
        return { id: t.id, name: t.name, arguments: args };
      });
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
      content,
      toolCalls: toolCalls ?? null,
    },
  });
}

async function failTask(prisma: PrismaClient, taskId: string, error: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'failed', error },
  });
}
