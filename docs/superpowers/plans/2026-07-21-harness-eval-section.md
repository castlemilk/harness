# Harness Eval Section Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/lab/harness-eval/` section to the website that displays per-model LLM code-generation eval results from the Omega harness, with model rankings, suite breakdowns, per-task detail, and failure analysis.

**Architecture:** Mirror the existing `/lab/llm-benchmark/` pattern — a prebuild script reads harness report JSONs from `~/.omega/reports/`, generates structured static data, and Next.js server components render it with SSG. Client components receive stripped metadata; full patches/failures fetched on demand.

**Tech Stack:** Next.js App Router (static export), Tailwind CSS v4, TypeScript, MDX content, shadcn/ui primitives.

---

## File Structure

### New files (website repo: `~/projects/benebsworth.com`)

| File | Responsibility |
|------|---------------|
| `lib/lab/harness-eval/types.ts` | TypeScript interfaces for eval data |
| `lib/lab/harness-eval/results.ts` | Server-side data import (generated JSON) |
| `lib/lab/harness-eval/registry.ts` | Models, suites, tasks registry (client-safe) |
| `lib/lab/harness-eval/analytics.ts` | Aggregation helpers (rankings, stats) |
| `lib/lab/harness-eval/content.ts` | MDX content loader |
| `scripts/gen-harness-eval.mjs` | Prebuild: reads harness reports → generates data |
| `app/lab/harness-eval/page.tsx` | Main landing (rankings, suite grid, model list) |
| `app/lab/harness-eval/[suite]/page.tsx` | Suite detail (tasks with pass rates) |
| `app/lab/harness-eval/models/page.tsx` | Models index |
| `app/lab/harness-eval/models/[model]/page.tsx` | Model detail (per-task breakdown) |
| `app/lab/harness-eval/[suite]/[task]/page.tsx` | Task detail (diff viewer, failure analysis) |
| `content/lab/harness-eval/index.mdx` | Intro/methodology prose |
| `content/lab/harness-eval/suites/[suite].mdx` | Per-suite explainer |
| `content/lab/harness-eval/tasks/[task].mdx` | Per-task explainer |
| `public/lab-data/harness-eval/patches/<suite>/<task>/<model>.json` | On-demand patch fetch |
| `public/lab-data/harness-eval/failures/<suite>/<task>/<model>.json` | On-demand failure detail fetch |

### Modified files

| File | Change |
|------|--------|
| `lib/lab/registry.ts` | Add harness-eval section to lab registry |
| `app/lab/page.tsx` | Add harness-eval card to lab landing |

---

## Chunk 1: Data Types + Registry

### Task 1: Create data types

**Files:**
- Create: `lib/lab/harness-eval/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// lib/lab/harness-eval/types.ts

export type FailureCategory =
  | 'install_failure'
  | 'dependency_error'
  | 'patch_apply_failed'
  | 'verifier_timeout'
  | 'compile_error'
  | 'build_failure'
  | 'test_failure'
  | 'model_error'
  | 'timeout'
  | 'validation_failure'
  | 'tool_misuse'
  | 'parse_error'
  | 'plan_error'
  | 'unknown';

export interface HarnessTask {
  id: string;
  name: string;
  title: string;
  description?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  suite: string;
}

export interface HarnessModel {
  id: string;           // provider/model slug, e.g. "kimi/moonshot-v1-128k"
  provider: string;
  model: string;
  displayName: string;
}

export interface HarnessSuite {
  slug: string;
  label: string;
  description: string;
  taskCount: number;
}

export interface HarnessFailure {
  category: FailureCategory;
  rootCause: string;
  evidence: string[];
}

export interface HarnessToolSummary {
  tool: string;
  total: number;
  success: number;
  failure: number;
  successRate: number;
}

export interface HarnessTaskResult {
  task: HarnessTask;
  passed: boolean;
  status: 'done' | 'failed' | 'timeout';
  durationMs: number;
  score?: number;
  tokens?: number;
  failure?: HarnessFailure;
  tools?: HarnessToolSummary[];
  patchBytes: number;
  hasPatch: boolean;
}

export interface HarnessModelSummary {
  model: HarnessModel;
  totalTasks: number;
  passed: number;
  failed: number;
  timeouts: number;
  passRate: number;
  totalDurationMs: number;
  totalTokens: number;
  avgDurationMs: number;
  tasks: HarnessTaskResult[];
}

export interface HarnessEvalReport {
  timestamp: string;
  suite: string;
  models: HarnessModelSummary[];
}

// Client-safe version (no full patches)
export type HarnessTaskResultMeta = Omit<HarnessTaskResult, 'hasPatch'> & {
  patchVersion: string;  // hash for cache busting
};
```

