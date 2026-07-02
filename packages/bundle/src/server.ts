#!/usr/bin/env node
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import type { RoutingRule } from '@omega/router';
import type { ProviderConfig, Task, Project, Capability, ToolDefinition } from '@omega/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const app = express();
app.use(cors());
app.use(express.json());

// In-memory stores
const projects: Project[] = [];
const tasks: Task[] = [];
let providerConfigs: ProviderConfig[] = [
  {
    id: 'default-ollama',
    name: 'ollama-local',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    capabilities: [{ name: 'llama3', level: 'capable' }],
    enabled: true,
  },
];

if (process.env.KIMI_API_KEY) {
  providerConfigs.push({
    id: 'default-kimi',
    name: 'kimi',
    kind: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: process.env.KIMI_API_KEY,
    defaultModel: 'moonshot-v1-8k',
    capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced' }],
    enabled: true,
  });
}
const rules: RoutingRule[] = [];

// Helpers
function newId() {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2)}`;
}

function now() {
  return new Date();
}

function parseCapabilities(value: unknown): Capability[] {
  if (Array.isArray(value)) return value as Capability[];
  if (typeof value === 'string') return JSON.parse(value) as Capability[];
  return [];
}

const projectCreateSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  repoUrl: z.string().optional(),
  description: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const taskCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
});

const providerCreateSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['openai', 'anthropic', 'ollama', 'gemini', 'kimi', 'generic']),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  defaultModel: z.string().min(1),
  capabilities: z.union([z.string(), z.array(z.any())]).optional(),
  enabled: z.boolean().optional(),
});

const routerSelectSchema = z.object({
  title: z.string().min(1),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
});

// Projects
app.get('/projects', (_req, res) => {
  res.json(
    projects.map((p) => ({
      ...p,
      _count: { tasks: tasks.filter((t) => t.projectId === p.id).length },
    }))
  );
});

app.post('/projects', (req, res) => {
  const body = projectCreateSchema.parse(req.body);
  const project: Project = {
    id: newId(),
    ...body,
    createdAt: now(),
  };
  projects.push(project);
  res.status(201).json(project);
});

app.delete('/projects/:id', (req, res) => {
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx >= 0) projects.splice(idx, 1);
  res.status(204).send();
});

// Tasks
app.get('/tasks', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(tasks.filter((t) => (projectId ? t.projectId === projectId : true)));
});

app.post('/tasks', (req, res) => {
  const body = taskCreateSchema.parse(req.body);
  const task: Task = {
    id: newId(),
    ...body,
    status: 'todo',
    createdAt: now(),
    updatedAt: now(),
  };
  tasks.push(task);
  res.status(201).json(task);
});

app.patch('/tasks/:id', (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body, { updatedAt: now() });
  res.json(task);
});

app.post('/tasks/:id/run', asyncHandler(async (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  task.status = 'in_progress';
  task.error = undefined;
  task.result = undefined;

  const selection = selectProvider(providerConfigs, rules, task);
  if (!selection) {
    task.status = 'failed';
    task.error = 'No provider available for this task';
    res.json(task);
    return;
  }

  try {
    const provider = createProvider(selection.provider);
    const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
    const result = await provider.send(prompt, { model: selection.model });
    task.status = 'done';
    task.result = result;
    task.assignedModel = { provider: selection.provider.name, model: selection.model };
  } catch (err) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : String(err);
  }

  res.json(task);
}));

// Providers
app.get('/providers', (_req, res) => {
  res.json(providerConfigs);
});

app.post('/providers', (req, res) => {
  const body = providerCreateSchema.parse(req.body);
  const cfg: ProviderConfig = {
    id: newId(),
    ...body,
    capabilities: parseCapabilities(body.capabilities),
    enabled: body.enabled ?? true,
  };
  providerConfigs.push(cfg);
  res.status(201).json(cfg);
});

app.patch('/providers/:id/toggle', (req, res) => {
  const cfg = providerConfigs.find((c) => c.id === req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Provider not found' });
  cfg.enabled = !cfg.enabled;
  res.json(cfg);
});

app.delete('/providers/:id', (req, res) => {
  providerConfigs = providerConfigs.filter((c) => c.id !== req.params.id);
  res.status(204).send();
});

// Router preview
app.post('/router/select', (req, res) => {
  const body = routerSelectSchema.parse(req.body);
  const task: Task = {
    id: 'preview',
    projectId: 'preview',
    ...body,
    status: 'todo',
    createdAt: now(),
    updatedAt: now(),
  };
  const selection = selectProvider(providerConfigs, rules, task);
  if (!selection) return res.status(404).json({ error: 'No provider available' });
  res.json({ provider: selection.provider.name, model: selection.model });
});

// Static web UI
const webDir = path.join(__dirname, 'web');
app.use(express.static(webDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`Omega harness server on http://localhost:${PORT.toString()}`);
});

