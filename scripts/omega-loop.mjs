#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateAndPromoteCandidate } from './self-improve-gates.mjs';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '..', '..');

function parseInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createLoopConfig(env = process.env, homeDir = os.homedir(), projectRoot = root) {
  const storageRoot = env.OMEGA_STORAGE_ROOT ?? path.join(homeDir, '.omega');
  return {
    apiUrl: env.OMEGA_LOOP_API_URL ?? 'http://localhost:4000',
    projectId: env.OMEGA_LOOP_PROJECT_ID,
    projectName: env.OMEGA_LOOP_PROJECT_NAME ?? 'omega-harness',
    projectPath: env.OMEGA_LOOP_PROJECT_PATH ?? projectRoot,
    storageRoot,
    iterationsDir: path.join(storageRoot, 'iterations'),
    maxIterations: parseInteger(env.OMEGA_LOOP_MAX_ITERATIONS, 3),
    intervalMs: parseInteger(env.OMEGA_LOOP_INTERVAL_MS, 60000),
    taskTimeoutMs: parseInteger(env.OMEGA_LOOP_TASK_TIMEOUT_MS, 1800000),
    provider: env.OMEGA_LOOP_PROVIDER,
    model: env.OMEGA_LOOP_MODEL,
    tokenBudget: parseInteger(env.OMEGA_LOOP_TOKEN_BUDGET, undefined),
    autoPublish: env.OMEGA_LOOP_AUTO_PUBLISH === 'true',
    validate: env.OMEGA_LOOP_VALIDATE !== 'false',
    maxConsecutiveFailures: parseInteger(env.OMEGA_LOOP_MAX_CONSECUTIVE_FAILURES, 2),
    promotionBranch: env.OMEGA_LOOP_PROMOTION_BRANCH ?? 'main',
    defaultPrompt:
      env.OMEGA_LOOP_PROMPT ??
    'Review the Omega harness codebase. Run lint and the e2e tests. Identify the highest-impact improvement you can make, implement it with the available tools, run validation, and finish with a concise summary of what changed.',
  };
}

const config = createLoopConfig();

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findProjectByPath() {
  const res = await fetch(`${config.apiUrl}/projects`);
  if (!res.ok) return undefined;
  const projects = await res.json();
  return projects.find((p) => p.path === config.projectPath);
}

