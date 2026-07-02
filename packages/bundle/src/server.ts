#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import type { ProviderConfig, Task, Project, RoutingRule } from '@omega/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const rules: RoutingRule[] = [];

// Helpers
function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now() {
  return new Date();
}

function toProviderConfig(row: any): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    defaultModel: row.defaultModel,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : JSON.parse(row.capabilities || '[]'),
    enabled: row.enabled ?? true,
  };
}

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
  const body = req.body;
  const project: Project = {
    id: newId(),
    name: body.name,
    path: body.path,
    repoUrl: body.repoUrl,
    description: body.description,
    env: body.env,
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
  const projectId = req.query.projectId as string | undefined;
  res.json(tasks.filter((t) => (projectId ? t.projectId === projectId : true)));
});

app.post('/tasks', (req, res) => {
  const body = req.body;
  const task: Task = {
    id: newId(),
    projectId: body.projectId,
    title: body.title,
    description: body.description,
    status: 'todo',
    complexity: body.complexity || 'simple',
    tags: body.tags || [],
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

app.post('/tasks/:id/run', async (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'in_progress';
  task.error = undefined;
  task.result = undefined;

  const selection = selectProvider(providerConfigs, rules, task);
  if (!selection) {
    task.status = 'failed';
    task.error = 'No provider available for this task';
    return res.json(task);
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
});

// Providers
app.get('/providers', (_req, res) => {
  res.json(providerConfigs);
});

app.post('/providers', (req, res) => {
  const body = req.body;
  const cfg: ProviderConfig = {
    id: newId(),
    name: body.name,
    kind: body.kind,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    defaultModel: body.defaultModel,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : JSON.parse(body.capabilities || '[]'),
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
  const body = req.body;
  const task: Task = {
    id: 'preview',
    projectId: 'preview',
    title: body.title,
    status: 'todo',
    complexity: body.complexity || 'simple',
    tags: body.tags || [],
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Omega harness server on http://localhost:${PORT}`);
});
