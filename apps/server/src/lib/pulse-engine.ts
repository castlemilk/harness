import type { Harness, PrismaClient } from '@omega/db';
import {
  contextWindowFor,
  estimateCostUsd,
  lookupModelPrice,
  type Capability,
  type ProviderConfig,
  type UsageInfo,
} from '@omega/core';
import { createProvider } from '@omega/providers';
import { runExternalAgentTask, type ExternalCli } from '@omega/agent';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { safeJsonParse } from './utils.js';

/**
 * The pulse engine.
 *
 * A harness is a standing agent: on every heartbeat it runs its playbook
 * routine once against the live objective state, records what it did as a
 * Pulse, and escalates to a human when it needs a decision. This is the piece
 * that turns the Foreman tables from a dashboard into an orchestrator.
 *
 * Design constraints that matter:
 * - It costs real money. Nothing here runs unless a caller asks for it, and
 *   the scheduler is opt-in (see `startPulseScheduler`).
 * - Budget caps are enforced BEFORE the call, not after, so a capped harness
 *   cannot overspend by one pulse.
 * - An unpriced model records `null` cost rather than 0, so "we don't know
 *   what this cost" never masquerades as "this was free".
 */

/** What the model is asked to return. Anything else is treated as prose. */
export interface PulseReport {
  summary: string;
  outcome: 'ok' | 'warn' | 'fail';
  activity?: string;
  needsHuman?: {
    kind: 'approval' | 'question' | 'budget';
    title: string;
    detail?: string;
  };
}

export interface PulseResult {
  harnessId: string;
  ran: boolean;
  /** Why the pulse did not run, when `ran` is false. */
  skipped?:
    | 'paused'
    | 'no-task'
    | 'no-repo'
    | 'retired'
    | 'dry-run'
    | 'budget-cap'
    | 'no-provider'
    | 'awaiting-human'
    | 'unpriced-model';
  seq?: number;
  outcome?: PulseReport['outcome'];
  summary?: string;
  /** The model that actually served the call. */
  model?: string;
  usage?: UsageInfo;
  costUsd?: number | null;
  raisedIntervention?: boolean;
  error?: string;
}

const MAX_SUMMARY = 400;

/** Tokens a busy pulse is expected to use; the sparkline's full-height mark. */
const PULSE_TOKEN_SCALE = 4000;

/**
 * A harness whose model reads `external:<cli>` is driven by an external agent
 * CLI (agy, codex, opencode…) instead of a chat completion. Same convention the
 * task runner already uses for `external:` tags, so there is one spelling of
 * "this is driven by a CLI" in the codebase.
 */
const EXTERNAL_PREFIX = 'external:';
const EXTERNAL_CLIS: ExternalCli[] = [
  'agy',
  'codex',
  'claude-code',
  'opencode',
  'cursor-cli',
  'aider',
  'gemini-cli',
];

export function externalCliFor(model: string): ExternalCli | null {
  if (!model.startsWith(EXTERNAL_PREFIX)) return null;
  const cli = model.slice(EXTERNAL_PREFIX.length) as ExternalCli;
  return EXTERNAL_CLIS.includes(cli) ? cli : null;
}

/* ------------------------------------------------------------------ prompts */

/** A granted skill, resolved to its SKILL.md body — or honestly not. */
export interface ResolvedSkill {
  name: string;
  /** The markdown body (frontmatter stripped, bounded), or null when the name
   *  matched no artifact / the file was unreadable. Never silently dropped. */
  body: string | null;
}

/** Cap per skill body so a stack of grants cannot blow the prompt out. */
const SKILL_BODY_CAP = 8_000;

/** Strip YAML frontmatter (`---` fenced) so only the instructional body ships. */
export function skillBody(source: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(source);
  return (match ? source.slice(match[0].length) : source).trim().slice(0, SKILL_BODY_CAP);
}

/**
 * Resolve a harness's granted skill names against the SkillArtifact registry
 * and the SKILL.md files on disk. A name that stops resolving (artifact
 * deleted, file moved) yields `body: null` and is DISCLOSED in the prompt —
 * the operator granted it, so its absence is a fact the agent should know.
 */
async function resolveSkills(prisma: PrismaClient, harness: Harness): Promise<ResolvedSkill[]> {
  const names = safeJsonParse<string[]>(harness.skills, []).filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );
  if (names.length === 0) return [];
  const artifacts = await prisma.skillArtifact.findMany({
    where: { name: { in: names } },
    select: { name: true, sourcePath: true },
  });
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  return Promise.all(names.map(async (name) => {
    const artifact = byName.get(name);
    if (!artifact) return { name, body: null };
    try {
      return { name, body: skillBody(await readFile(artifact.sourcePath, 'utf8')) };
    } catch {
      return { name, body: null };
    }
  }));
}

