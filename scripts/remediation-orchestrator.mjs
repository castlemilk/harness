#!/usr/bin/env node
/**
 * Remediation Orchestrator
 * 
 * Reads a backlog of atomic tasks, distributes them across LLM providers,
 * runs each task against multiple models, collects diffs, and produces
 * a consensus comparison report.
 * 
 * Usage:
 *   node scripts/remediation-orchestrator.mjs [backlog.json] [--concurrency=4] [--dry-run] [--review]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { join } from 'path';

const API = process.env.OMEGA_API || 'http://localhost:4000';
const DRY_RUN = process.argv.includes('--dry-run');
const WITH_REVIEW = process.argv.includes('--review');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const CONCURRENCY = parseInt(flags.find(f => f.startsWith('--concurrency='))?.split('=')[1] || '4', 10);
const BACKLOG_PATH = args[0] || join(import.meta.dirname, 'remediation-backlog.json');
const RESULTS_DIR = join(import.meta.dirname, '..', 'docs', 'remediation-results');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function createWorktree(taskId) {
  const wt = `/tmp/remediation-orchestrator/${taskId}`;
  const branch = `orchestrator/${taskId}`;
  
  // Clean up any existing state — must remove worktree before branch
  try { execSync(`git worktree remove --force "${wt}"`, { cwd: process.cwd(), stdio: 'ignore' }); } catch { /* empty */ }
  try { execSync(`rm -rf "${wt}"`, { stdio: 'ignore' }); } catch { /* empty */ }
  try { execSync(`git branch -D "${branch}"`, { cwd: process.cwd(), stdio: 'ignore' }); } catch { /* empty */ }
  
  execSync(`git worktree add "${wt}" -b "${branch}" HEAD`, { 
    cwd: process.cwd(), stdio: 'pipe' 
  });
  return wt;
}

