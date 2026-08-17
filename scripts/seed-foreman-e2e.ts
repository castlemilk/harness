/**
 * State-complete Foreman fixture for end-to-end validation.
 *
 * The default demo seed is deliberately uniform — every harness is `working`
 * with a similar spend — which means most of the dashboard's states are never
 * rendered and most of its edge cases are never hit. This fixture is the
 * opposite: it aims to put at least one row in every branch of the UI.
 *
 * Covered on purpose:
 *   - all seven harness statuses, incl. retired (must be hidden) and ready
 *     (no pulses at all, so the sparkline pads)
 *   - a harness with NO workstream, which must appear in an "Unassigned" lane
 *   - a paused workstream, and a harness paused on its own
 *   - depth-4 chain, and a lead with 8 children so lanes overflow to "+N more"
 *   - spendCap of 0, spend over cap, and no cap at all
 *   - context at 96%, and a name long enough to force truncation
 *   - a harness with no playbook, so its routine is empty
 *   - pulse histories that are healthy, flatlining, and failing at the tail
 *   - >12 pulses for one harness, and pulses dated TODAY so `spendToday` is
 *     non-zero (the default seed backdates everything, hiding sampling bugs)
 *   - an approval whose payload.diff is an OBJECT rather than a string
 *   - two objectives in one project, so objective-scoped queries are testable
 *   - tickets in all five board states
 *
 * Idempotent: fixed ids, upsert throughout. Safe to re-run.
 *
 *   DATABASE_DIR=/tmp/x/pglite npx tsx scripts/seed-foreman-e2e.ts
 */
// Relative rather than '@omega/db': this script lives outside the workspace
// packages, so the package name does not resolve from the repo root.
import { prisma } from '../packages/db/src/index.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Stable ids so re-running updates rather than duplicates. */
const id = (n: string) => `e2e00000-0000-4000-8000-${n.padStart(12, '0')}`;

const PROJECT = id('1');
const OBJ_MAIN = id('10');
const OBJ_QUEUE = id('11');
const OBJ_DEMO = id('12');
const PB_LEAD = id('20');
const PB_LEAD_V2 = id('21');
const PB_WORKER = id('22');

type PulseShape = 'healthy' | 'flatline' | 'failing' | 'mixed' | 'none';

interface HarnessSpec {
  key: string;
  name: string;
  status: string;
  parent?: string;
  workstream?: string | null;
  mission: string;
  activity?: string;
  currentJob?: string;
  model: string;
  spendUsd: number;
  spendCapUsd?: number | null;
  contextTokens: number;
  contextWindow?: number;
  heartbeatMinutes?: number;
  maxChildren?: number;
  playbook?: string | null;
  pulses: PulseShape;
  /** How many pulses to write; >12 exercises windowed queries. */
  pulseCount?: number;
  idleMinutes?: number | null;
  retired?: boolean;
  dryRun?: boolean;
  branch?: string;
}

const WS_CONTROL = id('30');
const WS_RUNTIME = id('31');
const WS_SUPPORT = id('32');