const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);
const GRPC_PROTO_PATH = path.join(__dirname, 'proto/tasks.proto');

const grpcPackageDef = protoLoader.loadSync(GRPC_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const grpcProto = grpc.loadPackageDefinition(grpcPackageDef) as unknown as {
  omega: {
    TaskIngestion: grpc.ServiceClientConstructor;
  };
};

interface SubmitTaskRequest {
  project_id: string;
  title: string;
  description?: string;
  complexity?: string;
  tags?: string[];
  auto_run?: boolean;
}

function parseGrpcRequest(req: unknown): SubmitTaskRequest {
  const r = req as Record<string, unknown>;
  return {
    project_id: typeof r.project_id === 'string' ? r.project_id : '',
    title: typeof r.title === 'string' ? r.title : '',
    description: typeof r.description === 'string' ? r.description : undefined,
    complexity: typeof r.complexity === 'string' ? r.complexity : undefined,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : undefined,
    auto_run: typeof r.auto_run === 'boolean' ? r.auto_run : undefined,
  };
}

function isValidComplexity(value: string): value is 'simple' | 'medium' | 'complex' {
  return ['simple', 'medium', 'complex'].includes(value);
}

const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file relative to project root.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
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
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
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
];

const AGENT_SYSTEM_PROMPT = `You are Omega, an autonomous software engineering agent. Respond with JSON: {"tool_calls":[{"id":"1","name":"tool_name","arguments":{}}]}. Available tools: read_file, write_file, run_command, finish. Work in small steps, run tests, and finish when done.`;

function argString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return JSON.stringify(value);
}

async function executeBundleTool(
  projectPath: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  const target = (file: string) => {
    const resolved = path.resolve(projectPath, file);
    if (!resolved.startsWith(path.resolve(projectPath))) throw new Error('Path traversal blocked');
    return resolved;
  };
  try {
    switch (name) {
      case 'read_file': {
        const content = await fs.readFile(target(argString(args.path)), 'utf-8');
        return { success: true, output: content };
      }
      case 'write_file': {
        const p = target(argString(args.path));
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, argString(args.content), 'utf-8');
        return { success: true, output: `Wrote ${argString(args.path)}` };
      }
      case 'run_command': {
        const [cmd, ...cmdArgs] = argString(args.command).split(' ');
        const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
          cwd: projectPath,
          timeout: 120_000,
          shell: false,
        });
        return { success: true, output: stdout + stderr };
      }
      default:
        return { success: false, output: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

function parseBundleToolCalls(raw: string): { id: string; name: string; arguments: Record<string, unknown> }[] {
  try {
    const cleaned = raw.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned) as { tool_calls?: unknown[] };
    if (!Array.isArray(parsed.tool_calls)) return [];
    const calls = parsed.tool_calls as { id?: string; name?: string; arguments?: Record<string, unknown> }[];
    return calls
      .filter((t): t is { id: string; name: string; arguments: Record<string, unknown> } => Boolean(t.id && t.name))
      .map((t) => ({ id: t.id, name: t.name, arguments: t.arguments }));
  } catch {
    return [];
  }
}