function getDiff(worktreePath) {
  try {
    const base = execSync('git merge-base HEAD main 2>/dev/null', { cwd: worktreePath, encoding: 'utf-8' }).trim();
    if (base) {
      const diff = execSync(`git diff ${base} HEAD`, { cwd: worktreePath, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (diff.trim()) return diff;
    }
      } catch { /* empty */ }
  try {
    const diff = execSync('git diff HEAD~1', { cwd: worktreePath, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    if (diff.trim()) return diff;
  } catch { /* empty */ }
  try {
    return execSync('git diff HEAD', { cwd: worktreePath, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
  } catch {
    return '';
  }
}

function getFilesChanged(worktreePath) {
  try {
    const base = execSync('git merge-base HEAD main 2>/dev/null', { cwd: worktreePath, encoding: 'utf-8' }).trim();
    if (base) {
      const files = execSync(`git diff --name-only ${base} HEAD`, { cwd: worktreePath, encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean);
      if (files.length > 0) return files;
    }
      } catch { /* empty */ }
  try {
    const files = execSync('git diff --name-only HEAD~1', { cwd: worktreePath, encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
    if (files.length > 0) return files;
  } catch { /* empty */ }
  try {
    return execSync('git diff --name-only HEAD', { cwd: worktreePath, encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Concurrency Pool ───────────────────────────────────────────────────────

class Pool {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }
  async run(fn) {
    while (this.running >= this.limit) {
      await new Promise(r => this.queue.push(r));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length) this.queue.shift()();
    }
  }
}

// ─── Task Monitor ───────────────────────────────────────────────────────────

async function waitForTask(taskId, timeoutMs = 60 * 60 * 1000, pollMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await api('GET', `/tasks/${taskId}`);
    if (task.status === 'done' || task.status === 'failed') {
      return task;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  // Timeout — return current state
  return api('GET', `/tasks/${taskId}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const backlog = JSON.parse(readFileSync(BACKLOG_PATH, 'utf-8'));
  const { tasks, providers } = backlog;

  log('init', `Backlog: ${tasks.length} tasks × ${providers.length} providers = ${tasks.length * providers.length} runs`);
  log('init', `Concurrency: ${CONCURRENCY}, Dry run: ${DRY_RUN}`);

  mkdirSync(RESULTS_DIR, { recursive: true });

  // Phase 1: Create projects for each task's worktree
  log('phase1', 'Creating worktrees and projects...');
  const taskWorktrees = {};
  const taskProjects = {};

  for (const task of tasks) {
    const wt = createWorktree(task.id);
    taskWorktrees[task.id] = wt;

    if (!DRY_RUN) {
      const project = await api('POST', '/projects', {
        name: `orchestrator-${task.id}`,
        path: wt,
      });
      taskProjects[task.id] = project.id;
      log('phase1', `Task ${task.id}: worktree=${wt}, project=${project.id}`);
    } else {
      log('phase1', `Task ${task.id}: worktree=${wt} (dry run)`);
    }
  }

  // Phase 2: Create and launch all task × provider combinations
  log('phase2', 'Creating tasks and launching runs...');
  const runs = []; // { taskId, provider, harnessTaskId, promise }

  for (const task of tasks) {
    for (const provider of providers) {
      const runId = `${task.id}__${provider.id}`;
      
      if (DRY_RUN) {
        log('phase2', `[dry-run] Would create: ${runId}`);
        continue;
      }

      // Create harness task with provider pinned
      const harnessTask = await api('POST', '/tasks', {
        projectId: taskProjects[task.id],
        title: `[${provider.id}] ${task.title}`,
        description: task.prompt,
        complexity: 'medium',
        tags: ['remediation', 'orchestrator', 'agent', 'skip-validation', 'retain-worktree', task.id, provider.id],
      });

      // Pin provider/model
      await api('PATCH', `/tasks/${harnessTask.id}`, {
        provider: provider.id,
        model: provider.model,
      });

      log('phase2', `Created task ${harnessTask.id} for ${runId}`);

      // Launch run
      const promise = api('POST', `/tasks/${harnessTask.id}/run`, {})
        .then(() => waitForTask(harnessTask.id, 60 * 60 * 1000)) // 60min timeout per run
        .then(task => ({ runId, task, provider: provider.id, model: provider.model }));

      runs.push({ runId, taskId: task.id, provider: provider.id, harnessTaskId: harnessTask.id, promise });
    }
  }

  if (DRY_RUN) {
    log('phase2', 'Dry run complete. Exiting.');
    return;
  }

  // Phase 3: Monitor all runs with concurrency
  log('phase3', `Monitoring ${runs.length} runs (concurrency=${CONCURRENCY})...`);
  const pool = new Pool(CONCURRENCY);
  
  const results = await Promise.all(
    runs.map(r => pool.run(async () => {
      log('run', `Starting ${r.runId}...`);
      try {
        const result = await r.promise;
        log('run', `${r.runId}: ${result.task.status} (${result.task.result?.slice(0, 80) || 'no result'})`);
        return result;
      } catch (err) {
        log('run', `${r.runId}: ERROR — ${err.message}`);
        return { runId: r.runId, task: { status: 'failed', error: err.message }, provider: r.provider };
      }
    }))
  );

  // Phase 4: Collect diffs from agent worktrees
  log('phase4', 'Collecting diffs from agent worktrees...');
  const diffResults = {};
  const NOISE_FILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'packages/db/generated/'];

  for (const task of tasks) {
      // Find agent worktrees for this task (they're in OMEGA_STORAGE_ROOT/work/worktrees/)
      const agentWts = [];
      try {
        // Try .env first for OMEGA_STORAGE_ROOT, then env, then default
        let storageRoot = process.env.OMEGA_STORAGE_ROOT;
        if (!storageRoot) {
          try {
            const envFile = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf-8');
            const match = envFile.match(/^OMEGA_STORAGE_ROOT=(.+)$/m);
            if (match) storageRoot = match[1].trim();
          } catch { /* empty */ }
        }
        const omegaRoot = storageRoot || join(process.env.HOME, '.omega');
        const wtBase = join(omegaRoot, 'work', 'worktrees');
      const entries = execSync(`ls "${wtBase}" 2>/dev/null || true`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
      for (const entry of entries) {
        if (entry.includes(task.id)) agentWts.push(join(wtBase, entry));
      }
    } catch { /* empty */ }

    let bestDiff = '';
    let bestFiles = [];
    let bestProvider = 'none';

    for (const wt of agentWts) {
      const diff = getDiff(wt);
      const files = getFilesChanged(wt);
      const meaningfulFiles = files.filter(f => !NOISE_FILES.some(n => f.startsWith(n) || f === n));
      
      if (meaningfulFiles.length > bestFiles.length || (meaningfulFiles.length === bestFiles.length && diff.length > bestDiff.length)) {
        bestDiff = diff;
        bestFiles = meaningfulFiles;
        // Extract provider from worktree name
        const match = wt.match(/orchestrator-REM-\d+/);
        bestProvider = match ? match[0] : 'unknown';
      }
    }

    // Also check the orchestrator's worktree
    const orchestratorWt = taskWorktrees[task.id];
    if (orchestratorWt) {
      const diff = getDiff(orchestratorWt);
      const files = getFilesChanged(orchestratorWt);
      const meaningfulFiles = files.filter(f => !NOISE_FILES.some(n => f.startsWith(n) || f === n));
      if (meaningfulFiles.length > bestFiles.length) {
        bestDiff = diff;
        bestFiles = meaningfulFiles;
        bestProvider = 'orchestrator-wt';
      }
    }

    diffResults[task.id] = { 
      diff: bestDiff, 
      files: bestFiles, 
      diffLen: bestDiff.length,
      agentWorktrees: agentWts.length,
      bestProvider,
      meaningful: bestFiles.length > 0,
    };
    log('phase4', `${task.id}: ${bestFiles.length} meaningful files, ${bestDiff.length} chars (from ${agentWts.length} agent worktrees)`);
  }

  // Phase 5: Produce report
  log('phase5', 'Generating report...');
  
  const report = {
    backlog: BACKLOG_PATH,
    executedAt: new Date().toISOString(),
    summary: {
      totalTasks: tasks.length,
      totalProviders: providers.length,
      totalRuns: runs.length,
      completed: results.filter(r => r.task.status === 'done').length,
      failed: results.filter(r => r.task.status === 'failed').length,
    },
    results: results.map(r => ({
      runId: r.runId,
      taskId: r.taskId,
      provider: r.provider,
      model: r.model,
      status: r.task.status,
      result: r.task.result?.slice(0, 500),
      error: r.task.error,
      duration: r.task.createdAt && r.task.updatedAt 
        ? new Date(r.task.updatedAt).getTime() - new Date(r.task.createdAt).getTime()
        : null,
    })),
    diffs: diffResults,
    byProvider: {},
    byTask: {},
  };

  // Aggregate by provider
  for (const provider of providers) {
    const providerResults = results.filter(r => r.provider === provider.id);
    report.byProvider[provider.id] = {
      total: providerResults.length,
      completed: providerResults.filter(r => r.task.status === 'done').length,
      failed: providerResults.filter(r => r.task.status === 'failed').length,
      avgDuration: providerResults.reduce((sum, r) => {
        const dur = r.task.createdAt && r.task.updatedAt
          ? new Date(r.task.updatedAt).getTime() - new Date(r.task.createdAt).getTime()
          : 0;
        return sum + dur;
      }, 0) / (providerResults.length || 1),
    };
  }

  // Aggregate by task
  for (const task of tasks) {
    const taskResults = results.filter(r => r.taskId === task.id);
    report.byTask[task.id] = {
      title: task.title,
      priority: task.priority,
      runs: taskResults.map(r => ({
        provider: r.provider,
        status: r.task.status,
        resultPreview: r.task.result?.slice(0, 200),
      })),
      diff: diffResults[task.id],
    };
  }

  // Write report
  const reportPath = join(RESULTS_DIR, `report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('report', `Written to ${reportPath}`);

  // Phase 6 (optional): Run consensus review
  if (WITH_REVIEW) {
    log('phase6', 'Running consensus review...');
    const meaningful = Object.values(diffResults).filter(d => d.meaningful).length;
    if (meaningful === 0) {
      log('phase6', 'Skipping — no meaningful diffs to review');
    } else {
      // Write a "latest.json" symlink for the reviewer
      writeFileSync(join(RESULTS_DIR, 'latest.json'), JSON.stringify(report, null, 2));
      log('phase6', `Spawning: node scripts/consensus-reviewer.mjs ${reportPath}`);
      const child = spawn('node', ['scripts/consensus-reviewer.mjs', reportPath], {
        stdio: 'inherit',
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, OMEGA_API: API },
      });
      const exitCode = await new Promise(resolve => child.on('close', resolve));
      log('phase6', `Consensus review exited with code ${exitCode}`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('REMEDIATION ORCHESTRATOR — SUMMARY');
  console.log('='.repeat(60));
  console.log(`Tasks: ${report.summary.totalTasks} | Providers: ${report.summary.totalProviders} | Runs: ${report.summary.totalRuns}`);
  console.log(`Completed: ${report.summary.completed} | Failed: ${report.summary.failed}`);
  console.log('\nBy Provider:');
  for (const [provider, stats] of Object.entries(report.byProvider)) {
    console.log(`  ${provider}: ${stats.completed}/${stats.total} done, avg ${(stats.avgDuration / 1000).toFixed(0)}s`);
  }
  console.log('\nBy Task:');
  for (const [taskId, info] of Object.entries(report.byTask)) {
    const statuses = info.runs.map(r => `${r.provider}:${r.status}`).join(', ');
    console.log(`  ${taskId} [${info.priority}]: ${statuses}`);
  }
  console.log('\nDiffs:');
  for (const [taskId, diff] of Object.entries(diffResults)) {
    console.log(`  ${taskId}: ${diff.files.length} files, ${diff.diffLen} chars`);
  }
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