const HARNESSES: HarnessSpec[] = [
  // --- Control plane: a healthy lead with a deep chain beneath it ----------
  {
    key: '100',
    name: 'control-lead',
    status: 'watching',
    workstream: WS_CONTROL,
    mission:
      'Own the control-plane contract. Break ambiguity into sequenced work and keep no more than 6 children in flight.',
    activity: 'Reconciling objective state with active workstreams.',
    currentJob: 'Drive the control-plane board to zero.',
    model: 'gpt-5',
    spendUsd: 4.2,
    spendCapUsd: 24,
    contextTokens: 84_000,
    contextWindow: 400_000,
    maxChildren: 6,
    playbook: PB_LEAD,
    pulses: 'healthy',
    pulseCount: 18, // deliberately > 12
    idleMinutes: 4,
  },
  {
    key: '101',
    name: '551-objective-schema',
    status: 'working',
    parent: '100',
    workstream: WS_CONTROL,
    mission: 'Land the objective schema migration without touching existing tables.',
    activity: 'Rewriting the migration to be purely additive.',
    model: 'gpt-5',
    spendUsd: 1.14,
    spendCapUsd: 5,
    contextTokens: 96_000,
    contextWindow: 400_000,
    playbook: PB_WORKER,
    pulses: 'healthy',
    branch: 'feat/objective-schema',
  },
  {
    key: '102',
    name: '552-state-endpoint',
    status: 'working',
    parent: '101',
    workstream: WS_CONTROL,
    mission: 'Serve the whole dashboard payload in one bounded query.',
    activity: 'Collapsing the per-harness pulse fetch into one grouped query.',
    model: 'claude-sonnet-4',
    spendUsd: 0.86,
    spendCapUsd: 5,
    contextTokens: 44_000,
    playbook: PB_WORKER,
    pulses: 'mixed',
    branch: 'feat/state-endpoint',
  },
  {
    key: '103',
    // Depth 4, and long enough to force truncation everywhere it renders.
    name: '553-sse-init-snapshot-and-reconnect-semantics',
    status: 'working',
    parent: '102',
    workstream: WS_CONTROL,
    mission: 'Emit an init snapshot and survive reconnects without duplicating events.',
    activity: 'Testing reconnect against a dropped stream.',
    model: 'claude-sonnet-4',
    spendUsd: 0.42,
    spendCapUsd: 5,
    contextTokens: 21_000,
    playbook: PB_WORKER,
    pulses: 'healthy',
  },
  {
    key: '104',
    name: '554-webhook-retry',
    status: 'waiting', // blocked on a human for 13h
    parent: '100',
    workstream: WS_CONTROL,
    mission: 'Take the retry contract to a merged PR without changing public behaviour unasked.',
    activity: 'Asked: retry with backoff, or fail the delivery?',
    model: 'gpt-5',
    spendUsd: 2.1,
    spendCapUsd: 5,
    contextTokens: 61_000,
    contextWindow: 400_000,
    playbook: PB_WORKER,
    pulses: 'flatline',
    idleMinutes: 13 * 60,
  },
  {
    key: '105',
    name: '555-rendezvous',
    status: 'failed', // blew its budget
    parent: '100',
    workstream: WS_CONTROL,
    mission: 'Coordinate a rendezvous across three workstreams.',
    activity: 'Hit its budget cap mid-run. 3 retries, same wall.',
    model: 'gpt-5',
    spendUsd: 5.4, // over cap on purpose
    spendCapUsd: 5,
    contextTokens: 190_000,
    contextWindow: 200_000, // 95% context
    playbook: PB_WORKER,
    pulses: 'failing',
    idleMinutes: 60,
  },
  {
    key: '106',
    name: '556-docs-pass',
    status: 'ready', // staffed, never pulsed
    parent: '100',
    workstream: WS_CONTROL,
    mission: 'Document the orchestration contract once the schema lands.',
    activity: 'Ready — waiting for the schema PR to land first.',
    model: 'claude-haiku-4',
    spendUsd: 0,
    spendCapUsd: 5,
    contextTokens: 0,
    playbook: PB_WORKER,
    pulses: 'none',
    idleMinutes: 120,
  },

  // --- Runtime: a wide fan-out so lanes overflow --------------------------
  {
    key: '200',
    name: 'runtime-lead',
    status: 'watching',
    workstream: WS_RUNTIME,
    mission: 'Keep the pulse engine honest: real cost, real context, no silent failures.',
    activity: 'Reviewing eight children for stalls.',
    currentJob: 'Get the engine to a state where a pulse costs what we say it costs.',
    model: 'gpt-5',
    spendUsd: 6.8,
    spendCapUsd: null, // no cap at all
    contextTokens: 120_000,
    contextWindow: 400_000,
    maxChildren: 12,
    playbook: PB_LEAD,
    pulses: 'healthy',
    idleMinutes: 2,
  },
  ...Array.from({ length: 8 }, (_, i): HarnessSpec => ({
    key: String(201 + i),
    name: `6${String(10 + i)}-runtime-task`,
    status: i === 3 ? 'paused' : 'working', // one individually paused
    parent: '200',
    workstream: WS_RUNTIME,
    mission: `Runtime slice ${String(i + 1)}: keep it bounded and observable.`,
    activity: i === 3 ? 'Paused by the operator at 08:12.' : 'Advancing its slice of the runtime.',
    model: i % 2 === 0 ? 'claude-sonnet-4' : 'gpt-5-mini',
    spendUsd: 0.2 + i * 0.17,
    spendCapUsd: 5,
    contextTokens: 12_000 + i * 9_000,
    playbook: PB_WORKER,
    pulses: i === 5 ? 'flatline' : 'healthy',
  })),

  // --- Support: a fully paused workstream ---------------------------------
  {
    key: '300',
    name: 'triage-lead',
    status: 'paused',
    workstream: WS_SUPPORT,
    mission: 'Keep the support queue at zero without waking anyone up.',
    activity: 'Paused with the rest of the lane.',
    model: 'claude-haiku-4',
    spendUsd: 1.1,
    spendCapUsd: 10,
    contextTokens: 30_000,
    playbook: PB_LEAD,
    pulses: 'mixed',
    idleMinutes: 6 * 60,
  },
  {
    key: '301',
    name: '701-triage-sweep',
    status: 'paused',
    parent: '300',
    workstream: WS_SUPPORT,
    mission: 'Sweep the queue and escalate only genuine problems.',
    model: 'claude-haiku-4',
    spendUsd: 0.3,
    spendCapUsd: 5,
    contextTokens: 8_000,
    playbook: PB_WORKER,
    pulses: 'flatline',
  },

  // --- Edge cases ---------------------------------------------------------
  {
    key: '400',
    // No workstream at all: must surface in an "Unassigned" lane, not vanish.
    name: 'unassigned-scout',
    status: 'working',
    workstream: null,
    mission: 'Spawned ad hoc from the console, before being assigned a lane.',
    activity: 'Scoping an unfiled piece of work.',
    model: 'gpt-5-mini',
    spendUsd: 0.44,
    spendCapUsd: 0, // zero cap: the meter must hide, not read "empty"
    contextTokens: 15_000,
    playbook: null, // no playbook: empty routine
    pulses: 'mixed',
  },
  {
    key: '401',
    name: 'dry-run-probe',
    status: 'ready',
    workstream: WS_RUNTIME,
    parent: '200',
    mission: 'Dry run only — proves a spawn costs nothing until it is armed.',
    activity: 'Dry run — no writes.',
    model: 'gpt-5-mini',
    spendUsd: 0,
    spendCapUsd: 5,
    contextTokens: 0,
    playbook: PB_WORKER,
    pulses: 'none',
    dryRun: true,
  },
  {
    key: '402',
    name: '499-retired-worker',
    status: 'retired',
    parent: '100',
    workstream: WS_CONTROL,
    mission: 'Finished its ticket and was retired. Must not appear in any fleet view.',
    model: 'claude-haiku-4',
    spendUsd: 0.9,
    spendCapUsd: 5,
    contextTokens: 5_000,
    playbook: PB_WORKER,
    pulses: 'healthy',
    retired: true,
  },
];