async function executeAgentTask(task: Task) {
  task.status = 'in_progress';
  task.error = undefined;
  task.result = undefined;

  const project = projects.find((p) => p.id === task.projectId);
  if (!project) {
    task.status = 'failed';
    task.error = 'Project not found for agent task';
    return;
  }

  const selection = selectProvider(providerConfigs, rules, task);
  if (!selection) {
    task.status = 'failed';
    task.error = 'No provider available for this task';
    return;
  }

  try {
    const provider = createProvider(selection.provider);
    const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
    let response: string;
    if ('sendWithTools' in provider && typeof provider.sendWithTools === 'function') {
      response = await provider.sendWithTools(prompt, AGENT_TOOLS, {
        system: AGENT_SYSTEM_PROMPT,
        model: selection.model,
      });
    } else {
      response = await provider.send(prompt, { system: AGENT_SYSTEM_PROMPT, model: selection.model });
    }

    const calls = parseBundleToolCalls(response);
    const results: string[] = [];
    for (const call of calls) {
      if (call.name === 'finish') {
        task.status = call.arguments.success ? 'done' : 'failed';
        const summaryArg = call.arguments.summary;
        task.result = typeof summaryArg === 'string' ? summaryArg : '';
        break;
      }
      const result = await executeBundleTool(project.path, call.name, call.arguments);
      results.push(`${call.name}: ${result.output}`);
    }
    if (calls.length > 0 && calls.every((c) => c.name !== 'finish')) {
      task.status = 'done';
      task.result = results.join('\n');
    }
    task.assignedModel = { provider: selection.provider.name, model: selection.model };
  } catch (err: unknown) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : String(err);
  }
}

async function executeTask(task: Task) {
  task.status = 'in_progress';
  task.error = undefined;
  task.result = undefined;

  if (task.tags.includes('agent') || task.tags.includes('self-improve')) {
    return executeAgentTask(task);
  }

  const selection = selectProvider(providerConfigs, rules, task);
  if (!selection) {
    task.status = 'failed';
    task.error = 'No provider available for this task';
    return;
  }

  try {
    const provider = createProvider(selection.provider);
    const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
    const result = await provider.send(prompt, { model: selection.model });
    task.status = 'done';
    task.result = result;
    task.assignedModel = { provider: selection.provider.name, model: selection.model };
  } catch (err: unknown) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : String(err);
  }
}

const grpcServer = new grpc.Server();
grpcServer.addService(grpcProto.omega.TaskIngestion.service, {
  submitTask: (call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
    void (async () => {
      try {
        const req = parseGrpcRequest(call.request);
        if (!req.project_id || !req.title) {
          callback(
            { code: grpc.status.INVALID_ARGUMENT, message: 'project_id and title are required' },
            null
          );
          return;
        }

        const complexity = isValidComplexity(req.complexity ?? '') ? req.complexity : 'simple';
        const task: Task = {
          id: newId(),
          projectId: req.project_id,
          title: req.title,
          description: req.description ?? undefined,
          status: 'todo',
          complexity,
          tags: req.tags ?? [],
          createdAt: now(),
          updatedAt: now(),
        };
        tasks.push(task);

        if (req.auto_run) {
          await executeTask(task);
        }

        callback(null, { id: task.id, status: task.status, error: task.error ?? '' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        callback({ code: grpc.status.INTERNAL, message }, null);
      }
    })();
  },

  streamTasks: (call: grpc.ServerWritableStream<unknown, unknown>) => {
    const req = call.request as { project_id?: string };
    const projectId = req.project_id;
    let cancelled = false;

    const interval = setInterval(() => {
      if (cancelled) return;
      const filtered = projectId ? tasks.filter((t) => t.projectId === projectId) : tasks;
      for (const task of filtered.slice(-20)) {
        call.write({
          id: task.id,
          title: task.title,
          status: task.status,
          provider: task.assignedModel?.provider ?? '',
          model: task.assignedModel?.model ?? '',
          result: task.result ?? '',
          error: task.error ?? '',
        });
      }
    }, 1000);

    call.on('cancelled', () => {
      cancelled = true;
      clearInterval(interval);
    });

    call.on('error', () => {
      cancelled = true;
      clearInterval(interval);
    });
  },
});

grpcServer.bindAsync(`0.0.0.0:${GRPC_PORT.toString()}`, grpc.ServerCredentials.createInsecure(), (err) => {
  if (err) {
    console.error('gRPC server failed to start:', err);
    return;
  }
  console.log(`gRPC task ingestion on 0.0.0.0:${GRPC_PORT.toString()}`);
});

