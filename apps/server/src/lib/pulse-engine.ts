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
import { type ExternalCli } from '@omega/agent';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { safeJsonParse } from './utils.js';
import { getRouter } from './intelligent-router.js';
import { prunePulses } from './pulse-retention.js';
import type { IntelligentRouter, RoutingStrategy } from '@omega/router';
import { runRoutedExternalAgentTask } from './external-agent-runner.js';

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
  /**
   * Replacement working memory to carry into the next pulse. Absent = keep
   * the current memory; empty string = deliberately clear it. This is the
   * only state that survives the otherwise-stateless heartbeat.
   */
  memory?: string;
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

/** Working memory is a briefing note, not a transcript: enough for open
 *  threads and decisions, small enough to never crowd the prompt. */
const MAX_MEMORY = 2_000;

/** Per-pulse prompt/response capture bound. Enough to audit any real pulse;
 *  a runaway response is truncated, not dropped. */
const PULSE_TEXT_CAP = 24_000;

/** External CLIs whose output parser reports a real dollar cost. Every other
 *  CLI records $0 forever, which would silently defeat a spend cap. */
const COST_REPORTING_CLIS = new Set<ExternalCli>(['claude-code']);

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
  const memory = harness.memory;

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

  // The one thing that survives between pulses. Everything else here is
  // reconstructed state; this is what the agent chose to remember.
  if (memory != null && memory !== '') {
    sections.push(`Your working memory (you wrote this on a previous pulse):\n${memory}`);
  }

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
      '  "memory": "REPLACEMENT working memory to carry into your next pulse — open threads, decisions, what to check next (max 2000 chars). Omit to keep your current memory; empty string to clear it.",',
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
        // Present-but-empty means "clear my memory" and must survive; absent
        // means "keep it". Only a string counts — a model sending null keeps.
        memory:
          typeof parsed.memory === 'string'
            ? parsed.memory.trim().slice(0, MAX_MEMORY)
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

interface ProviderConfigRow {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}

function toConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: safeJsonParse<Capability[]>(row.capabilities, []),
    enabled: row.enabled,
  };
}

/* --------------------------------------------------------------- auto model */

const AUTO_STRATEGIES: readonly RoutingStrategy[] = [
  'balanced',
  'cost-optimized',
  'performance-optimized',
  'consensus',
  'exploratory',
];

/**
 * A harness whose model is `auto` (or `auto:<strategy>`) delegates model
 * choice to the IntelligentRouter every pulse. Returns the strategy to route
 * with — `null` for "not an auto harness", `undefined` for bare `auto`
 * (the strategy learner recommends). An unknown suffix routes as bare auto
 * and warns rather than silently pinning a strategy that doesn't exist.
 */
export function autoStrategyFor(model: string): RoutingStrategy | undefined | null {
  if (model === 'auto') return undefined;
  if (!model.startsWith('auto:')) return null;
  const suffix = model.slice('auto:'.length) as RoutingStrategy;
  if (AUTO_STRATEGIES.includes(suffix)) return suffix;
  console.warn(`[pulse] unknown auto strategy "${suffix}"; routing as plain auto.`);
  return undefined;
}

/**
 * Route an auto harness through the IntelligentRouter: classification comes
 * from the harness's own name + mission (the closest thing a standing agent
 * has to a task description), scoring from capability/performance/cost/
 * health — including whatever BenchmarkHistory folded into the performance
 * cache at boot. Circuit-broken candidates are skipped when an alternative
 * exists, same policy as everywhere else.
 */