- [ ] **Step 2: Verify types compile**

Run: `cd ~/projects/benebsworth.com && npx tsc --noEmit lib/lab/harness-eval/types.ts 2>&1 | head -5`

- [ ] **Step 3: Commit**

```bash
cd ~/projects/benebsworth.com
git add lib/lab/harness-eval/types.ts
git commit -m "feat(harness-eval): add data types"
```

---

### Task 2: Create registry

**Files:**
- Create: `lib/lab/harness-eval/registry.ts`

- [ ] **Step 1: Create registry file**

```typescript
// lib/lab/harness-eval/registry.ts
import type { HarnessModel, HarnessSuite, HarnessTask } from './types.js';

export const HARNESS_MODELS: HarnessModel[] = [
  // Populated by gen-harness-eval.mjs from actual report data.
  // Placeholder structure:
];

export const HARNESS_SUITES: HarnessSuite[] = [
  { slug: 'fast', label: 'Fast Suite', description: '10 quick Node.js tasks for smoke testing', taskCount: 10 },
  { slug: 'deep', label: 'Deep Suite', description: '10 deeper tasks covering debugging, refactoring, and API design', taskCount: 10 },
  { slug: 'hard', label: 'Hard Suite', description: '30 DeepSWE tasks from real GitHub issues', taskCount: 30 },
];

export function modelsForSuite(slug: string): HarnessModel[] {
  // In practice, populated from results data at build time.
  return HARNESS_MODELS;
}

export function suiteForSlug(slug: string): HarnessSuite | undefined {
  return HARNESS_SUITES.find((s) => s.slug === slug);
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/benebsworth.com
git add lib/lab/harness-eval/registry.ts
git commit -m "feat(harness-eval): add registry stubs"
```

---

## Chunk 2: Data Generation Script

### Task 3: Create the prebuild generation script

**Files:**
- Create: `scripts/gen-harness-eval.mjs`

- [ ] **Step 1: Create the generation script**

This script reads model-eval JSON files from `~/.omega/reports/` and generates:
1. `lib/lab/harness-eval/results.json` — structured eval data
2. `lib/lab/harness-eval/registry.ts` — populated with actual models/tasks
3. `public/lab-data/harness-eval/patches/` — per-task per-model patches
4. `public/lab-data/harness-eval/failures/` — per-task per-model failure details

