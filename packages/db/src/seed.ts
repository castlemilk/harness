import { prisma, pglite } from './client.js';

export async function seedDefaults(): Promise<void> {
  await prisma.providerConfig.upsert({
    where: { name: 'ollama-local' },
    update: {},
    create: {
      name: 'ollama-local',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3',
      capabilities: JSON.stringify([{ name: 'llama3', level: 'capable' }]),
    },
  });

  if (process.env.KIMI_API_KEY) {
    await prisma.providerConfig.upsert({
      where: { name: 'kimi' },
      update: {
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'k3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'k3', level: 'advanced', supportsTools: true },
          { name: 'k3-256k', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'kimi',
        kind: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'k3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'k3', level: 'advanced', supportsTools: true },
          { name: 'k3-256k', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log('Seeded Kimi provider.');
  }
  // Disable Kimi if OMEGA_DISABLE_KIMI is set (quota exhausted etc.)
  if (process.env.OMEGA_DISABLE_KIMI) {
    await prisma.providerConfig.updateMany({
      where: { name: 'kimi' },
      data: { enabled: false },
    });
    console.log('Kimi provider disabled (OMEGA_DISABLE_KIMI).');
  }

  // GLM (z.ai) coding plan — OpenAI-compatible. Key format: <id>.<secret>.
  if (process.env.GLM_API_KEY) {
    await prisma.providerConfig.upsert({
      where: { name: 'glm' },
      update: {
        apiKey: process.env.GLM_API_KEY,
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        defaultModel: 'glm-5.2',
        capabilities: JSON.stringify([
          { name: 'glm-5.2', level: 'advanced', supportsTools: true },
          { name: 'glm-4.6', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'glm',
        kind: 'generic',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        apiKey: process.env.GLM_API_KEY,
        defaultModel: 'glm-5.2',
        capabilities: JSON.stringify([
          { name: 'glm-5.2', level: 'advanced', supportsTools: true },
          { name: 'glm-4.6', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log('Seeded GLM provider.');
  }

  // MiniMax-M3 — OpenAI-compatible. Endpoint and key provided by env.
  if (process.env.MINIMAX_API_KEY) {
    const baseUrl = process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.chat/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'minimax' },
      update: {
        apiKey: process.env.MINIMAX_API_KEY,
        baseUrl,
        defaultModel: 'MiniMax-M3',
        capabilities: JSON.stringify([
          { name: 'MiniMax-M3', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'minimax',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.MINIMAX_API_KEY,
        defaultModel: 'MiniMax-M3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'MiniMax-M3', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded MiniMax provider (${baseUrl}).`);
  }

  // DeepSeek V4 — OpenAI-compatible.
  if (process.env.DEEPSEEK_API_KEY) {
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'deepseek' },
      update: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl,
        defaultModel: 'deepseek-v4-flash',
        capabilities: JSON.stringify([
          { name: 'deepseek-v4-pro', level: 'advanced', supportsTools: true, thinking: true, reasoningEffort: 'high' },
          { name: 'deepseek-v4-flash', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'deepseek',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.DEEPSEEK_API_KEY,
        defaultModel: 'deepseek-v4-flash',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'deepseek-v4-pro', level: 'advanced', supportsTools: true, thinking: true, reasoningEffort: 'high' },
          { name: 'deepseek-v4-flash', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded DeepSeek provider (${baseUrl}).`);
  }

  // Qwen (Alibaba Cloud Model Studio token-plan, ap-southeast-1).
  // OpenAI-compatible endpoint at .../compatible-mode/v1. Exposes the
  // latest Qwen3.x family plus glm-5.2 and deepseek-v4-pro as alternates.
  if (process.env.QWEN_API_KEY) {
    const baseUrl =
      process.env.QWEN_BASE_URL ?? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'qwen' },
      update: {
        apiKey: process.env.QWEN_API_KEY,
        baseUrl,
        defaultModel: 'qwen3.8-max-preview',
        capabilities: JSON.stringify([
          { name: 'qwen3.8-max-preview', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-max', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-plus', level: 'advanced', supportsTools: true },
          { name: 'qwen3.6-flash', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'qwen',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.QWEN_API_KEY,
        defaultModel: 'qwen3.8-max-preview',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'qwen3.8-max-preview', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-max', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-plus', level: 'advanced', supportsTools: true },
          { name: 'qwen3.6-flash', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded Qwen provider (${baseUrl}).`);
  }

  console.log('Seeded default providers.');
}

function foremanDemoUuid(value: number): string {
  return `f0e00000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

interface ForemanHarnessSeed {
  id: string;
  objectiveId: string;
  workstreamId: string;
  parentId: string | null;
  name: string;
  status: string;
  activity: string | null;
  mission: string;
  currentJob: string | null;
  model: string;
  playbookId: string;
  taskId: string | null;
  branch: string | null;
  heartbeatMinutes: number;
  nextPulseAt: Date | null;
  maxChildren: number;
  spendCapUsd: number;
  spendUsd: number;
  contextTokens: number;
  contextWindow: number;
  permissions: string;
  dryRun: boolean;
  lastPulseSeq: number;
  idleSince: Date | null;
  createdAt: Date;
  retiredAt: Date | null;
}

interface ForemanHarnessOptions {
  status?: string;
  activity?: string | null;
  currentJob?: string | null;
  model?: string;
  playbookId?: string;
  taskId?: string | null;
  branch?: string | null;
  maxChildren?: number;
  spendCapUsd?: number;
  contextTokens?: number;
  permissions?: string[];
  dryRun?: boolean;
  idleSince?: Date | null;
}

export async function seedForemanDemo(): Promise<void> {
  const projectId = foremanDemoUuid(1);
  const objectiveId = foremanDemoUuid(2);
  const phaseIds = [10, 11, 12, 13].map(foremanDemoUuid);
  const workstreamIds = [20, 21, 22].map(foremanDemoUuid);
  const playbookIds = [30, 31].map(foremanDemoUuid);
  const taskIds = [40, 41, 42].map(foremanDemoUuid);
  const leadIds = [100, 101, 102].map(foremanDemoUuid);
  const demoCreatedAt = new Date('2026-08-10T00:00:00.000Z');
  const nextPulseAt = new Date('2026-08-14T12:30:00.000Z');

  const phases = [
    {
      id: phaseIds[0],
      objectiveId,
      name: 'Frame the mission',
      state: 'done',
      weight: 0.15,
      detail: 'Agree on the operating contract, constraints, and measures of success.',
      orderIdx: 0,
    },
    {
      id: phaseIds[1],
      objectiveId,
      name: 'Build the control plane',
      state: 'active',
      weight: 0.35,
      detail: 'Connect objective state, harness trees, pulses, and interventions.',
      orderIdx: 1,
    },
    {
      id: phaseIds[2],
      objectiveId,
      name: 'Exercise the fleet',
      state: 'pending',
      weight: 0.3,
      detail: 'Run representative work through nested harnesses and inspect outcomes.',
      orderIdx: 2,
    },
    {
      id: phaseIds[3],
      objectiveId,
      name: 'Harden operations',
      state: 'pending',
      weight: 0.2,
      detail: 'Close observability gaps and document operator response paths.',
      orderIdx: 3,
    },
  ];

  const workstreams = [
    {
      id: workstreamIds[0],
      objectiveId,
      name: 'Control plane',
      paused: false,
      pausedAt: null,
      pausedNote: null,
      orderIdx: 0,
      leadHarnessId: leadIds[0],
    },
    {
      id: workstreamIds[1],
      objectiveId,
      name: 'Harness runtime',
      paused: false,
      pausedAt: null,
      pausedNote: null,
      orderIdx: 1,
      leadHarnessId: leadIds[1],
    },
    {
      id: workstreamIds[2],
      objectiveId,
      name: 'Operator experience',
      paused: false,
      pausedAt: null,
      pausedNote: null,
      orderIdx: 2,
      leadHarnessId: leadIds[2],
    },
  ];

  const createHarness = (
    serial: number,
    name: string,
    workstreamId: string,
    parentId: string | null,
    mission: string,
    options: ForemanHarnessOptions = {},
  ): ForemanHarnessSeed => {
    const permissionIds = options.permissions ?? ['read', 'edit', 'test'];
    const permissions = permissionIds.map((id) => ({
      id,
      label: id
        .split('-')
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' '),
      granted: id !== 'apply-change',
      needsApproval: id === 'apply-change',
    }));

    return {
      id: foremanDemoUuid(serial),
      objectiveId,
      workstreamId,
      parentId,
      name,
      status: options.status ?? 'working',
      activity: options.activity === undefined ? 'Advancing assigned objective work' : options.activity,
      mission,
      currentJob: options.currentJob === undefined ? 'Review the next objective slice' : options.currentJob,
      model: options.model ?? 'gpt-5',
      playbookId: options.playbookId ?? playbookIds[1],
      taskId: options.taskId ?? null,
      branch: options.branch ?? null,
      heartbeatMinutes: 30,
      nextPulseAt: options.dryRun === true ? null : nextPulseAt,
      maxChildren: options.maxChildren ?? 2,
      spendCapUsd: options.spendCapUsd ?? 8,
      spendUsd: 0,
      contextTokens: options.contextTokens ?? 18_000,
      contextWindow: 200_000,
      permissions: JSON.stringify(permissions),
      dryRun: options.dryRun ?? false,
      lastPulseSeq: 12,
      idleSince: options.idleSince ?? null,
      createdAt: demoCreatedAt,
      retiredAt: null,
    };
  };

  const harnesses: ForemanHarnessSeed[] = [
    createHarness(
      100,
      'Control Lead',
      workstreamIds[0],
      null,
      'Keep the objective contract coherent and turn ambiguity into sequenced work.',
      {
        playbookId: playbookIds[0],
        taskId: taskIds[0],
        branch: 'agent/foreman-control',
        maxChildren: 3,
        spendCapUsd: 24,
        contextTokens: 41_200,
        permissions: ['read', 'edit', 'test', 'delegate', 'apply-change'],
        currentJob: 'Reconcile objective state with active workstreams',
      },
    ),
    createHarness(
      101,
      'Runtime Lead',
      workstreamIds[1],
      null,
      'Make pulse execution reliable, bounded, and observable across the harness tree.',
      {
        playbookId: playbookIds[0],
        taskId: taskIds[1],
        branch: 'agent/foreman-runtime',
        maxChildren: 3,
        spendCapUsd: 28,
        contextTokens: 38_600,
        permissions: ['read', 'edit', 'test', 'delegate', 'run-command'],
        currentJob: 'Validate heartbeat and pulse sequencing invariants',
      },
    ),
    createHarness(
      102,
      'Experience Lead',
      workstreamIds[2],
      null,
      'Give operators a legible view of progress, risk, spend, and decisions.',
      {
        playbookId: playbookIds[0],
        taskId: taskIds[2],
        branch: 'agent/foreman-experience',
        maxChildren: 3,
        spendCapUsd: 20,
        contextTokens: 35_900,
        permissions: ['read', 'edit', 'test', 'delegate', 'preview'],
        currentJob: 'Shape the intervention queue and transcript views',
      },
    ),
    createHarness(
      110,
      'Objective Planner',
      workstreamIds[0],
      leadIds[0],
      'Translate the objective into ordered, measurable phases.',
      { currentJob: 'Check phase weights and exit criteria', model: 'glm-5.2' },
    ),
    createHarness(
      111,
      'Research Scout',
      workstreamIds[0],
      leadIds[0],
      'Resolve unknowns before they become expensive implementation risks.',
      { currentJob: 'Compare orchestration state models', maxChildren: 2 },
    ),
    createHarness(
      112,
      'Risk Analyst',
      workstreamIds[0],
      leadIds[0],
      'Continuously surface schedule, spend, and dependency risk.',
      {
        status: 'waiting',
        activity: 'Waiting for an operator budget decision',
        currentJob: 'Assess the projected validation spend',
        model: 'qwen3.8-max-preview',
      },
    ),
    createHarness(
      113,
      'Runtime Implementer',
      workstreamIds[1],
      leadIds[1],
      'Implement small runtime slices with clear rollback and cleanup paths.',
      { currentJob: 'Wire deterministic pulse persistence', branch: 'agent/runtime-pulses' },
    ),
    createHarness(
      114,
      'Runtime Verifier',
      workstreamIds[1],
      leadIds[1],
      'Prove runtime behavior at boundaries and under repeated execution.',
      { currentJob: 'Exercise idempotent pulse replay', maxChildren: 2, model: 'glm-5.2' },
    ),
    createHarness(
      115,
      'Release Shepherd',
      workstreamIds[1],
      leadIds[1],
      'Keep integration evidence current and releases reversible.',
      { currentJob: 'Review migration and build evidence', branch: 'agent/foreman-release' },
    ),
    createHarness(
      116,
      'UX Observer',
      workstreamIds[2],
      leadIds[2],
      'Find places where operational state is technically present but hard to understand.',
      { currentJob: 'Inspect hierarchy and spend legibility', model: 'qwen3.8-max-preview' },
    ),
    createHarness(
      117,
      'Operator Liaison',
      workstreamIds[2],
      leadIds[2],
      'Keep operator questions concise, contextual, and actionable.',
      {
        status: 'watching',
        activity: null,
        currentJob: null,
        idleSince: new Date('2026-08-14T10:45:00.000Z'),
      },
    ),
    createHarness(
      120,
      'Research Probe',
      workstreamIds[0],
      foremanDemoUuid(111),
      'Collect a narrow evidence packet for the current orchestration question.',
      {
        currentJob: 'Check self-relation deletion behavior',
        maxChildren: 0,
        spendCapUsd: 3,
        dryRun: true,
      },
    ),
    createHarness(
      121,
      'Test Sampler',
      workstreamIds[1],
      foremanDemoUuid(114),
      'Run a focused sample that challenges the verifier hypothesis.',
      {
        currentJob: 'Repeat the seed and compare aggregate counts',
        maxChildren: 0,
        spendCapUsd: 3,
      },
    ),
  ];

  const pulseOutcomes = [
    'ok',
    'ok',
    'ok',
    'warn',
    'fail',
    'ok',
    'ok',
    'idle',
    'ok',
    'ok',
    'warn',
    'ok',
  ];
  const pulseEpoch = demoCreatedAt.getTime();
  const pulses = harnesses.flatMap((harness, harnessIndex) =>
    Array.from({ length: 12 }, (_, index) => {
      const seq = index + 1;
      const startedAt = new Date(pulseEpoch + (harnessIndex * 12 + index) * 30 * 60 * 1000);
      const costUsd = Number((0.006 + ((harnessIndex + seq) % 7) * 0.003).toFixed(3));
      return {
        id: foremanDemoUuid(10_000 + harnessIndex * 100 + seq),
        harnessId: harness.id,
        seq,
        startedAt,
        endedAt: new Date(startedAt.getTime() + (4 + (seq % 4)) * 60 * 1000),
        outcome: pulseOutcomes[(index + harnessIndex) % pulseOutcomes.length],
        summary: `${harness.name} pulse ${String(seq)}: ${pulseOutcomes[(index + harnessIndex) % pulseOutcomes.length]}`,
        costUsd,
        tokens: 700 + harnessIndex * 37 + seq * 113,
        weight: [0.25, 0.5, 0.75, 1][(index + harnessIndex) % 4],
      };
    }),
  );

  const playbooks = [
    {
      id: playbookIds[0],
      projectId,
      name: 'Foreman lead loop',
      version: 1,
      variables: JSON.stringify(['objectiveId', 'workstreamId', 'spendCapUsd']),
      cadence: 'every 30m',
      retireWhen: 'The workstream is complete or explicitly paused.',
      steps: JSON.stringify([
        { index: 1, text: 'Read objective, children, spend, and interventions.', condition: null },
        { index: 2, text: 'Choose the smallest useful next action.', condition: null },
        { index: 3, text: 'Assign bounded work when specialist capacity exists.', condition: 'capacity > 0' },
        { index: 4, text: 'Record outcome, evidence, cost, and next intent.', condition: null },
      ]),
      previousVersionId: null,
      createdAt: demoCreatedAt,
    },
    {
      id: playbookIds[1],
      projectId,
      name: 'Foreman specialist loop',
      version: 1,
      variables: JSON.stringify(['mission', 'currentJob']),
      cadence: 'every 30m',
      retireWhen: 'The assigned job has evidence-backed completion or cannot progress.',
      steps: JSON.stringify([
        { index: 1, text: 'Read the assigned slice and its acceptance criteria.', condition: null },
        { index: 2, text: 'Make one bounded unit of progress.', condition: null },
        { index: 3, text: 'Run the narrowest reliable check.', condition: 'a change was made' },
        { index: 4, text: 'Summarize evidence, blockers, spend, and next action.', condition: null },
      ]),
      previousVersionId: null,
      createdAt: demoCreatedAt,
    },
  ];

  const tasks = [
    {
      id: taskIds[0],
      projectId,
      title: 'Define the Foreman orchestration contract',
      description: 'Model objectives, phases, workstreams, nested harnesses, and operator interventions.',
      status: 'done',
      complexity: 'complex',
      tags: JSON.stringify([
        `objective:${objectiveId}`,
        'ticket:FM-101',
        'pr:42',
        'foreman',
        'control-plane',
        'assignment:Review the orchestration contract',
      ]),
      provider: 'ollama-local',
      model: 'llama3',
      result: 'The orchestration contract is ready for runtime integration.',
      error: null,
      retryCount: 0,
      lastRetryAt: null,
      retryHistory: JSON.stringify([]),
      createdAt: new Date('2026-08-10T01:00:00.000Z'),
    },
    {
      id: taskIds[1],
      projectId,
      title: 'Implement deterministic pulse scheduling',
      description: 'Persist ordered pulse outcomes and keep harness spend and sequence state consistent.',
      status: 'in_progress',
      complexity: 'complex',
      tags: JSON.stringify([
        `objective:${objectiveId}`,
        `parent:${taskIds[0]}`,
        'ticket:FM-102',
        'pr:43',
        'foreman',
        'runtime',
        'assignment:Validate pulse persistence',
      ]),
      provider: 'ollama-local',
      model: 'llama3',
      result: null,
      error: null,
      retryCount: 0,
      lastRetryAt: null,
      retryHistory: JSON.stringify([]),
      createdAt: new Date('2026-08-10T02:00:00.000Z'),
    },
    {
      id: taskIds[2],
      projectId,
      title: 'Validate the operator intervention flow',
      description: 'Exercise approvals, questions, and budget requests with enough context to decide.',
      status: 'todo',
      complexity: 'medium',
      tags: JSON.stringify([
        `objective:${objectiveId}`,
        `parent:${taskIds[0]}`,
        'ticket:FM-103',
        'foreman',
        'operator-experience',
        'assignment:Review intervention copy',
      ]),
      provider: null,
      model: null,
      result: null,
      error: null,
      retryCount: 0,
      lastRetryAt: null,
      retryHistory: JSON.stringify([]),
      createdAt: new Date('2026-08-10T03:00:00.000Z'),
    },
  ];

  const traces = tasks.flatMap((task, taskIndex) => [
    {
      id: foremanDemoUuid(1_000 + taskIndex * 10 + 1),
      taskId: task.id,
      stepId: null,
      role: 'user',
      content: task.description,
      toolCalls: JSON.stringify([]),
      createdAt: new Date(task.createdAt.getTime() + 60_000),
    },
    {
      id: foremanDemoUuid(1_000 + taskIndex * 10 + 2),
      taskId: task.id,
      stepId: null,
      role: 'assistant',
      content: `I will advance “${task.title}” and report concrete verification evidence.`,
      toolCalls: JSON.stringify([
        { id: `foreman-demo-${String(taskIndex + 1)}`, name: 'inspect_objective', arguments: { objectiveId } },
      ]),
      createdAt: new Date(task.createdAt.getTime() + 120_000),
    },
    {
      id: foremanDemoUuid(1_000 + taskIndex * 10 + 3),
      taskId: task.id,
      stepId: null,
      role: 'tool',
      content: JSON.stringify({ objective: 'Ship the Foreman control plane', status: 'active' }),
      toolCalls: JSON.stringify([]),
      createdAt: new Date(task.createdAt.getTime() + 180_000),
    },
  ]);

  const interventions = [
    {
      id: foremanDemoUuid(200),
      objectiveId,
      harnessId: leadIds[0],
      kind: 'approval',
      title: 'Approve the additive Foreman migration',
      detail: 'The control lead is ready to apply the new orchestration tables to the demo database.',
      impact: 'Unblocks runtime and UI integration without modifying existing tables.',
      payload: JSON.stringify({
        permissionId: 'apply-change',
        diff: '+ CREATE TABLE "Objective" (...)\n+ CREATE TABLE "Harness" (...)',
      }),
      status: 'pending',
      response: null,
      createdAt: new Date('2026-08-14T09:00:00.000Z'),
      resolvedAt: null,
    },
    {
      id: foremanDemoUuid(201),
      objectiveId,
      harnessId: leadIds[2],
      kind: 'question',
      title: 'Choose the default intervention ordering',
      detail: 'Should the operator queue prioritize urgency, age, or objective phase?',
      impact: 'Determines which pending decision appears first in the Foreman view.',
      payload: JSON.stringify({ choices: ['urgency', 'oldest-first', 'objective-phase'] }),
      status: 'pending',
      response: null,
      createdAt: new Date('2026-08-14T09:15:00.000Z'),
      resolvedAt: null,
    },
    {
      id: foremanDemoUuid(202),
      objectiveId,
      harnessId: leadIds[1],
      kind: 'budget',
      title: 'Extend the runtime validation budget',
      detail: 'Two additional repeated-seed and migration checks would improve confidence.',
      impact: 'Adds approximately $6 of validation capacity and may reduce release risk.',
      payload: JSON.stringify({ spent: 21.75, cap: 28, suggestedCap: 34 }),
      status: 'pending',
      response: null,
      createdAt: new Date('2026-08-14T09:30:00.000Z'),
      resolvedAt: null,
    },
  ];

  const toolTemplates = [
    {
      name: 'inspect_objective',
      groupName: 'Context',
      needsApproval: false,
      lastStatus: 'ok',
      lastResultLabel: 'Objective snapshot loaded',
    },
    {
      name: 'delegate_harness',
      groupName: 'Coordination',
      needsApproval: false,
      lastStatus: 'ok',
      lastResultLabel: 'Child assignment recorded',
    },
    {
      name: 'apply_change',
      groupName: 'Execution',
      needsApproval: true,
      lastStatus: 'awaiting_approval',
      lastResultLabel: 'Approval required',
    },
  ];
  const tools = leadIds.flatMap((harnessId, leadIndex) =>
    toolTemplates.map((tool, toolIndex) => ({
      id: foremanDemoUuid(20_000 + leadIndex * 10 + toolIndex),
      harnessId,
      ...tool,
      lastRanAt: new Date(Date.UTC(2026, 7, 14, 7 + leadIndex, 15 + toolIndex * 10)),
    })),
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.project.upsert({
        where: { id: projectId },
        update: {
          name: 'Omega Foreman Demo',
          path: '/tmp/omega-foreman-demo',
          repoUrl: 'https://github.com/castlemilk/omega',
          description: 'Stable demo data for the Foreman objective orchestration surface.',
          env: JSON.stringify({ demo: true, surface: 'foreman' }),
          createdAt: demoCreatedAt,
        },
        create: {
          id: projectId,
          name: 'Omega Foreman Demo',
          path: '/tmp/omega-foreman-demo',
          repoUrl: 'https://github.com/castlemilk/omega',
          description: 'Stable demo data for the Foreman objective orchestration surface.',
          env: JSON.stringify({ demo: true, surface: 'foreman' }),
          createdAt: demoCreatedAt,
        },
      });

      await tx.objective.upsert({
        where: { id: objectiveId },
        update: {
          projectId,
          name: 'Ship the Foreman control plane',
          description: 'Coordinate a nested harness fleet toward an observable, budget-aware operator surface.',
          status: 'active',
          targetDate: new Date('2026-09-30T00:00:00.000Z'),
          spendCapUsd: 120,
          createdAt: demoCreatedAt,
        },
        create: {
          id: objectiveId,
          projectId,
          name: 'Ship the Foreman control plane',
          description: 'Coordinate a nested harness fleet toward an observable, budget-aware operator surface.',
          status: 'active',
          targetDate: new Date('2026-09-30T00:00:00.000Z'),
          spendCapUsd: 120,
          createdAt: demoCreatedAt,
        },
      });

      for (const phase of phases) {
        const { id, ...data } = phase;
        await tx.objectivePhase.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const workstream of workstreams) {
        const { id, ...data } = workstream;
        await tx.workstream.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const playbook of playbooks) {
        const { id, ...data } = playbook;
        await tx.playbook.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const task of tasks) {
        const { id, ...data } = task;
        await tx.task.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const trace of traces) {
        const { id, ...data } = trace;
        await tx.taskTrace.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const harness of harnesses) {
        const harnessPulses = pulses.filter((pulse) => pulse.harnessId === harness.id);
        const spendUsd = Number(
          harnessPulses.reduce((total, pulse) => total + pulse.costUsd, 0).toFixed(3),
        );
        const { id, ...data } = { ...harness, spendUsd };
        await tx.harness.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const pulse of pulses) {
        const { id, ...data } = pulse;
        await tx.pulse.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const intervention of interventions) {
        const { id, ...data } = intervention;
        await tx.intervention.upsert({ where: { id }, update: data, create: { id, ...data } });
      }

      for (const tool of tools) {
        const { id, ...data } = tool;
        await tx.harnessTool.upsert({ where: { id }, update: data, create: { id, ...data } });
      }
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  console.log('Seeded Foreman demo (1 objective, 13 harnesses, 156 pulses).');
}

async function main(): Promise<void> {
  await seedDefaults();
  await seedForemanDemo();
  await prisma.$disconnect();
  await pglite.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