async function ensureProject() {
  if (config.projectId) {
    const res = await fetch(`${config.apiUrl}/projects/${config.projectId}`);
    if (res.ok) return config.projectId;
    console.warn(`Configured project ${config.projectId} not found, creating a new one.`);
  }
  const existing = await findProjectByPath();
  if (existing) {
    console.log(`Reusing existing project: ${existing.id}`);
    return existing.id;
  }
  const res = await fetch(`${config.apiUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: config.projectName,
      path: config.projectPath,
    }),
  });
  if (!res.ok) throw new Error(`Could not create project: ${res.status} ${await res.text()}`);
  const project = await res.json();
  console.log(`Created loop project: ${project.id}`);
  return project.id;
}

export async function submitSelfImproveTask(projectId, loopConfig = config) {
  const tags = ['self-improve'];
  const title = loopConfig.defaultPrompt.length > 120 ? `${loopConfig.defaultPrompt.slice(0, 120)}...` : loopConfig.defaultPrompt;
  const res = await fetch(`${loopConfig.apiUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      title,
      description: loopConfig.defaultPrompt,
      complexity: 'complex',
      tags,
    }),
  });
  if (!res.ok) throw new Error(`Could not submit task: ${res.status} ${await res.text()}`);
  const task = await res.json();
  if (!loopConfig.provider && !loopConfig.model) return task;

  const pin = {};
  if (loopConfig.provider) pin.provider = loopConfig.provider;
  if (loopConfig.model) pin.model = loopConfig.model;
  const pinned = await fetch(`${loopConfig.apiUrl}/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pin),
  });
  if (!pinned.ok) throw new Error(`Could not pin task ${task.id}: ${pinned.status} ${await pinned.text()}`);
  return pinned.json();
}

export async function runTask(taskId, loopConfig = config) {
  const body = {};
  if (loopConfig.tokenBudget !== undefined) body.tokenBudget = loopConfig.tokenBudget;
  const res = await fetch(`${loopConfig.apiUrl}/tasks/${taskId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Could not run task: ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForTask(taskId, maxMs = 300000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${config.apiUrl}/tasks/${taskId}`);
    if (!res.ok) throw new Error('Failed to fetch task');
    const task = await res.json();
    if (task.status === 'done' || task.status === 'failed') return task;
    await sleep(1000);
  }
  throw new Error(`Task ${taskId} did not finish within ${maxMs}ms`);
}

async function fetchArtifacts(taskId) {
  const [tracesRes, diffsRes, stepsRes, agentRunRes] = await Promise.all([
    fetch(`${config.apiUrl}/tasks/${taskId}/traces`),
    fetch(`${config.apiUrl}/tasks/${taskId}/diffs`),
    fetch(`${config.apiUrl}/tasks/${taskId}/steps`),
    fetch(`${config.apiUrl}/tasks/${taskId}/agent-run`),
  ]);
  const artifacts = {};
  if (tracesRes.ok) artifacts.traces = await tracesRes.json();
  if (diffsRes.ok) artifacts.diffs = await diffsRes.json();
  if (stepsRes.ok) artifacts.steps = await stepsRes.json();
  if (agentRunRes.ok) artifacts.agentRun = await agentRunRes.json();
  return artifacts;
}

function buildIterationReport(iteration, task, artifacts, gate) {
  let md = `# Self-Improve Iteration ${iteration}\n\n`;
  md += `- **Started:** ${new Date().toISOString()}\n`;
  md += `- **Task ID:** ${task.id}\n`;
  md += `- **Status:** ${task.status}\n`;
  md += `- **Model:** ${task.provider ?? '-'}/${task.model ?? '-'}\n`;
  md += `- **Auto-publish:** ${config.autoPublish ? 'deferred until explicit post-promotion release' : 'disabled'}\n\n`;

  md += `## Task Result\n\n`;
  md += '```\n';
  md += task.result ?? task.error ?? '(no output)';
  md += '\n```\n\n';

  if (artifacts.agentRun) {
    md += `## Agent Run\n\n`;
    md += `- Branch: \`${artifacts.agentRun.branch}\`\n`;
    md += `- Base commit: \`${artifacts.agentRun.baseCommit}\`\n`;
    md += `- Result: ${artifacts.agentRun.resultStatus}\n\n`;
  }

  if (artifacts.steps?.length) {
    md += `## Steps\n\n`;
    md += '| # | Name | Status |\n|---|------|--------|\n';
    for (const step of artifacts.steps) {
      md += `| ${step.idx} | ${step.name} | ${step.status} |\n`;
    }
    md += '\n';
  }

  if (artifacts.diffs?.length) {
    md += `## Diff\n\n`;
    md += '```diff\n';
    md += artifacts.diffs[0]?.patch ?? '';
    md += '\n```\n\n';
  }

  if (artifacts.traces?.length) {
    md += `## Traces (${artifacts.traces.length})\n\n`;
    for (const trace of artifacts.traces.slice(-10)) {
      md += `### ${trace.role}\n`;
      md += '```\n';
      md += trace.content.slice(0, 2000);
      md += '\n```\n\n';
    }
  }

  md += `## Candidate Gate\n\n`;
  md += `- Passed: ${gate.passed ? 'yes' : 'no'}\n`;
  md += `- Promoted: ${gate.promoted ? 'yes' : 'no'}\n`;
  for (const reason of gate.reasons ?? []) md += `- Reason: ${reason}\n`;
  if (gate.branch) md += `- Branch: \`${gate.branch}\`\n`;
  if (gate.candidateCommit) md += `- Candidate commit: \`${gate.candidateCommit}\`\n`;
  if (gate.benchmarkGate?.metrics) {
    md += `\n| Metric | Baseline | Candidate | Max allowed | Result |\n|---|---:|---:|---:|---|\n`;
    for (const [name, metric] of Object.entries(gate.benchmarkGate.metrics)) {
      md += `| ${name} | ${metric.baselineMs}ms | ${metric.candidateMs}ms | ${Math.round(metric.maxAllowedMs)}ms | ${metric.passed ? 'pass' : 'fail'} |\n`;
    }
  }
  if (gate.candidateValidation?.steps) {
    md += `\n### Candidate Validation\n\n`;
    for (const step of gate.candidateValidation.steps) md += `- ${step.name}: ${step.passed ? 'pass' : 'fail'}${step.timedOut ? ' (timed out)' : ''}\n`;
  }
  md += '\n';

  return md;
}

async function main() {
  await fs.mkdir(iterationsDir, { recursive: true });
  console.log('Omega self-improve loop starting with config:');
  console.log(JSON.stringify({ ...config, defaultPrompt: config.defaultPrompt.slice(0, 120) + '...' }, null, 2));

  const projectId = await ensureProject();
  let consecutiveFailures = 0;

  for (let i = 1; i <= config.maxIterations; i++) {
    console.log(`\n=== Iteration ${i}/${config.maxIterations} ===`);
    const iterStart = Date.now();

    let task;
    let artifacts = {};
    let gate = { passed: false, reasons: ['candidate gate not evaluated'] };

    try {
      task = await submitSelfImproveTask(projectId, config);
      console.log(`Submitted self-improve task ${task.id}`);
      await runTask(task.id, config);
      task = await waitForTask(task.id, config.taskTimeoutMs);
      console.log(`Task finished with status: ${task.status}`);
      artifacts = await fetchArtifacts(task.id);

      if (!config.validate) {
        gate = { passed: false, reasons: ['candidate validation is disabled; promotion refused'] };
      } else if (task.status === 'done') {
        console.log('Validating candidate branch and comparing benchmarks...');
        gate = await validateAndPromoteCandidate({
          projectPath: config.projectPath,
          branch: artifacts.agentRun?.branch,
          baseCommit: artifacts.agentRun?.baseCommit,
          taskStatus: task.status,
          agentRunStatus: artifacts.agentRun?.resultStatus,
          diffPatch: artifacts.diffs?.[0]?.patch,
          iteration: i,
           storageRoot: config.storageRoot,
          validationTimeoutMs: config.taskTimeoutMs,
          promotionBranch: config.promotionBranch,
        });
      }

      if (task.status === 'done' && gate.passed) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`Iteration ${i} failed:`, err);
      task = task ?? { id: 'unknown', status: 'failed', error: String(err) };
    }

    const report = buildIterationReport(i, task, artifacts, gate);
    const reportPath = path.join(config.iterationsDir, `iteration-${i}-${nowIso()}.md`);
    await fs.writeFile(reportPath, report, 'utf-8');
    console.log(`Iteration report written to ${reportPath}`);

    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      console.error(`Stopping after ${consecutiveFailures} consecutive failures.`);
      process.exit(1);
    }

    const elapsed = Date.now() - iterStart;
    const remaining = config.intervalMs - elapsed;
    if (remaining > 0 && i < config.maxIterations) {
      console.log(`Sleeping ${remaining}ms before next iteration...`);
      await sleep(remaining);
    }
  }

  console.log('\nSelf-improve loop complete.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