```javascript
#!/usr/bin/env node
// scripts/gen-harness-eval.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPORTS_DIR = path.join(process.env.HOME, '.omega', 'reports');
const OUT_DIR = path.resolve('.');
const PUBLIC_DATA = path.join(OUT_DIR, 'public', 'lab-data', 'harness-eval');

function hashStr(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}

function loadModelEvalReports() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith('model-eval-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.map(f => {
    const raw = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
}

function loadBenchmarkReports() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith('benchmark-') && f.endsWith('.json') && !f.includes('latest'))
    .sort()
    .reverse();
  return files.map(f => {
    const raw = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
}

function extractTaskResults(report) {
  return (report.results || []).map(r => ({
    task: {
      id: r.task.id,
      name: r.task.name,
      title: r.task.title,
      description: r.task.description,
      complexity: r.task.complexity,
      suite: report.suite,
    },
    passed: r.evaluation.passed,
    status: r.status,
    durationMs: r.durationMs,
    score: r.evaluation.score,
    tokens: r.agentRun?.totalTokens ?? r.usage?.totalTokens,
    failure: r.failureAnalysis ? {
      category: r.failureAnalysis.category,
      rootCause: r.failureAnalysis.rootCause,
      evidence: r.failureAnalysis.evidence,
    } : undefined,
    tools: r.traceSummary?.toolSummary,
    patchBytes: r.diffs?.reduce((a, d) => a + (d.patch?.length ?? 0), 0) ?? 0,
    hasPatch: (r.diffs?.length ?? 0) > 0,
    patch: r.diffs?.[0]?.patch ?? '',
  }));
}

function buildModelSummaries(reports) {
  const modelMap = new Map();
  for (const report of reports) {
    // Model-eval reports have {provider, model, report}
    if (report.models && report.results) {
      for (const result of report.results) {
        const key = `${result.provider}/${result.model}`;
        if (!modelMap.has(key)) {
          modelMap.set(key, {
            model: {
              id: key,
              provider: result.provider,
              model: result.model,
              displayName: result.model,
            },
            results: [],
          });
        }
        const entry = modelMap.get(key);
        entry.results.push(...extractTaskResults(result.report));
      }
    }
    // Single benchmark reports (no model breakdown)
    else if (report.suite) {
      const key = 'internal/default';
      if (!modelMap.has(key)) {
        modelMap.set(key, {
          model: { id: key, provider: 'internal', model: 'default', displayName: 'Internal Agent' },
          results: [],
        });
      }
      modelMap.get(key).results.push(...extractTaskResults(report));
    }
  }

  const summaries = [];
  for (const [key, entry] of modelMap) {
    const tasks = entry.results;
    const passed = tasks.filter(t => t.passed).length;
    const failed = tasks.filter(t => !t.passed && t.status !== 'timeout').length;
    const timeouts = tasks.filter(t => t.status === 'timeout').length;
    const totalTokens = tasks.reduce((a, t) => a + (t.tokens ?? 0), 0);
    const totalDuration = tasks.reduce((a, t) => a + t.durationMs, 0);

    summaries.push({
      model: entry.model,
      totalTasks: tasks.length,
      passed,
      failed,
      timeouts,
      passRate: tasks.length > 0 ? Math.round((passed / tasks.length) * 100) : 0,
      totalDurationMs: totalDuration,
      totalTokens,
      avgDurationMs: tasks.length > 0 ? Math.round(totalDuration / tasks.length) : 0,
      tasks,
    });
  }

  return summaries.sort((a, b) => b.passRate - a.passRate);
}

function writePatchFiles(summaries) {
  const patchDir = path.join(PUBLIC_DATA, 'patches');
  fs.mkdirSync(patchDir, { recursive: true });

  for (const summary of summaries) {
    for (const task of summary.tasks) {
      if (!task.hasPatch) continue;
      const taskDir = path.join(patchDir, task.task.suite, task.task.id);
      fs.mkdirSync(taskDir, { recursive: true });
      const file = path.join(taskDir, `${summary.model.id.replace('/', '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({
        taskId: task.task.id,
        modelId: summary.model.id,
        patch: task.patch,
      }));
    }
  }
}

