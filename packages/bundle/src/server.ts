#!/usr/bin/env node
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import type { RoutingRule } from '@omega/router';
import type { ProviderConfig, Task, Project, Capability } from '@omega/core';

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