/** Pulse weight/outcome series per shape, oldest first. */
function pulseSeries(shape: PulseShape, count: number): { outcome: string; weight: number }[] {
  if (shape === 'none') return [];
  return Array.from({ length: count }, (_, i) => {
    const t = i / Math.max(1, count - 1);
    switch (shape) {
      case 'healthy':
        return { outcome: 'ok', weight: 0.45 + 0.4 * Math.abs(Math.sin(i * 1.7)) };
      case 'flatline':
        // Worked, then went quiet — the shape an operator needs to spot.
        return i < count * 0.3
          ? { outcome: 'ok', weight: 0.55 + 0.2 * Math.sin(i) }
          : { outcome: 'idle', weight: 0.12 };
      case 'failing':
        return t < 0.5
          ? { outcome: 'ok', weight: 0.6 }
          : t < 0.7
            ? { outcome: 'warn', weight: 0.9 }
            : { outcome: 'fail', weight: 1 };
      case 'mixed':
      default:
        return i % 4 === 3
          ? { outcome: 'warn', weight: 0.85 }
          : { outcome: 'ok', weight: 0.35 + 0.35 * Math.abs(Math.cos(i)) };
    }
  });
}

async function main(): Promise<void> {
  const now = Date.now();

  const project = await prisma.project.upsert({
    where: { id: PROJECT },
    update: { name: 'Foreman E2E' },
    create: {
      id: PROJECT,
      name: 'Foreman E2E',
      path: '/tmp/foreman-e2e',
      description: 'State-complete fixture for Foreman UI validation.',
    },
  });

  // --- playbooks ----------------------------------------------------------
  const leadSteps = [
    { index: 1, text: 'Read the objective, your children, spend, and open interventions.' },
    { index: 2, text: 'Choose the smallest useful next action.' },
    {
      index: 3,
      text: 'Assign bounded work when specialist capacity exists.',
      condition: 'condition · escalates to parent',
    },
    { index: 4, text: 'Record outcome, evidence, cost, and next intent.' },
  ];

  await prisma.playbook.upsert({
    where: { id: PB_LEAD_V2 },
    update: {},
    create: {
      id: PB_LEAD_V2,
      projectId: project.id,
      name: 'Foreman lead loop',
      version: 1,
      variables: JSON.stringify(['$objective', '$workstream']),
      cadence: 'every 30m',
      retireWhen: 'The workstream is complete or explicitly paused.',
      steps: JSON.stringify(leadSteps.slice(0, 3)),
    },
  });

  await prisma.playbook.upsert({
    where: { id: PB_LEAD },
    update: {},
    create: {
      id: PB_LEAD,
      projectId: project.id,
      name: 'Foreman lead loop',
      version: 2,
      previousVersionId: PB_LEAD_V2, // gives the editor a real diff to show
      variables: JSON.stringify(['$objective', '$workstream', '$reviewer']),
      cadence: 'every 30m',
      retireWhen: 'The workstream is complete or explicitly paused.',
      steps: JSON.stringify(leadSteps),
    },
  });

  await prisma.playbook.upsert({
    where: { id: PB_WORKER },
    update: {},
    create: {
      id: PB_WORKER,
      projectId: project.id,
      name: 'Ticket worker',
      version: 7,
      variables: JSON.stringify(['$ticket', '$branch', '$reviewer']),
      cadence: 'every 30m',
      retireWhen: 'ticket merged',
      steps: JSON.stringify([
        { index: 1, text: 'Read $ticket and its thread. Restate the goal in one line.' },
        { index: 2, text: 'Plan, then work in $branch. Commit at every green test run.' },
        {
          index: 3,
          text: 'If a change alters public behaviour, stop and ask the parent.',
          condition: 'condition · escalates to parent',
        },
        { index: 4, text: 'Hand the diff to $reviewer; do not merge yourself.' },
      ]),
    },
  });

  // --- objectives ---------------------------------------------------------
  await prisma.objective.upsert({
    where: { id: OBJ_MAIN },
    update: { name: 'Ship the Foreman control plane' },
    create: {
      id: OBJ_MAIN,
      projectId: project.id,
      name: 'Ship the Foreman control plane',
      description: 'Objectives, harness trees, pulses and interventions, wired end to end.',
      status: 'active',
      targetDate: new Date(now + 6 * DAY),
      spendCapUsd: 120,
    },
  });

  // A second objective in the SAME project, so objective-scoped queries can be
  // told apart from project-scoped ones.
  await prisma.objective.upsert({
    where: { id: OBJ_QUEUE },
    update: { name: 'Keep the support queue at zero' },
    create: {
      id: OBJ_QUEUE,
      projectId: project.id,
      name: 'Keep the support queue at zero',
      description: 'A second objective sharing the project, to catch cross-objective bleed.',
      status: 'active',
      spendCapUsd: 40,
    },
  });

  // A third objective carrying a use case, so the use-case shell path is
  // visible without a real domain: selecting it adds the demo tab after
  // Playbooks and re-tints the active underline.
  await prisma.objective.upsert({
    where: { id: OBJ_DEMO },
    update: { useCase: 'demo' },
    create: {
      id: OBJ_DEMO,
      projectId: project.id,
      name: 'Demo the use-case shell',
      description: 'Carries useCase "demo", which contributes one extra tab.',
      status: 'active',
      useCase: 'demo',
      spendCapUsd: 25,
    },
  });

  const phases = [
    { name: 'Frame the mission', state: 'done', weight: 1.4, detail: 'Contract agreed.' },
    { name: 'Build the control plane', state: 'active', weight: 3.2, detail: '18 of 24 tickets' },
    { name: 'Exercise the fleet', state: 'pending', weight: 2, detail: 'Not started' },
    { name: 'Harden operations', state: 'pending', weight: 1.3, detail: 'Not started' },
  ];
  for (const [i, p] of phases.entries()) {
    await prisma.objectivePhase.upsert({
      where: { id: id(`4${String(i)}`) },
      update: { state: p.state, detail: p.detail },
      create: {
        id: id(`4${String(i)}`),
        objectiveId: OBJ_MAIN,
        name: p.name,
        state: p.state,
        weight: p.weight,
        detail: p.detail,
        orderIdx: i,
      },
    });
  }

  // --- workstreams --------------------------------------------------------
  const streams = [
    { id: WS_CONTROL, name: 'Control plane', lead: id('100'), paused: false, note: null },
    { id: WS_RUNTIME, name: 'Harness runtime', lead: id('200'), paused: false, note: null },
    {
      id: WS_SUPPORT,
      name: 'Support triage',
      lead: id('300'),
      paused: true,
      note: '2 harnesses paused by you at 08:12 — collapsed',
    },
  ];
  for (const [i, ws] of streams.entries()) {
    await prisma.workstream.upsert({
      where: { id: ws.id },
      update: { paused: ws.paused, pausedNote: ws.note, leadHarnessId: ws.lead },
      create: {
        id: ws.id,
        objectiveId: OBJ_MAIN,
        name: ws.name,
        paused: ws.paused,
        pausedAt: ws.paused ? new Date(now - 6 * HOUR) : null,
        pausedNote: ws.note,
        orderIdx: i,
        leadHarnessId: ws.lead,
      },
    });
  }

  // --- harnesses ----------------------------------------------------------
  // Parents first, so parentId always resolves.
  const ordered = [...HARNESSES].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  for (const spec of ordered) {
    const data = {
      objectiveId: OBJ_MAIN,
      workstreamId: spec.workstream === null ? null : (spec.workstream ?? WS_CONTROL),
      parentId: spec.parent ? id(spec.parent) : null,
      name: spec.name,
      status: spec.status,
      activity: spec.activity ?? null,
      mission: spec.mission,
      currentJob: spec.currentJob ?? null,
      model: spec.model,
      playbookId: spec.playbook === null ? null : (spec.playbook ?? PB_WORKER),
      branch: spec.branch ?? null,
      heartbeatMinutes: spec.heartbeatMinutes ?? 30,
      nextPulseAt:
        spec.status === 'paused' || spec.retired
          ? null
          : // A "ready" harness is staffed but has never pulsed, so it is due
            // now — which is also what lets the scheduler pick something up.
            spec.status === 'ready'
            ? new Date(now - MINUTE)
            : new Date(now + 19 * MINUTE),
      maxChildren: spec.maxChildren ?? 3,
      spendCapUsd: spec.spendCapUsd === undefined ? 5 : spec.spendCapUsd,
      spendUsd: spec.spendUsd,
      contextTokens: spec.contextTokens,
      contextWindow: spec.contextWindow ?? 200_000,
      permissions: JSON.stringify([
        { id: 'repo', label: 'Read repo, run tests, open PRs', granted: true, needsApproval: false },
        { id: 'comment', label: 'Comment on tickets it owns', granted: true, needsApproval: false },
        { id: 'merge', label: 'Merge without review', granted: false, needsApproval: true },
      ]),
      dryRun: spec.dryRun ?? false,
      idleSince:
        spec.idleMinutes == null ? null : new Date(now - spec.idleMinutes * MINUTE),
      retiredAt: spec.retired ? new Date(now - 2 * DAY) : null,
    };

    await prisma.harness.upsert({
      where: { id: id(spec.key) },
      update: data,
      create: { id: id(spec.key), ...data, lastPulseSeq: 0 },
    });
  }

  // --- pulses -------------------------------------------------------------
  // Written after harnesses so every FK resolves; spread across 7 days with a
  // deliberate cluster TODAY so `spendToday` is non-zero and sampling bugs show.
  await prisma.pulse.deleteMany({
    where: { harnessId: { in: HARNESSES.map((h) => id(h.key)) } },
  });

  for (const spec of HARNESSES) {
    const count = spec.pulseCount ?? 12;
    const series = pulseSeries(spec.pulses, count);
    if (series.length === 0) continue;

    const perPulseCost = spec.spendUsd / Math.max(1, series.length);

    for (const [i, p] of series.entries()) {
      const seq = i + 1;
      // Oldest spread back over 6 days; the newest four land today.
      // Strictly decreasing with distance from the newest pulse. The previous
      // formula walked today's four newest FORWARD from 06:00, so a higher seq
      // got an earlier timestamp and the transcript rendered out of order.
      const fromEnd = series.length - 1 - i;
      const hoursAgo = fromEnd < 4 ? fromEnd * 3 : 9 + (fromEnd - 3) * 6;
      const startedAt = new Date(now - hoursAgo * HOUR);

      await prisma.pulse.create({
        data: {
          harnessId: id(spec.key),
          seq,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 4 * MINUTE),
          outcome: p.outcome,
          summary:
            p.outcome === 'fail'
              ? `${spec.name}: hit its budget wall and stopped.`
              : p.outcome === 'idle'
                ? `${spec.name}: nothing to do this pulse.`
                : p.outcome === 'warn'
                  ? `${spec.name}: proceeded, but flagged something for review.`
                  : `${spec.name}: advanced its slice and recorded evidence.`,
          costUsd: perPulseCost,
          tokens: Math.round(p.weight * 14_000),
          weight: p.weight,
        },
      });
    }

    await prisma.harness.update({
      where: { id: id(spec.key) },
      data: { lastPulseSeq: series.length },
    });
  }

  // --- tools --------------------------------------------------------------
  const toolSpecs = [
    { name: 'Open PR', group: 'Git', status: 'ok', label: 'ok · 12m', approval: false },
    { name: 'Commit & push', group: 'Git', status: 'ok', label: 'ok · 4m', approval: false },
    { name: 'Force push', group: 'Git', status: null, label: null, approval: true },
    { name: 'Test suite', group: 'Build & ship', status: 'fail', label: '2 failed · 6m', approval: false },
    { name: 'Deploy preview', group: 'Build & ship', status: 'ok', label: 'ok · 1h', approval: false },
    { name: 'Spawn child', group: 'Fleet', status: null, label: null, approval: false },
  ];
  for (const lead of ['100', '200', '300']) {
    for (const [i, t] of toolSpecs.entries()) {
      const toolId = id(`5${lead}${String(i)}`);
      await prisma.harnessTool.upsert({
        where: { id: toolId },
        update: {},
        create: {
          id: toolId,
          harnessId: id(lead),
          name: t.name,
          groupName: t.group,
          needsApproval: t.approval,
          lastStatus: t.status,
          lastResultLabel: t.label,
          lastRanAt: t.status ? new Date(now - 12 * MINUTE) : null,
        },
      });
    }
  }

  // --- interventions ------------------------------------------------------
  await prisma.intervention.deleteMany({ where: { objectiveId: { in: [OBJ_MAIN, OBJ_QUEUE] } } });

  await prisma.intervention.create({
    data: {
      id: id('600'),
      objectiveId: OBJ_MAIN,
      harnessId: id('100'),
      kind: 'approval',
      title: 'Force-push to release/v3 to squash a bad merge',
      detail: 'Outside its permissions. 14 files, 2 deletions.',
      impact: 'blocks 2 children',
      // Object-shaped payload: the review found a partial object here crashed
      // the whole surface, so the fixture keeps one permanently in the data.
      payload: JSON.stringify({
        diff: {
          added: 214,
          removed: 38,
          filesChanged: 14,
          summary: '14 files changed · 2 deletions · rewrites 3 commits',
          lines: [
            { kind: 'add', text: '+ 214  src/webhooks/retry.ts' },
            { kind: 'del', text: '− 38   src/webhooks/legacy.ts' },
          ],
        },
      }),
      status: 'pending',
      createdAt: new Date(now - 4 * MINUTE),
    },
  });

  await prisma.intervention.create({
    data: {
      id: id('601'),
      objectiveId: OBJ_MAIN,
      harnessId: id('104'),
      kind: 'question',
      title: 'Retry with backoff, or fail the delivery and surface it?',
      detail:
        'The spec says at-least-once but the customer endpoint 500s on duplicates. Your call decides the public contract.',
      impact: 'idle since',
      status: 'pending',
      createdAt: new Date(now - 13 * HOUR),
    },
  });

  await prisma.intervention.create({
    data: {
      id: id('602'),
      objectiveId: OBJ_MAIN,
      harnessId: id('105'),
      kind: 'budget',
      title: '555-rendezvous stopped at its $5.00 cap',
      detail: 'Three retries hit the same wall.',
      payload: JSON.stringify({ spent: 5.4, cap: 5, suggestedCap: 15 }),
      status: 'pending',
      createdAt: new Date(now - HOUR),
    },
  });

  // --- tickets ------------------------------------------------------------
  // Tagged to the objective, covering every board column.
  const tickets = [
    { n: '700', title: 'Record a private demo of the orchestration flow', status: 'todo', owner: null, tags: ['growth', 'medium'] },
    { n: '701', title: 'Audit the harness interface for v4 breakage', status: 'todo', owner: null, tags: [] },
    { n: '702', title: 'Make objective state resolve in one query', status: 'in_progress', owner: '101', tags: ['integrations', 'high'] },
    { n: '703', title: 'Webhook delivery retries need a documented contract', status: 'in_progress', owner: '104', tags: ['high'] },
    { n: '704', title: 'Add a per-account preference for existing integrations', status: 'done', owner: '102', tags: [] },
    { n: '705', title: 'Pulse engine records real cost per model', status: 'done', owner: '200', tags: ['integrations'] },
    { n: '706', title: 'Rendezvous coordinator exceeded its budget', status: 'failed', owner: '105', tags: ['high'] },
  ];

  for (const t of tickets) {
    const taskId = id(t.n);
    const data = {
      projectId: project.id,
      title: t.title,
      status: t.status,
      complexity: 'medium',
      tags: JSON.stringify([...t.tags, `objective:${OBJ_MAIN}`]),
      provider: 'openai',
      model: 'gpt-5',
    };
    await prisma.task.upsert({
      where: { id: taskId },
      update: data,
      create: { id: taskId, ...data },
    });
    if (t.owner) {
      await prisma.harness.update({
        where: { id: id(t.owner) },
        data: { taskId },
      });
    }
  }

  // One ticket on the OTHER objective, so cross-objective bleed is visible.
  await prisma.task.upsert({
    where: { id: id('710') },
    update: {},
    create: {
      id: id('710'),
      projectId: project.id,
      title: 'Support queue: triage the overnight backlog',
      status: 'todo',
      complexity: 'simple',
      tags: JSON.stringify([`objective:${OBJ_QUEUE}`]),
    },
  });

  // --- transcript material ------------------------------------------------
  // Transcript entries are built from the linked Task's traces; without any,
  // the surface renders pulse dividers and nothing else.
  const traceHarness = id('104'); // 554-webhook-retry, owns ticket 703
  const traceTask = id('703');
  await prisma.taskTrace.deleteMany({ where: { taskId: traceTask } });
  const traceRows: { role: string; content: string; toolCalls?: string; minutesAgo: number }[] = [
    {
      role: 'assistant',
      content:
        'Three tests fail on expired-token replay. Reading the refresh middleware first, then patching the retry guard, then re-running only the oauth suite.',
      minutesAgo: 190,
    },
    {
      role: 'assistant',
      content: 'Inspecting the retry path.',
      toolCalls: JSON.stringify([
        { name: 'read_file', arguments: { path: 'src/webhooks/retry.ts' } },
        { name: 'run_tests', arguments: { suite: 'webhooks' } },
      ]),
      minutesAgo: 185,
    },
    {
      role: 'assistant',
      content:
        'The retry guard treats 401 and 403 the same. Splitting them fixes both tests, but it changes behaviour other adapters rely on — flagging rather than assuming.',
      minutesAgo: 180,
    },
    {
      role: 'user',
      content:
        'Split them. Keep 403 fatal. Leave a note in the adapter README so the gmail one does not regress.',
      minutesAgo: 175,
    },
  ];
  for (const t of traceRows) {
    await prisma.taskTrace.create({
      data: {
        taskId: traceTask,
        role: t.role,
        content: t.content,
        toolCalls: t.toolCalls ?? null,
        createdAt: new Date(now - t.minutesAgo * MINUTE),
      },
    });
  }
  await prisma.harness.update({ where: { id: traceHarness }, data: { taskId: traceTask } });

  const counts = {
    objectives: 3,
    workstreams: streams.length,
    harnesses: HARNESSES.length,
    retired: HARNESSES.filter((h) => h.retired).length,
    unassigned: HARNESSES.filter((h) => h.workstream === null).length,
    pulses: await prisma.pulse.count({
      where: { harnessId: { in: HARNESSES.map((h) => id(h.key)) } },
    }),
    interventions: 3,
    tickets: tickets.length + 1,
    traces: traceRows.length,
  };
  console.log('Seeded Foreman e2e fixture:', JSON.stringify(counts));
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