function writeFailureFiles(summaries) {
  const failDir = path.join(PUBLIC_DATA, 'failures');
  fs.mkdirSync(failDir, { recursive: true });

  for (const summary of summaries) {
    for (const task of summary.tasks) {
      if (!task.failure) continue;
      const taskDir = path.join(failDir, task.task.suite, task.task.id);
      fs.mkdirSync(taskDir, { recursive: true });
      const file = path.join(taskDir, `${summary.model.id.replace('/', '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({
        taskId: task.task.id,
        modelId: summary.model.id,
        failure: task.failure,
      }));
    }
  }
}

function generateRegistry(summaries, allTasks) {
  const models = summaries.map(s => s.model);
  const suites = [...new Set(allTasks.map(t => t.suite))].map(suite => ({
    slug: suite,
    label: suite.charAt(0).toUpperCase() + suite.slice(1) + ' Suite',
    description: '',
    taskCount: allTasks.filter(t => t.suite === suite).length,
  }));

  return `// AUTO-GENERATED by scripts/gen-harness-eval.mjs — do not edit manually
import type { HarnessModel, HarnessSuite, HarnessTask } from './types.js';

export const HARNESS_MODELS: HarnessModel[] = ${JSON.stringify(models, null, 2)};

export const HARNESS_SUITES: HarnessSuite[] = ${JSON.stringify(suites, null, 2)};

export const HARNESS_TASKS: HarnessTask[] = ${JSON.stringify(allTasks, null, 2)};

export function modelsForSuite(_slug: string): HarnessModel[] {
  return HARNESS_MODELS;
}

export function suiteForSlug(slug: string): HarnessSuite | undefined {
  return HARNESS_SUITES.find((s) => s.slug === slug);
}

export function tasksForSuite(slug: string): HarnessTask[] {
  return HARNESS_TASKS.filter((t) => t.suite === slug);
}
`;
}

// ── Main ──
const modelEvalReports = loadModelEvalReports();
const benchmarkReports = loadBenchmarkReports();
const allReports = [...modelEvalReports, ...benchmarkReports];

console.log(`Found ${String(modelEvalReports.length)} model-eval + ${String(benchmarkReports.length)} benchmark reports`);

const summaries = buildModelSummaries(allReports);
const allTasks = [...new Map(summaries.flatMap(s => s.tasks.map(t => [t.task.id, t.task]))).values()];

console.log(`Extracted ${String(summaries.length)} model summaries, ${String(allTasks.length)} unique tasks`);

// Write data
const resultsData = { timestamp: new Date().toISOString(), models: summaries };
fs.writeFileSync(path.join(OUT_DIR, 'lib', 'lab', 'harness-eval', 'results.json'), JSON.stringify(resultsData, null, 2));

// Write registry
const registry = generateRegistry(summaries, allTasks);
fs.writeFileSync(path.join(OUT_DIR, 'lib', 'lab', 'harness-eval', 'registry.ts'), registry);

// Write static data files
fs.mkdirSync(PUBLIC_DATA, { recursive: true });
writePatchFiles(summaries);
writeFailureFiles(summaries);

console.log(`Generated harness-eval data: results.json, registry.ts, patches/, failures/`);
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x scripts/gen-harness-eval.mjs
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/benebsworth.com
git add scripts/gen-harness-eval.mjs
git commit -m "feat(harness-eval): add prebuild generation script"
```

---

## Chunk 3: Data Modules + Analytics

### Task 4: Create results module + analytics

**Files:**
- Create: `lib/lab/harness-eval/results.ts`
- Create: `lib/lab/harness-eval/analytics.ts`
- Create: `lib/lab/harness-eval/content.ts`

- [ ] **Step 1: Create results.ts (server-only import)**

```typescript
// lib/lab/harness-eval/results.ts
// SERVER-SIDE ONLY — importing results.json ships the full dataset to the client.
import type { HarnessEvalReport, HarnessTaskResult, HarnessModelSummary } from './types.js';

// @ts-expect-error — generated at prebuild by scripts/gen-harness-eval.mjs
import resultsData from './results.json';

export const EVAL_REPORT: HarnessEvalReport = resultsData as HarnessEvalReport;
export const ALL_SUMMARIES: HarnessModelSummary[] = EVAL_REPORT.models;

export function resultsForModel(modelId: string): HarnessTaskResult[] {
  const summary = ALL_SUMMARIES.find((s) => s.model.id === modelId);
  return summary?.tasks ?? [];
}

export function resultsForTask(taskId: string): { modelId: string; result: HarnessTaskResult }[] {
  const out: { modelId: string; result: HarnessTaskResult }[] = [];
  for (const summary of ALL_SUMMARIES) {
    const task = summary.tasks.find((t) => t.task.id === taskId);
    if (task) out.push({ modelId: summary.model.id, result: task });
  }
  return out;
}

export function stripPatch(r: HarnessTaskResult): HarnessTaskResult & { hasPatch: boolean; patchVersion: string } {
  const { patch, ...rest } = r as HarnessTaskResult & { patch: string };
  return { ...rest, patchVersion: hashStr(patch ?? '') };
}

function hashStr(s: string): string {
  // Simple hash for cache-busting — not cryptographic.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).padStart(8, '0');
}
```

- [ ] **Step 2: Create analytics.ts**

```typescript
// lib/lab/harness-eval/analytics.ts
import type { HarnessModelSummary, HarnessTaskResult, FailureCategory } from './types.js';

export interface ModelRanking {
  model: HarnessModelSummary['model'];
  passRate: number;
  totalTasks: number;
  totalTokens: number;
  avgDurationMs: number;
}

export interface FailureBreakdown {
  category: FailureCategory;
  count: number;
  examples: string[];
}

export function rankModels(summaries: HarnessModelSummary[]): ModelRanking[] {
  return summaries
    .map((s) => ({
      model: s.model,
      passRate: s.passRate,
      totalTasks: s.totalTasks,
      totalTokens: s.totalTokens,
      avgDurationMs: s.avgDurationMs,
    }))
    .sort((a, b) => b.passRate - a.passRate || a.totalTokens - b.totalTokens);
}

export function aggregateFailures(summaries: HarnessModelSummary[]): FailureBreakdown[] {
  const map = new Map<FailureCategory, { count: number; examples: string[] }>();
  for (const s of summaries) {
    for (const t of s.tasks) {
      if (!t.failure) continue;
      const existing = map.get(t.failure.category) ?? { count: 0, examples: [] };
      existing.count++;
      if (existing.examples.length < 3) existing.examples.push(`${t.task.name}: ${t.failure.rootCause}`);
      map.set(t.failure.category, existing);
    }
  }
  return [...map.entries()]
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.count - a.count);
}

export function overallStats(summaries: HarnessModelSummary[]) {
  const totalTasks = summaries.reduce((a, s) => a + s.totalTasks, 0);
  const totalPassed = summaries.reduce((a, s) => a + s.passed, 0);
  const totalTokens = summaries.reduce((a, s) => a + s.totalTokens, 0);
  return {
    models: summaries.length,
    totalTasks,
    totalPassed,
    overallPassRate: totalTasks > 0 ? Math.round((totalPassed / totalTasks) * 100) : 0,
    totalTokens,
  };
}
```

- [ ] **Step 3: Create content.ts loader**

```typescript
// lib/lab/harness-eval/content.ts
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'lab', 'harness-eval');

export function loadIntroContent(): string {
  try {
    return fs.readFileSync(path.join(CONTENT_DIR, 'index.mdx'), 'utf-8');
  } catch {
    return '';
  }
}

export function loadSuiteContent(slug: string): string {
  try {
    return fs.readFileSync(path.join(CONTENT_DIR, 'suites', `${slug}.mdx`), 'utf-8');
  } catch {
    return '';
  }
}

export function loadTaskContent(taskId: string): string {
  try {
    return fs.readFileSync(path.join(CONTENT_DIR, 'tasks', `${taskId}.mdx`), 'utf-8');
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/benebsworth.com
git add lib/lab/harness-eval/results.ts lib/lab/harness-eval/analytics.ts lib/lab/harness-eval/content.ts
git commit -m "feat(harness-eval): add results, analytics, and content loaders"
```

---

## Chunk 4: Pages

### Task 5: Main landing page

**Files:**
- Create: `app/lab/harness-eval/page.tsx`

- [ ] **Step 1: Create main page**

Server component that renders: rankings table, suite grid, model cards, failure breakdown.

- [ ] **Step 2: Commit**

```bash
cd ~/projects/benebsworth.com
git add app/lab/harness-eval/page.tsx
git commit -m "feat(harness-eval): add main landing page"
```

### Task 6: Model detail page

**Files:**
- Create: `app/lab/harness-eval/models/page.tsx`
- Create: `app/lab/harness-eval/models/[model]/page.tsx`

- [ ] **Step 1: Create models index + detail pages**

- [ ] **Step 2: Commit**

```bash
cd ~/projects/benebsworth.com
git add app/lab/harness-eval/models/
git commit -m "feat(harness-eval): add model pages"
```

### Task 7: Suite + task detail pages

**Files:**
- Create: `app/lab/harness-eval/[suite]/page.tsx`
- Create: `app/lab/harness-eval/[suite]/[task]/page.tsx`

- [ ] **Step 1: Create suite and task detail pages**

- [ ] **Step 2: Commit**

```bash
cd ~/projects/benebsworth.com
git add app/lab/harness-eval/
git commit -m "feat(harness-eval): add suite and task detail pages"
```

---

## Chunk 5: Content + Integration

### Task 8: MDX content

**Files:**
- Create: `content/lab/harness-eval/index.mdx`
- Create: `content/lab/harness-eval/suites/` (per-suite MDX)

- [ ] **Step 1: Write intro MDX**

- [ ] **Step 2: Write suite explainers**

- [ ] **Step 3: Commit**

```bash
cd ~/projects/benebsworth.com
git add content/lab/harness-eval/
git commit -m "feat(harness-eval): add MDX content"
```

### Task 9: Wire into lab registry + add prebuild step

**Files:**
- Modify: `lib/lab/registry.ts` — add harness-eval entry
- Modify: `package.json` — add prebuild script

- [ ] **Step 1: Add to lab registry**

- [ ] **Step 2: Add prebuild hook**

- [ ] **Step 3: Run prebuild + verify generation**

- [ ] **Step 4: Build site + verify pages render**

- [ ] **Step 5: Commit**

```bash
cd ~/projects/benebsworth.com
git add lib/lab/registry.ts package.json
git commit -m "feat(harness-eval): wire into lab registry + prebuild"
```
