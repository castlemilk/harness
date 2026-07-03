import type { PrismaClient } from '@omega/db';
import type { Provider, ProviderConfig, Task, AgentOptions, ToolCall, SendOptions, ToolDefinition } from '@omega/core';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import { createPlan } from './planner.js';
import { executeTool } from './tools.js';
import { validateProject, type ValidationSummary } from './validator.js';
import { publishOmega, type PublishResult } from './publisher.js';
import {
  buildTaskPrompt,
  buildToolResultPrompt,
  AGENT_SYSTEM_PROMPT,
  FORCE_ACTION_PROMPT,
  TEXT_TOOLS_SYSTEM_PROMPT,
} from './prompts.js';
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
} from './git.js';

const ALL_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file relative to project root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file relative to project root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'think',
    description: 'Record reasoning.',
    parameters: {
      type: 'object',
      properties: { thought: { type: 'string' } },
      required: ['thought'],
    },
  },
  {
    name: 'finish',
    description: 'Mark the task complete.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' }, success: { type: 'boolean' } },
      required: ['summary', 'success'],
    },
  },
  {
    name: 'publish',
    description: 'Build, validate, and publish the project.',
    parameters: {
      type: 'object',
      properties: { version: { type: 'string' } },
      required: [],
    },
  },
];

export interface AgentResult {
  task: Task;
  agentRunId: string;
  validation?: ValidationSummary;
  publish?: PublishResult;
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

  const branchResult = await createBranch(options.projectPath, branch, baseCommit.output);
  if (!branchResult.success) {
    // Branch may already exist; try to checkout.
    await checkoutBranch(options.projectPath, branch);
  }

  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      branch,
      baseCommit: baseCommit.output,
      resultStatus: 'running',
    },
  });

  const ctx: AgentContext = {
    prisma,
    task: toCoreTask(task),
    projectPath: options.projectPath,
    projectName: options.projectName,
    provider,
    model: selection.model,
    branch,
    baseCommit: baseCommit.output,
    agentRunId: agentRun.id,
    autoPublish: options.autoPublish ?? false,
    maxSteps: options.maxSteps ?? 30,
    modifiedFiles: new Set<string>(),
  };

  try {
    const result = await executeAgentLoop(ctx);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(prisma, taskId, message);
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { resultStatus: 'failed' },
    });
    throw err;
  } finally {
    await checkoutBranch(options.projectPath, baseBranch.output);
    if (stashed) {
      await popStash(options.projectPath);
    }
  }
}

async function executeAgentLoop(ctx: AgentContext): Promise<AgentResult> {
  // Initial planning trace
  await addTrace(ctx, 'system', AGENT_SYSTEM_PROMPT);
  await addTrace(ctx, 'user', buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined));

  const plan = await createPlan(ctx.provider, ctx.task.title, ctx.task.description ?? undefined);
  await addTrace(ctx, 'assistant', `Plan: ${JSON.stringify(plan)}`);

  // Record plan as steps
  for (let i = 0; i < plan.plan.length; i++) {
    await ctx.prisma.taskStep.create({
      data: {
        taskId: ctx.task.id,
        idx: i,
        name: plan.plan[i]?.name ?? `step-${i.toString()}`, 
        status: 'pending',
        input: plan.plan[i]?.tool ? JSON.stringify(plan.plan[i]?.input ?? {}) : undefined,
      },
    });
  }

  let stepIndex = 0;
  let finished = false;
  let success = false;
  let summary = '';
  let noActionCount = 0;

  // Start the first turn with a think/plan step.
  let prompt = `Plan created: ${JSON.stringify(plan)}\n\nExecute the plan. Use tools to make changes and run validation.`;

  while (stepIndex < ctx.maxSteps && !finished) {
    const response = await sendToProvider(ctx, prompt);
    await addTrace(ctx, 'assistant', response.content ?? '', response.toolCalls);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      noActionCount++;
      if (noActionCount >= 2) {
        prompt = FORCE_ACTION_PROMPT;
      } else {
        prompt = 'No tool calls detected. Please respond with a JSON object containing tool_calls.';
      }
      continue;
    }
    noActionCount = 0;

    const toolCalls = parseToolCalls(response.toolCalls);
    const toolResults: { toolCallId: string; output: string }[] = [];

    for (const call of toolCalls) {
      const step = await ctx.prisma.taskStep.findFirst({
        where: { taskId: ctx.task.id, idx: stepIndex },
      });
      const stepId = step?.id;

      if (call.name === 'finish') {
        finished = true;
        success = Boolean(call.arguments.success);
        const summaryArg = call.arguments.summary;
        summary = typeof summaryArg === 'string' ? summaryArg : '';
        if (stepId) {
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: { status: success ? 'done' : 'failed', output: summary },
          });
        }
        toolResults.push({ toolCallId: call.id, output: summary });
        break;
      }

      if (call.name === 'publish') {
        const validation = await validateProject(ctx.projectPath);
        await ctx.prisma.agentRun.update({
          where: { id: ctx.agentRunId },
          data: { validationSummary: JSON.stringify(validation) },
        });

        let publishResult: PublishResult | undefined;
        if (ctx.autoPublish && validation.allPassed) {
          publishResult = await publishOmega(ctx.projectPath, call.arguments.version as string | undefined);
        }

        toolResults.push({
          toolCallId: call.id,
          output: JSON.stringify({ validation, publish: publishResult }),
        });
        if (stepId) {
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: {
              status: validation.allPassed ? 'done' : 'failed',
              output: JSON.stringify({ validation, publish: publishResult }),
            },
          });
        }
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

      const result = await executeTool(ctx.projectPath, call.name, call.arguments);
      if (stepId) {
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: {
            status: result.success ? 'done' : 'failed',
            output: result.output,
            error: result.success ? null : result.output,
          },
        });
      }
      await addTrace(ctx, 'tool', result.output, undefined, stepId);
      toolResults.push({ toolCallId: call.id, output: result.output });
      stepIndex++;
    }

    prompt = buildToolResultPrompt(toolResults);
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
    data: { resultStatus: success ? 'done' : 'failed' },
  });

  return {
    task: toCoreTask(updatedTask),
    agentRunId: ctx.agentRunId,
  };
}

async function sendToProvider(
  ctx: AgentContext,
  prompt: string
): Promise<{ content?: string; toolCalls?: string }> {
  const provider = ctx.provider as Provider & { sendWithTools?: (prompt: string, tools: ToolDefinition[], opts?: SendOptions) => Promise<string> };

  if (provider.config.kind !== 'kimi' && typeof provider.sendWithTools === 'function') {
    const raw = await provider.sendWithTools(prompt, ALL_TOOLS, {
      system: AGENT_SYSTEM_PROMPT,
      model: ctx.model,
      temperature: 0.3,
    });
    return parseProviderResponse(raw);
  }

  const raw = await provider.send(prompt, {
    system: TEXT_TOOLS_SYSTEM_PROMPT,
    model: ctx.model,
  });
  return parseProviderResponse(raw);
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
        (t): t is { id: string; name: string; arguments: Record<string, unknown> } =>
          typeof t.id === 'string' && typeof t.name === 'string' &&
          typeof t.arguments === 'object' && t.arguments !== null
      )
      .map((t) => ({ id: t.id, name: t.name, arguments: t.arguments }));
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
