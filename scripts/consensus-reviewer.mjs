#!/usr/bin/env node
/**
 * Consensus Reviewer
 * 
 * Takes the orchestrator's report and runs a multi-provider consensus review.
 * Each provider reviews all other providers' diffs, producing a matrix of
 * quality scores. Then a final consensus picks the best diff per task.
 * 
 * Uses harness tasks (plain text path, no agent tag) for each review.
 * 
 * Usage:
 *   node scripts/consensus-reviewer.mjs [report.json] [--reviewer=deepseek]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const API = process.env.OMEGA_API || 'http://localhost:4000';
const RESULTS_DIR = join(import.meta.dirname, '..', 'docs', 'remediation-results');

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

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

// ─── Review Prompt ──────────────────────────────────────────────────────────

function buildReviewPrompt(taskTitle, taskPrompt, diffsByProvider) {
  const diffSection = Object.entries(diffsByProvider)
    .map(([provider, diff]) => `## ${provider}\n\`\`\`diff\n${diff.slice(0, 3000)}\n\`\`\``)
    .join('\n\n');

  return `You are a senior code reviewer evaluating remediation diffs from different AI models.

## Original Task
${taskTitle}

${taskPrompt}

## Diffs from Each Provider
${diffSection}

## Scoring Criteria (1-10 each)
1. **Correctness**: Does the diff actually fix the issue described?
2. **Completeness**: Are all parts of the fix addressed?
3. **Minimalism**: Is the change as small as possible while being correct?
4. **Safety**: Does it preserve existing behavior? No regressions?
5. **Code Quality**: Is the code clean and follows conventions?

## Output Format
For each provider, output EXACTLY this JSON block:
\`\`\`json
{
  "reviews": {
    "<provider>": {
      "correctness": <1-10>,
      "completeness": <1-10>,
      "minimalism": <1-10>,
      "safety": <1-10>,
      "quality": <1-10>,
      "total": <sum>,
      "verdict": "<pass|fail|partial>",
      "issues": ["<issue1>", ...]
    }
  },
  "best": "<provider with highest total>",
  "reasoning": "<why this provider's diff is best>"
}
\`\`\`

Be strict. A diff that doesn't actually make the change described should score 0 on correctness.`;
}

// ─── Review via Harness Task ────────────────────────────────────────────────

async function runReviewTask(projectId, title, description, provider, model) {
  // Create a plain task (no agent tag) — uses the direct LLM call path
  const task = await api('POST', '/tasks', {
    projectId,
    title,
    description,
    complexity: 'simple',
    tags: ['consensus-review'],
  });

  // Pin provider
  await api('PATCH', `/tasks/${task.id}`, { provider, model });

  // Run (non-agent, plain text path)
  await api('POST', `/tasks/${task.id}/run`, {});

  // Wait for completion (max 3 min per review)
  const start = Date.now();
  while (Date.now() - start < 3 * 60 * 1000) {
    const t = await api('GET', `/tasks/${task.id}`);
    if (t.status === 'done' || t.status === 'failed') return t;
    await new Promise(r => setTimeout(r, 5_000));
  }
  return api('GET', `/tasks/${task.id}`);
}

// ─── Consensus Algorithm ────────────────────────────────────────────────────

function computeConsensus(reviewMatrix) {
  const providers = new Set();
  for (const reviews of Object.values(reviewMatrix)) {
    for (const p of Object.keys(reviews)) providers.add(p);
  }

  const scores = {};
  for (const p of providers) scores[p] = { totalScore: 0, reviewCount: 0, verdicts: [] };

  for (const [reviewer, reviews] of Object.entries(reviewMatrix)) {
    for (const [provider, review] of Object.entries(reviews)) {
      if (provider === reviewer) continue;
      scores[provider].totalScore += review.total || 0;
      scores[provider].reviewCount++;
      scores[provider].verdicts.push(review.verdict);
    }
  }

  return Object.entries(scores)
    .map(([provider, s]) => ({
      provider,
      avgScore: s.reviewCount > 0 ? s.totalScore / s.reviewCount : 0,
      reviewCount: s.reviewCount,
      passRate: s.verdicts.filter(v => v === 'pass').length / (s.verdicts.length || 1),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const reportPath = process.argv[2] || join(RESULTS_DIR, 'latest.json');
  const reviewerOverride = process.argv.find(a => a.startsWith('--reviewer='))?.split('=')[1];

  const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  log('init', `Loaded report: ${report.summary.totalTasks} tasks, ${report.summary.totalRuns} runs`);

  const providers = [...new Set(report.results.map(r => r.provider))];
  log('init', `Providers: ${providers.join(', ')}`);

  // Create a shared project for review tasks
  const reviewProject = await api('POST', '/projects', {
    name: 'consensus-reviews',
    path: process.cwd(),
  });
  log('init', `Review project: ${reviewProject.id}`);

  // Group results by task
  const byTask = {};
  for (const result of report.results) {
    if (!byTask[result.taskId]) byTask[result.taskId] = [];
    byTask[result.taskId].push(result);
  }

  // Load backlog for task descriptions
  const backlog = JSON.parse(readFileSync(join(import.meta.dirname, 'remediation-backlog.json'), 'utf-8'));

  // Phase 1: Cross-provider reviews
  log('phase1', 'Running cross-provider reviews...');
  const reviewMatrix = {};

  for (const [taskId, taskResults] of Object.entries(byTask)) {
    reviewMatrix[taskId] = {};
    const backlogTask = backlog.tasks.find(t => t.id === taskId);
    if (!backlogTask) continue;

    // Build diffs by provider
    const diffsByProvider = {};
    for (const r of taskResults) {
      if (r.status === 'done' && report.diffs[taskId]?.diff) {
        diffsByProvider[r.provider] = report.diffs[taskId].diff;
      }
    }

    if (Object.keys(diffsByProvider).length === 0) {
      log('skip', `${taskId}: no completed diffs to review`);
      continue;
    }

    const reviewers = reviewerOverride ? [reviewerOverride] : providers;
    const providerModels = {};
    for (const r of taskResults) providerModels[r.provider] = r.model;

    for (const reviewer of reviewers) {
      const model = providerModels[reviewer] || 'latest';
      log('review', `${taskId}: ${reviewer} reviewing ${Object.keys(diffsByProvider).length} diffs...`);

      try {
        const prompt = buildReviewPrompt(backlogTask.title, backlogTask.prompt, diffsByProvider);
        const result = await runReviewTask(
          reviewProject.id,
          `Review: ${taskId} by ${reviewer}`,
          prompt,
          reviewer,
          model,
        );

        if (result.status === 'done' && result.result) {
          const jsonMatch = result.result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            reviewMatrix[taskId][reviewer] = parsed.reviews || {};
            log('review', `${taskId}: ${reviewer} — best=${parsed.best}`);
          } else {
            // Try parsing the whole result as JSON
            try {
              const parsed = JSON.parse(result.result);
              reviewMatrix[taskId][reviewer] = parsed.reviews || {};
            } catch {
              log('review', `${taskId}: ${reviewer} — no JSON in response`);
              reviewMatrix[taskId][reviewer] = {};
            }
          }
        } else {
          log('review', `${taskId}: ${reviewer} — failed: ${result.error || 'unknown'}`);
          reviewMatrix[taskId][reviewer] = {};
        }
      } catch (err) {
        log('review', `${taskId}: ${reviewer} — error: ${err.message}`);
        reviewMatrix[taskId][reviewer] = {};
      }
    }
  }

  // Phase 2: Consensus
  log('phase2', 'Computing consensus...');
  const consensus = {};
  for (const [taskId, matrix] of Object.entries(reviewMatrix)) {
    consensus[taskId] = computeConsensus(matrix);
    const best = consensus[taskId][0];
    if (best) {
      log('consensus', `${taskId}: best=${best.provider} (score=${best.avgScore.toFixed(1)}, pass=${(best.passRate * 100).toFixed(0)}%)`);
    }
  }

  // Phase 3: Report
  const finalReport = {
    ...report,
    reviews: reviewMatrix,
    consensus,
    consensusSummary: {
      winnersByTask: Object.fromEntries(
        Object.entries(consensus).map(([taskId, ranked]) => [taskId, ranked[0]?.provider || 'none'])
      ),
      providerWins: providers.reduce((acc, p) => {
        acc[p] = Object.values(consensus).filter(ranked => ranked[0]?.provider === p).length;
        return acc;
      }, {}),
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `consensus-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(finalReport, null, 2));
  log('report', `Written to ${outPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('CONSENSUS REVIEW — SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nWinners by task:`);
  for (const [taskId, provider] of Object.entries(finalReport.consensusSummary.winnersByTask)) {
    console.log(`  ${taskId}: ${provider}`);
  }
  console.log(`\nProvider wins:`);
  for (const [provider, wins] of Object.entries(finalReport.consensusSummary.providerWins)) {
    console.log(`  ${provider}: ${wins} wins`);
  }
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