async function resolveAutoRoute(
  prisma: PrismaClient,
  router: IntelligentRouter,
  harness: Harness,
  strategy: RoutingStrategy | undefined,
): Promise<{ config: ProviderConfig; model: string; reasoning: string } | null> {
  const rows = await prisma.providerConfig.findMany({ where: { enabled: true } });
  const configs = rows.map(toConfig);
  const decision = router.route(
    configs,
    {
      id: harness.id,
      projectId: '',
      title: harness.name,
      description: harness.mission,
      status: 'in_progress',
      complexity: 'simple',
      tags: [],
      createdAt: harness.createdAt,
      updatedAt: harness.updatedAt,
    },
    { strategy, maxCandidates: 3 },
  );
  if (!decision) return null;
  const candidates = [decision.primary, ...decision.fallbacks];
  const chosen =
    candidates.find((c) => !router.health.isCircuitBroken(c.provider.name)) ?? decision.primary;
  return {
    config: chosen.provider,
    model: chosen.model,
    reasoning: `${decision.strategy}: ${decision.reasoning}`,
  };
}

async function resolveProvider(
  prisma: PrismaClient,
  model: string,
  /** Circuit check by provider NAME (the router's breaker). A broken provider
   *  is skipped when any alternative exists; when every candidate is broken
   *  the primary runs anyway — same policy as the task path, because refusing
   *  everything turns one bad provider into a dead fleet. */
  isBroken: (providerName: string) => boolean = () => false,
): Promise<{ config: ProviderConfig; model: string; substituted: boolean } | null> {
  const allRows = await prisma.providerConfig.findMany({ where: { enabled: true } });
  const healthy = allRows.filter((row) => !isBroken(row.name));
  const rows = healthy.length > 0 ? healthy : allRows;
  if (healthy.length === 0 && allRows.length > 0) {
    console.warn('[pulse] every enabled provider has an open circuit; proceeding anyway.');
  }

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
  // The exact exchange, captured for the transcript. Null when nothing was
  // sent (dry run) or the conversation lives elsewhere (external CLI).
  let sentPrompt: string | null = null;
  let gotResponse: string | null = null;

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
    // Same rule as the internal branch: a budget you cannot measure is not a
    // budget. Only claude-code's parser reports a dollar cost; a capped
    // harness on any other CLI would record $0 forever and never trip.
    if (harness.spendCapUsd != null && !COST_REPORTING_CLIS.has(externalCli)) {
      const raised = await ensureUnpricedIntervention(prisma, harness, harness.model, now);
      return {
        harnessId,
        ran: false,
        skipped: 'unpriced-model',
        model: harness.model,
        costUsd: null,
        raisedIntervention: raised,
      };
    }
    const project = objective
      ? await prisma.project.findUnique({ where: { id: objective.projectId } })
      : null;
    if (!project || !existsSync(project.path)) {
      return { harnessId, ran: false, skipped: 'no-repo' };
    }

    ranModel = harness.model;
    try {
      const result = await runRoutedExternalAgentTask(prisma, harness.taskId, {
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

      // The CLI's own output is the session record; without this the
      // transcript of an external harness held only dividers and interjects.
      if (result.output.trim()) {
        try {
          await prisma.taskTrace.create({
            data: {
              taskId: harness.taskId,
              role: 'assistant',
              content: result.output.trim().slice(0, PULSE_TEXT_CAP),
            },
          });
        } catch (err) {
          console.warn(`[pulse] could not record external output trace: ${String(err)}`);
        }
      }

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
    // The router's circuit breakers already know which providers are down;
    // consulting them here is what stops every heartbeat from re-timing-out
    // against a dead endpoint. Never let router trouble kill a pulse, though.
    let router: Awaited<ReturnType<typeof getRouter>> | null = null;
    try {
      router = await getRouter(prisma);
    } catch (err) {
      console.warn(`[pulse] router unavailable, resolving without circuits: ${String(err)}`);
    }
    const autoStrategy = autoStrategyFor(harness.model);
    let resolved: { config: ProviderConfig; model: string; substituted: boolean } | null;
    if (autoStrategy !== null && router) {
      const routed = await resolveAutoRoute(prisma, router, harness, autoStrategy);
      if (routed) {
        console.info(`[pulse] ${harness.name}: auto-routed to ${routed.config.name}/${routed.model} (${routed.reasoning})`);
      }
      resolved = routed ? { config: routed.config, model: routed.model, substituted: false } : null;
    } else {
      if (autoStrategy !== null) {
        // Auto without a router degrades to the ordinary fallback — logged,
        // because "auto" silently meaning "alphabetical" would be a lie.
        console.warn(`[pulse] ${harness.name}: model is auto but the router is unavailable; using fallback resolution.`);
      }
      resolved = await resolveProvider(
        prisma,
        harness.model,
        router ? (name) => router.health.isCircuitBroken(name) : undefined,
      );
    }
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
    const userPrompt = buildUserPrompt({ harness, routine, recentPulses: recent, children, humanReplies });
    const systemPrompt = buildSystemPrompt(
      harness,
      { name: objective?.name ?? 'unknown objective', instructions: objective?.instructions },
      skills,
    );
    // System prompt first: it carries mission/instructions/skills, and a
    // truncation should eat the tail of the routine before it eats those.
    sentPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`.slice(0, PULSE_TEXT_CAP);
    const callStartedAt = Date.now();
    let callFailed = false;
    try {
      const raw = await provider.send(userPrompt, {
        model: resolved.model,
        system: systemPrompt,
        temperature: 0.3,
        onUsage: (u) => {
          captured.promptTokens = u.promptTokens;
          captured.completionTokens = u.completionTokens;
          captured.totalTokens = u.totalTokens;
        },
      });
      gotResponse = raw.slice(0, PULSE_TEXT_CAP);
      report = parsePulseReport(raw);
    } catch (err) {
      callFailed = true;
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
    // Feed the outcome back into the router's health/performance state, under
    // the provider NAME — the same key `isCircuitBroken` is consulted with
    // above, so pulse failures actually open the circuit that pulse
    // resolution respects. Best-effort: telemetry must never fail a pulse.
    if (router) {
      try {
        const durationMs = Date.now() - callStartedAt;
        const passed = !callFailed && report.outcome !== 'fail';
        // Two key spaces on purpose: circuits are consulted by provider NAME
        // (resolveProvider/resolveAutoRoute above), so health must be recorded
        // under it; the router's scorer reads performance under
        // `provider/model`, which is also where BenchmarkHistory folds in.
        router.health.record(resolved.config.name, {
          latencyMs: durationMs,
          success: !callFailed,
          rateLimited: false,
          costUsd: costUsd ?? 0,
        });
        router.performance.update(
          `${resolved.config.name}/${ranModel}`,
          passed,
          costUsd ?? 0,
          durationMs,
        );
      } catch (err) {
        console.warn(`[pulse] could not record router outcome: ${String(err)}`);
      }
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
        model: ranModel,
        promptText: sentPrompt,
        responseText: gotResponse,
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
        // An auto harness KEEPS `auto` — writing the routed model back would
        // pin next pulse to this pulse's choice. The pulse row records what ran.
        model: autoStrategyFor(harness.model) !== null ? undefined : ranModel,
        // A returned memory string replaces the whole field ('' clears it);
        // an absent field keeps what the harness already remembered.
        memory: report.memory !== undefined ? (report.memory === '' ? null : report.memory) : undefined,
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
  // Retention runs at most once a day, piggybacked on the tick so it only
  // happens while the engine is deliberately on.
  let lastPruneAt = 0;
  const PRUNE_EVERY_MS = 24 * 60 * 60 * 1_000;

  const tick = async (): Promise<PulseResult[]> => {
    // Never overlap ticks: a slow provider must not stack pulses.
    if (running || stopped) return [];
    running = true;
    try {
      if (Date.now() - lastPruneAt > PRUNE_EVERY_MS) {
        lastPruneAt = Date.now();
        try {
          const pruned = await prunePulses(prisma);
          if (pruned.textStripped > 0 || pruned.rowsDeleted > 0) {
            console.info(
              `[pulse] retention: stripped text from ${String(pruned.textStripped)} pulses, deleted ${String(pruned.rowsDeleted)} aged ok-pulses.`,
            );
          }
        } catch (err) {
          console.warn(`[pulse] retention pass failed: ${String(err)}`);
        }
      }
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
