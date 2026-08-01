import type { PrismaClient } from '@omega/db';
import type { Provider, ProviderConfig } from '@omega/core';
import { createProvider } from '@omega/providers';
import { pickModelForTier } from '@omega/router';
import type { IntelligentRouter } from '@omega/router';
import type { OrchestratedSubtask, SubtaskState } from './orchestrator-types.js';

export const COMPLEXITIES = new Set(['simple', 'medium', 'complex']);
const SUBTASK_TIERS = new Set(['medium', 'low']);

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const candidates = [text];
  const fence = /```(?:json)?\n([\s\S]*?)```/.exec(text);
  if (fence) candidates.push(fence[1]);
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function normalizeSubtask(raw: unknown, fallbackTitle: string): OrchestratedSubtask | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle;
  const description = typeof obj.description === 'string' ? obj.description : '';
  const complexity =
    typeof obj.complexity === 'string' && COMPLEXITIES.has(obj.complexity)
      ? (obj.complexity as OrchestratedSubtask['complexity'])
      : 'medium';
  const tier =
    typeof obj.tier === 'string' && SUBTASK_TIERS.has(obj.tier)
      ? (obj.tier as OrchestratedSubtask['tier'])
      : 'medium';
  const dependsOn = Array.isArray(obj.dependsOn)
    ? obj.dependsOn.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0)
    : undefined;
  const affectedFiles = Array.isArray(obj.affectedFiles)
    ? obj.affectedFiles.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : undefined;
  return { title, description, complexity, tier, dependsOn, affectedFiles };
}

export async function loadProviderByName(
  prisma: PrismaClient,
  name: string
): Promise<Provider | undefined> {
  const row = await prisma.providerConfig.findFirst({ where: { name, enabled: true } });
  if (!row) return undefined;
  const config: ProviderConfig = {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    tokenExpiresAt: row.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as ProviderConfig['capabilities'],
    enabled: row.enabled,
  };
  return createProvider(config);
}

export function detectFileConflicts(subtasks: SubtaskState[]): string[][] {
  const fileOwners = new Map<string, number[]>();
  for (const st of subtasks) {
    if (!st.affectedFiles) continue;
    for (const file of st.affectedFiles) {
      const owners = fileOwners.get(file) ?? [];
      owners.push(st.index);
      fileOwners.set(file, owners);
    }
  }
  const conflicts: string[][] = [];
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1) {
      conflicts.push([file, ...owners.map(String)]);
    }
  }
  return conflicts;
}

export function buildPlanPrompt(title: string, description: string, maxSubtasks: number, memory = ''): string {
  const memorySection = memory
    ? `\nRelevant patterns from past successful tasks:\n${memory}\n\nReuse these patterns where they fit; do not repeat past mistakes.\n`
    : '';
  return `You are the planning model in a multi-agent orchestration system. Decompose the following software engineering task into at most ${String(maxSubtasks)} concrete, independently implementable subtasks.

Task title: ${title}

Task description:
${description}
${memorySection}
Respond with ONLY a JSON array (no markdown fences, no commentary) of subtasks:
[
  {
    "title": "short imperative title",
    "description": "precise instructions for the implementing sub-agent, including file paths where known",
    "complexity": "simple" | "medium" | "complex",
    "tier": "medium" | "low",
    "dependsOn": [0],
    "affectedFiles": ["src/foo.ts", "src/bar.ts"]
  }
]

Rules:
- "tier" is the intelligence tier of the implementing sub-agent: "medium" for most implementation work, "low" for mechanical/trivial edits.
- "dependsOn" lists zero-based indexes of subtasks that must finish first; omit it when there are no dependencies.
- "affectedFiles" lists the exact file paths this subtask will modify or create. The orchestrator uses this to detect conflicts when subtasks run concurrently. Omit if truly none.
- Order subtasks so dependencies come before dependents.
- Keep subtasks small enough that a smaller model can complete each one.
- Avoid assigning the same file to multiple concurrent subtasks (subtasks without a dependsOn link between them).`;
}

export function buildReviewPrompt(
  title: string,
  description: string,
  completed: SubtaskState[],
  diff: string,
  verification: string
): string {
  const completedList = completed
    .map((s) => `- [${s.status}] ${s.title}${s.notes ? ` — ${s.notes}` : ''}`)
    .join('\n');
  return `You are the reviewing model in a multi-agent orchestration system. Sub-agents have been implementing parts of the task below. Review the accumulated git diff and the project build/test verification result, then decide whether the task is complete.

Task title: ${title}

Task description:
${description}

Subtasks executed so far:
${completedList || '(none)'}

Project build/test verification:
${verification || '(not run)'}

Current cumulative diff (truncated):
${diff.slice(0, 12000) || '(no changes yet)'}

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "status": "done" | "continue",
  "notes": "short review summary",
  "nextSubtasks": [ { "title": "...", "description": "...", "complexity": "simple|medium|complex", "tier": "medium|low" } ]
}

Use "done" only when the diff fully implements the task AND the project build/test verification passes. Use "continue" when more work is needed or verification fails, and list the follow-up subtasks in "nextSubtasks" (omit "nextSubtasks" if the already-planned subtasks cover it).`;
}

export async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export async function pickModel(
  prisma: PrismaClient,
  tier: 'high' | 'medium' | 'low',
  intelligentRouter?: IntelligentRouter,
  taskTitle?: string,
  taskComplexity?: string,
): Promise<{ provider: string; model: string } | undefined> {
  if (intelligentRouter && taskTitle) {
    const configs = await prisma.providerConfig.findMany();
    const coreConfigs: ProviderConfig[] = configs.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      kind: cfg.kind as ProviderConfig['kind'],
      baseUrl: cfg.baseUrl ?? undefined,
      apiKey: cfg.apiKey ?? undefined,
      defaultModel: cfg.defaultModel,
      capabilities: JSON.parse(cfg.capabilities) as ProviderConfig['capabilities'],
      enabled: cfg.enabled,
    }));
    const task = {
      id: 'orchestrator',
      projectId: 'orchestrator',
      title: taskTitle,
      status: 'todo' as const,
      complexity: (taskComplexity ?? 'medium') as 'simple' | 'medium' | 'complex',
      tags: ['orchestrate', `tier:${tier}`],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const decision = intelligentRouter.route(coreConfigs, task, {
      strategy: tier === 'high' ? 'performance-optimized' : 'balanced',
      maxCandidates: 1,
    });
    if (decision) {
      return { provider: decision.primary.provider.name, model: decision.primary.model };
    }
  }
  return pickModelForTier(prisma, tier);
}