export function buildSystemPrompt(
  harness: Harness,
  objective: { name: string; instructions?: string | null },
  skills: ResolvedSkill[] = [],
): string {
  const lines = [
    `You are "${harness.name}", a standing agent in an orchestration fleet.`,
    `Objective: ${objective.name}`,
    '',
    'Your standing mission:',
    harness.mission,
  ];
  // Objective-level instructions bind every harness in the fleet — project
  // conventions, constraints, what "done" means here.
  if (objective.instructions?.trim()) {
    lines.push('', 'Standing instructions for every agent on this objective:', objective.instructions.trim());
  }
  for (const skill of skills) {
    if (skill.body) {
      lines.push('', `── Skill: ${skill.name} ──`, skill.body);
    } else {
      lines.push(
        '',
        `── Skill: ${skill.name} ── (granted to you, but its SKILL.md could not be`,
        'loaded — treat it as unavailable and say so if it was needed.)',
      );
    }
  }
  lines.push(
    '',
    'You run on a heartbeat. Each time you wake, you perform your routine once,',
    'then report what you did. You are not chatting with a user — you are',
    'recording a work log entry that an operator will read later.',
    '',
    'Escalate to the human ONLY when you genuinely cannot proceed without a',
    'decision that is theirs to make (a policy call, an approval for something',
    'outside your permissions, or a budget increase). Do not escalate for',
    'anything you can reasonably decide yourself.',
  );
  return lines.join('\n');
}

/**
 * Substitute `$variable` tokens in routine step text. The playbook editor has
 * always advertised `$ticket`/`$branch`/`$name`-style variables and the web
 * preview resolves them — but until now the ENGINE shipped the tokens
 * literally, so the one consumer that mattered saw `$branch` as three words of
 * noise. Unresolvable tokens stay literal, same as the preview.
 */
export function substituteRoutineVars(
  steps: { index: number; text: string; condition?: string | null }[],
  vars: Record<string, string | null | undefined>,
): { index: number; text: string; condition?: string | null }[] {
  const resolve = (text: string): string =>
    text.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, (token, key: string) => {
      const value = vars[key];
      return value != null && value !== '' ? value : token;
    });
  return steps.map((step) => ({
    ...step,
    text: resolve(step.text),
    condition: step.condition != null ? resolve(step.condition) : step.condition,
  }));
}

function buildUserPrompt(input: {
  harness: Harness;
  routine: { index: number; text: string; condition?: string | null }[];
  recentPulses: { seq: number; summary: string | null; outcome: string }[];
  children: { name: string; status: string }[];
  humanReplies: string[];
}): string {
  const { harness, routine, recentPulses, children, humanReplies } = input;

  const sections: string[] = [];

  sections.push(
    routine.length > 0
      ? `Your every-pulse routine:\n${routine
          .map(
            (s) =>
              `${String(s.index).padStart(2, '0')}. ${s.text}${s.condition ? ` (${s.condition})` : ''}`,
          )
          .join('\n')}`
      : 'You have no explicit routine; use your mission to decide the next useful action.',
  );

  if (harness.currentJob) sections.push(`Current job:\n${harness.currentJob}`);

  if (children.length > 0) {
    sections.push(
      `Children you own (${String(children.length)}):\n${children
        .map((c) => `- ${c.name} [${c.status}]`)
        .join('\n')}`,
    );
  }

  if (recentPulses.length > 0) {
    sections.push(
      `Your last pulses (most recent first):\n${recentPulses
        .map((p) => `#${String(p.seq)} [${p.outcome}] ${p.summary ?? '(no summary)'}`)
        .join('\n')}`,
    );
  }

  // A human answering an escalation is the highest-priority input there is.
  if (humanReplies.length > 0) {
    sections.push(
      `The operator replied to you since your last pulse. Act on this first:\n${humanReplies
        .map((r) => `- ${r}`)
        .join('\n')}`,
    );
  }

  sections.push(
    [
      'Respond with ONLY a JSON object, no prose and no code fence:',
      '{',
      '  "summary": "one or two sentences on what you did this pulse",',
      '  "outcome": "ok" | "warn" | "fail",',
      '  "activity": "a short present-tense line for the dashboard",',
      '  "needsHuman": null | { "kind": "approval"|"question"|"budget", "title": "...", "detail": "..." }',
      '}',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

/** Models like to wrap JSON in prose or fences; recover what we can. */
export function parsePulseReport(raw: string): PulseReport {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const parsed = safeJsonParse<Partial<PulseReport> | null>(
      candidate.slice(start, end + 1),
      null,
    );
    if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      const outcome =
        parsed.outcome === 'warn' || parsed.outcome === 'fail' ? parsed.outcome : 'ok';
      const needs = parsed.needsHuman;
      return {
        summary: parsed.summary.trim().slice(0, MAX_SUMMARY),
        outcome,
        activity:
          typeof parsed.activity === 'string' && parsed.activity.trim()
            ? parsed.activity.trim().slice(0, 200)
            : undefined,
        needsHuman:
          needs && typeof needs === 'object' && typeof needs.title === 'string' && needs.title.trim()
            ? {
                kind:
                  needs.kind === 'approval' || needs.kind === 'budget' ? needs.kind : 'question',
                title: needs.title.trim().slice(0, 200),
                detail: typeof needs.detail === 'string' ? needs.detail.slice(0, 1000) : undefined,
              }
            : undefined,
      };
    }
  }

  // Unparseable but non-empty: keep the text as the log entry and flag it,
  // rather than throwing away a pulse we already paid for.
  return {
    summary: (text || 'Model returned an empty response.').slice(0, MAX_SUMMARY),
    outcome: 'warn',
  };
}

/* ----------------------------------------------------------------- provider */

async function resolveProvider(
  prisma: PrismaClient,
  model: string,
): Promise<{ config: ProviderConfig; model: string; substituted: boolean } | null> {
  const rows = await prisma.providerConfig.findMany({ where: { enabled: true } });

  const toConfig = (row: (typeof rows)[number]): ProviderConfig => ({
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: safeJsonParse<Capability[]>(row.capabilities, []),
    enabled: row.enabled,
  });

  // Prefer a provider that actually advertises this model.
  for (const row of rows) {
    const caps = safeJsonParse<Capability[]>(row.capabilities, []);
    if (row.defaultModel === model || caps.some((c) => c.name === model)) {
      return { config: toConfig(row), model, substituted: false };
    }
  }

  // Otherwise fall back — but to something plausibly usable. Taking whatever
  // row happens to come back first picks unconfigured providers (e.g. a local
  // Ollama that isn't running), and every pulse then fails on "fetch failed".
  // Credentialed providers first, then a stable order so runs are repeatable.
  const usable = [...rows].sort((a, b) => {
    const credentialed = Number(Boolean(b.apiKey)) - Number(Boolean(a.apiKey));
    return credentialed !== 0 ? credentialed : a.name.localeCompare(b.name);
  });
  const fallback = usable.at(0);
  if (!fallback) return null;
  // Use ITS model rather than sending an id it will reject — and tell the
  // caller, because pricing the requested model while running a different one
  // would silently misreport cost.
  return { config: toConfig(fallback), model: fallback.defaultModel, substituted: true };
}

/* -------------------------------------------------------------------- pulse */

export interface RunPulseOptions {
  /** Skip the provider call and record a synthetic pulse. */
  simulate?: boolean;
  now?: Date;
}

export async function runPulse(
  prisma: PrismaClient,
  harnessId: string,
  options: RunPulseOptions = {},
): Promise<PulseResult> {
  const now = options.now ?? new Date();

  const harness = await prisma.harness.findUnique({ where: { id: harnessId } });
  if (!harness) throw new Error(`Harness ${harnessId} not found`);

  if (harness.retiredAt) return { harnessId, ran: false, skipped: 'retired' };
  if (harness.status === 'paused') return { harnessId, ran: false, skipped: 'paused' };
  // A harness blocked on a human must not keep burning budget restating itself.
  if (harness.status === 'waiting') return { harnessId, ran: false, skipped: 'awaiting-human' };

  // Enforce the cap BEFORE spending, and raise the budget request once.
  if (harness.spendCapUsd != null && harness.spendUsd >= harness.spendCapUsd) {
    const raised = await ensureBudgetIntervention(prisma, harness, now);
    return { harnessId, ran: false, skipped: 'budget-cap', raisedIntervention: raised };
  }

  const [objective, playbook, children, recent, humanTraces, skills, taskRow, workstreamRow] = await Promise.all([
    prisma.objective.findUnique({ where: { id: harness.objectiveId } }),
    harness.playbookId ? prisma.playbook.findUnique({ where: { id: harness.playbookId } }) : null,
    prisma.harness.findMany({
      where: { parentId: harness.id, retiredAt: null },
      select: { name: true, status: true },
      take: 20,
    }),
    prisma.pulse.findMany({
      where: { harnessId: harness.id },
      orderBy: { seq: 'desc' },
      take: 3,
      select: { seq: true, summary: true, outcome: true },
    }),
    harness.taskId
      ? prisma.taskTrace.findMany({
          where: { taskId: harness.taskId, role: 'user' },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { content: true, createdAt: true },
        })
      : Promise.resolve([]),
    resolveSkills(prisma, harness),
    harness.taskId
      ? prisma.task.findUnique({ where: { id: harness.taskId }, select: { title: true } })
      : Promise.resolve(null),
    harness.workstreamId
      ? prisma.workstream.findUnique({ where: { id: harness.workstreamId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const routine = substituteRoutineVars(
    safeJsonParse<{ index: number; text: string; condition?: string | null }[]>(
      playbook?.steps ?? '[]',
      [],
    ),
    {
      name: harness.name,
      model: harness.model,
      branch: harness.branch,
      objective: objective?.name,
      workstream: workstreamRow?.name,
      ticket: taskRow?.title,
    },
  );

  // Only replies newer than the last pulse are "new" to this harness.
  const lastPulseAt = await prisma.pulse.findFirst({
    where: { harnessId: harness.id },
    orderBy: { seq: 'desc' },
    select: { startedAt: true },
  });
  const humanReplies = humanTraces
    .filter((t) => !lastPulseAt || t.createdAt > lastPulseAt.startedAt)
    .map((t) => t.content ?? '')
    .filter(Boolean);

  const seq = harness.lastPulseSeq + 1;
  const startedAt = now;

  let report: PulseReport;
  let usage: UsageInfo = {};
  let costUsd: number | null = 0;
  // The model that actually served the call, which may not be the one the
  // harness declares. Cost and usage must be attributed to this one.
  let ranModel = harness.model;

  const externalCli = externalCliFor(harness.model);

  if (options.simulate || harness.dryRun) {
    report = {
      summary: `Dry run: would execute ${String(routine.length)} routine step(s) against "${objective?.name ?? 'objective'}".`,
      outcome: 'ok',
      activity: 'Dry run — no provider call, no writes.',
    };
  } else if (externalCli) {
    // An external CLI does real work in a real repository: it needs a ticket to
    // work on and a checkout to work in.
    if (!harness.taskId) return { harnessId, ran: false, skipped: 'no-task' };
    const project = objective
      ? await prisma.project.findUnique({ where: { id: objective.projectId } })
      : null;
    if (!project || !existsSync(project.path)) {
      return { harnessId, ran: false, skipped: 'no-repo' };
    }

    ranModel = harness.model;
    try {
      const result = await runExternalAgentTask(prisma, harness.taskId, {
        cli: externalCli,
        projectPath: project.path,
        projectName: project.name,
        complexity: 'simple',
      });
      // The external path records its own AgentRun; read the metrics it
      // captured rather than inventing our own.
      const run = await prisma.agentRun.findFirst({
        where: { taskId: harness.taskId },
        orderBy: { createdAt: 'desc' },
        select: { totalTokens: true, promptTokens: true, completionTokens: true, costUsd: true },
      });
      usage = {
        promptTokens: run?.promptTokens ?? undefined,
        completionTokens: run?.completionTokens ?? undefined,
        totalTokens: run?.totalTokens ?? undefined,
      };
      costUsd = run?.costUsd ?? null;

      const changed = result.diff.trim().length > 0;
      report = {
        summary:
          `${externalCli}: ${result.status}` +
          (changed ? ` · produced a diff (${String(result.diff.split('\n').length)} lines)` : ' · no changes') +
          (result.output ? ` — ${result.output.trim().slice(0, 240)}` : ''),
        outcome: result.status === 'done' ? 'ok' : 'fail',
        activity: changed
          ? `Ran ${externalCli}; diff ready for review.`
          : `Ran ${externalCli}; nothing to change.`,
      };
    } catch (err) {
      report = {
        summary: `${externalCli} run failed: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          MAX_SUMMARY,
        ),
        outcome: 'fail',
      };
    }
  } else {
    const resolved = await resolveProvider(prisma, harness.model);
    if (!resolved) return { harnessId, ran: false, skipped: 'no-provider' };

    // A budget you cannot measure is not a budget. If we have no price for the
    // model, every pulse would record $0, spend would never rise, and the cap
    // would never trip — so refuse rather than run uncapped in all but name.
    if (harness.spendCapUsd != null && !lookupModelPrice(resolved.model)) {
      const raised = await ensureUnpricedIntervention(prisma, harness, resolved.model, now);
      return {
        harnessId,
        ran: false,
        skipped: 'unpriced-model',
        model: resolved.model,
        costUsd: null,
        raisedIntervention: raised,
      };
    }

    const provider = createProvider(resolved.config);
    const captured: UsageInfo = {};
    try {
      const raw = await provider.send(
        buildUserPrompt({ harness, routine, recentPulses: recent, children, humanReplies }),
        {
          model: resolved.model,
          system: buildSystemPrompt(
            harness,
            { name: objective?.name ?? 'unknown objective', instructions: objective?.instructions },
            skills,
          ),
          temperature: 0.3,
          onUsage: (u) => {
            captured.promptTokens = u.promptTokens;
            captured.completionTokens = u.completionTokens;
            captured.totalTokens = u.totalTokens;
          },
        },
      );
      report = parsePulseReport(raw);
    } catch (err) {
      // A provider failure is itself a pulse outcome — it is what happened.
      report = {
        summary: `Provider call failed: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          MAX_SUMMARY,
        ),
        outcome: 'fail',
      };
    }
    usage = captured;
    costUsd = estimateCostUsd(resolved.model, captured);
    ranModel = resolved.model;
    if (resolved.substituted) {
      console.warn(
        `[pulse] ${harness.name}: no provider serves "${harness.model}"; ran "${resolved.model}" via ${resolved.config.name}.`,
      );
    }
  }

  const tokens = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  // Only reachable for an uncapped harness (the guard above refuses a capped
  // one on an unpriced model), so recording 0 here cannot mask a blown budget.
  const spendDelta = costUsd ?? 0;
  const nextSpend = harness.spendUsd + spendDelta;
  const contextWindow =
    harness.contextWindow > 0 ? harness.contextWindow : contextWindowFor(harness.model);

  // Weight drives the dashboard sparkline. It must compare a pulse to OTHER
  // PULSES, not to the context window: a stateless pulse uses ~1.5k of a 400k
  // window, so windowing it floors every bar at the minimum and the sparkline
  // flatlines for exactly the healthy agents it should show working.
  const weight = Math.max(0.08, Math.min(1, tokens / PULSE_TOKEN_SCALE));

  const nextStatus: string = report.needsHuman
    ? 'waiting'
    : report.outcome === 'fail'
      ? 'failed'
      : children.length > 0
        ? 'watching'
        : 'working';

  await prisma.$transaction([
    prisma.pulse.create({
      data: {
        harnessId: harness.id,
        seq,
        startedAt,
        endedAt: new Date(),
        outcome: report.outcome,
        summary: report.summary,
        costUsd: spendDelta,
        tokens,
        weight,
      },
    }),
    prisma.harness.update({
      where: { id: harness.id },
      data: {
        lastPulseSeq: seq,
        spendUsd: nextSpend,
        // Prompt tokens are the live occupancy of the window.
        contextTokens: usage.promptTokens ?? harness.contextTokens,
        // Backfill a real window when the row has none, so the context gauge
        // divides by something meaningful.
        contextWindow,
        activity: report.activity ?? report.summary.slice(0, 200),
        model: ranModel,
        status: nextStatus,
        idleSince: nextStatus === 'working' ? null : new Date(),
        nextPulseAt: new Date(now.getTime() + harness.heartbeatMinutes * 60_000),
      },
    }),
  ]);

  let raisedIntervention = false;
  if (report.needsHuman) {
    await prisma.intervention.create({
      data: {
        objectiveId: harness.objectiveId,
        harnessId: harness.id,
        kind: report.needsHuman.kind,
        title: report.needsHuman.title,
        detail: report.needsHuman.detail ?? null,
        impact: children.length > 0 ? `blocks ${String(children.length)} children` : null,
        status: 'pending',
      },
    });
    raisedIntervention = true;
  }

  // Spending through the cap during this pulse raises the budget request now,
  // rather than waiting for the next heartbeat to notice.
  if (harness.spendCapUsd != null && nextSpend >= harness.spendCapUsd) {
    const raised = await ensureBudgetIntervention(
      prisma,
      { ...harness, spendUsd: nextSpend },
      new Date(),
    );
    raisedIntervention = raisedIntervention || raised;
  }

  return {
    harnessId,
    ran: true,
    seq,
    outcome: report.outcome,
    summary: report.summary,
    model: ranModel,
    usage,
    costUsd,
    raisedIntervention,
  };
}

/** One pending budget request per harness, not one per heartbeat. */
async function ensureBudgetIntervention(
  prisma: PrismaClient,
  harness: Harness,
  now: Date,
): Promise<boolean> {
  const existing = await prisma.intervention.findFirst({
    where: { harnessId: harness.id, kind: 'budget', status: 'pending' },
    select: { id: true },
  });
  if (existing) return false;

  const cap = harness.spendCapUsd ?? 0;
  await prisma.intervention.create({
    data: {
      objectiveId: harness.objectiveId,
      harnessId: harness.id,
      kind: 'budget',
      title: `${harness.name} stopped at its $${cap.toFixed(2)} cap`,
      detail: 'Raise the cap to let it continue, or retire it.',
      payload: JSON.stringify({
        spent: harness.spendUsd,
        cap,
        suggestedCap: Math.max(cap * 2, cap + 5),
      }),
      status: 'pending',
      createdAt: now,
    },
  });

  await prisma.harness.update({
    where: { id: harness.id },
    data: { status: 'waiting', idleSince: now },
  });
  return true;
}

/* ---------------------------------------------------------------- scheduler */

export interface SchedulerOptions {
  /** How often to look for due harnesses. */
  tickMs?: number;
  /** How many pulses may run at once. */
  concurrency?: number;
  onResult?: (result: PulseResult) => void;
}

export interface PulseScheduler {
  stop: () => void;
  /** Run one tick immediately; returns the results. Exposed for tests. */
  tick: () => Promise<PulseResult[]>;
}

/**
 * Runs due harnesses on an interval.
 *
 * OFF by default — every tick can spend real money, so the server only starts
 * this when `FOREMAN_ENGINE=1`. See `apps/server/src/index.ts`.
 */
export function startPulseScheduler(
  prisma: PrismaClient,
  options: SchedulerOptions = {},
): PulseScheduler {
  const tickMs = options.tickMs ?? 30_000;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  let running = false;
  let stopped = false;

  const tick = async (): Promise<PulseResult[]> => {
    // Never overlap ticks: a slow provider must not stack pulses.
    if (running || stopped) return [];
    running = true;
    try {
      const due = await prisma.harness.findMany({
        where: {
          retiredAt: null,
          dryRun: false,
          status: { in: ['working', 'watching', 'ready'] },
          nextPulseAt: { lte: new Date() },
        },
        orderBy: { nextPulseAt: 'asc' },
        take: concurrency,
        select: { id: true },
      });

      const results: PulseResult[] = [];
      for (const { id } of due) {
        try {
          const result = await runPulse(prisma, id);
          results.push(result);
          options.onResult?.(result);
        } catch (err) {
          const failure: PulseResult = {
            harnessId: id,
            ran: false,
            error: err instanceof Error ? err.message : String(err),
          };
          results.push(failure);
          options.onResult?.(failure);
        }
      }
      return results;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  // Don't hold the process open on this alone.
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}

/** One pending notice per harness that its model has no price. */
async function ensureUnpricedIntervention(
  prisma: PrismaClient,
  harness: Harness,
  model: string,
  now: Date,
): Promise<boolean> {
  const existing = await prisma.intervention.findFirst({
    where: { harnessId: harness.id, kind: 'budget', status: 'pending' },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.intervention.create({
    data: {
      objectiveId: harness.objectiveId,
      harnessId: harness.id,
      kind: 'budget',
      title: `${harness.name} cannot run: no price for "${model}"`,
      detail:
        `This harness has a $${(harness.spendCapUsd ?? 0).toFixed(2)} cap, but there is no ` +
        `pricing entry for "${model}", so its spend cannot be measured or capped. ` +
        `Add the model to packages/core/src/pricing.ts, or clear the cap to accept ` +
        `unmeasured spend.`,
      payload: JSON.stringify({
        spent: harness.spendUsd,
        cap: harness.spendCapUsd ?? 0,
        suggestedCap: harness.spendCapUsd ?? 0,
      }),
      status: 'pending',
      createdAt: now,
    },
  });
  await prisma.harness.update({
    where: { id: harness.id },
    data: { status: 'waiting', idleSince: now },
  });
  return true;
}
