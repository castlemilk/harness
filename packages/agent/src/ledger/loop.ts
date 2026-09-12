import { bullets, extractPython, hasAnswer, parseTasks, sections, stripThink, type ParsedTask } from './parse.js';
import {
  FALLBACK_NEXT_TASK,
  FINALIZE_GOAL,
  FRESH_GOAL,
  cutoffSystem,
  cutoffUser,
  ideationSystem,
  managerManageSystem,
  managerManageUser,
  managerPlanSystem,
  workerSystem,
  workerUser,
} from './prompts.js';
import { appendTranscript, initWorkspace, readText, writeText } from './workspace.js';
import { runSampleTests, sampleFailFeedback, samplePassFeedback, type SampleTestSummary } from './verifier.js';
import type {
  LedgerCallRecord,
  LedgerCallRequest,
  LedgerCallResult,
  LedgerOptions,
  LedgerProblem,
  LedgerResult,
  LedgerSend,
  LedgerSpec,
  LedgerUsage,
} from './types.js';

const ARTIFACT_LABEL = 'SOLUTION';
const CUTOFF_SNIPPET_CHARS = 4000;

function firstTodo(tasks: ParsedTask[]): string | undefined {
  return tasks.find((task) => task.status !== 'done')?.desc;
}

function sampleFixTask(fail: { input: string; expected: string; got: string }): string {
  return `Fix the failing sample test case (input=${JSON.stringify(fail.input)} expected=${JSON.stringify(fail.expected)} got=${JSON.stringify(fail.got)}) or switch to a different approach.`;
}

export async function runLedgerLoop(
  send: LedgerSend,
  problem: LedgerProblem,
  spec: LedgerSpec,
  opts: LedgerOptions,
): Promise<LedgerResult> {
  const dir = opts.workspaceDir;
  const maxIters = opts.maxIters ?? 10;
  const maxTasks = opts.maxTasks ?? 12;
  const calls: LedgerCallRecord[] = [];
  const usage: LedgerUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let truncatedCalls = 0;

  const call = async (
    role: string,
    system: string,
    user: string,
    temperature: number,
  ): Promise<LedgerCallResult> => {
    const request: LedgerCallRequest = { role, system, user, temperature };
    if (opts.maxOutputTokens !== undefined) request.maxOutputTokens = opts.maxOutputTokens;
    const startedAt = Date.now();
    const result = await send(request);
    const durationMs = Date.now() - startedAt;
    const text = result.text;
    const truncated = result.finishReason === 'length';
    if (truncated) truncatedCalls += 1;
    usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
    usage.completionTokens = (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
    usage.totalTokens = (usage.totalTokens ?? 0) + (result.usage?.totalTokens ?? 0);
    const record: LedgerCallRecord = {
      role,
      request,
      response: text,
      finishReason: result.finishReason,
      usage: result.usage,
      costUsd: result.costUsd,
      truncated,
      startedAt,
      durationMs,
    };
    calls.push(record);
    await appendTranscript(dir, record);
    return { ...result, text };
  };

  await initWorkspace(dir, problem);

  const planCall = await call(
    'manager_plan',
    managerPlanSystem('competitive programming'),
    problem.statement,
    0.3,
  );
  const planSections = sections(stripThink(planCall.text), ['PLAN', 'TASKS']);
  await writeText(dir, 'plan.md', planSections.PLAN ?? '', 4000);
  let taskLines = planSections.TASKS ?? '';

  const ideationCall = await call('ideation', ideationSystem, problem.statement, 0.4);
  const ideationSections = sections(stripThink(ideationCall.text), ['NOTES', 'NEXT']);
  const ideationNotes = (ideationSections.NOTES ?? '').slice(0, 8000);
  const notesBeforeIdeation = await readText(dir, 'notes.md');
  await writeText(dir, 'notes.md', `${notesBeforeIdeation}\n## ideation\n${ideationNotes}\n`);

  let proposals: string[] = bullets(ideationSections.NEXT ?? '');
  let tasks: ParsedTask[] = [];

  // Fresh-perspective arm from the paper's discussion: one worker attempts the
  // problem with no plan and no notes, so the manager has an independent
  // candidate to compare against the evolving one. It never overwrites
  // solution.py; its code lands in solution-fresh.py.
  if (opts.freshPerspective) {
    const freshCall = await call(
      'fresh_worker',
      workerSystem(spec.solverSystem),
      workerUser({
        problem: problem.statement,
        plan: '(none - independent attempt)',
        notes: '(none - independent attempt)',
        current: '(none)',
        goal: FRESH_GOAL,
      }),
      0.2,
    );
    const freshText = stripThink(freshCall.text);
    const freshSections = sections(freshText, ['CODE', 'NOTES', 'NEXT', 'STATUS']);
    const freshCode = extractPython(freshText);
    if (freshCode.trim().length > 0) {
      await writeText(dir, 'solution-fresh.py', freshCode);
    }
    const freshNotes = (freshSections.NOTES ?? '').slice(0, 2000);
    if (freshNotes) {
      const notesNow = await readText(dir, 'notes.md');
      await writeText(dir, 'notes.md', `${notesNow}\n## fresh perspective\n${freshNotes}\n`);
    }
    proposals = [
      freshCode.trim().length > 0
        ? 'fresh perspective wrote an independent candidate to solution-fresh.py'
        : 'fresh perspective attempted an independent solution (see notes)',
      ...proposals,
    ];
  }

  const manage = async (
    lastSummary: string,
  ): Promise<{ done: boolean; next: string; tasks: ParsedTask[] }> => {
    const result = await call(
      'manager',
      managerManageSystem,
      managerManageUser({
        problem: problem.statement,
        artifactLabel: ARTIFACT_LABEL,
        artifact: await readText(dir, 'solution.py'),
        notes: await readText(dir, 'notes.md'),
        taskLines,
        lastSummary,
        proposals: proposals.length ? proposals.map((item) => `- ${item}`).join('\n') : '(none)',
      }),
      0.2,
    );
    const parsed = sections(stripThink(result.text), ['STATUS', 'NEXT', 'TASKS']);
    const parsedTasks = parseTasks(stripThink(result.text), maxTasks);
    if (parsed.TASKS !== undefined) {
      taskLines = parsed.TASKS;
      await writeText(dir, 'tasks.json', JSON.stringify(parsedTasks, null, 2));
    }
    return {
      done: /^done\b/i.test((parsed.STATUS ?? '').trim()),
      next: (parsed.NEXT ?? '').trim(),
      tasks: parsedTasks,
    };
  };

  let manageResult = await manage('(no worker attempts yet)');
  tasks = manageResult.tasks;
  let managerDone = manageResult.done && (await hasAnswer(dir, spec.kind));
  let nextTask = manageResult.next;
  if (!nextTask) nextTask = firstTodo(tasks) ?? FALLBACK_NEXT_TASK;

  let termination: 'done' | 'no_progress' | 'max_iters' | 'exhausted' = managerDone
    ? 'done'
    : 'exhausted';
  let iters = 0;
  let lastTaskKey = '';

  while (!managerDone && nextTask && iters < maxIters) {
    const taskKey = nextTask.trim().toLowerCase();
    if (lastTaskKey && taskKey === lastTaskKey) {
      termination = 'no_progress';
      break;
    }
    lastTaskKey = taskKey;
    const taskDesc = nextTask;
    iters += 1;

    const worker = await call(
      'worker',
      workerSystem(spec.solverSystem),
      workerUser({
        problem: problem.statement,
        plan: await readText(dir, 'plan.md'),
        notes: await readText(dir, 'notes.md'),
        current: await readText(dir, 'solution.py'),
        goal: `Complete this task: ${taskDesc}`,
      }),
      0.2,
    );

    const workerText = stripThink(worker.text);
    const workerSections = sections(workerText, ['CODE', 'NOTES', 'NEXT', 'STATUS']);
    let summary = workerText;

    if (worker.finishReason === 'length') {
      const cutoff = await call(
        'cutoff_summary',
        cutoffSystem,
        cutoffUser(taskDesc, workerText.slice(0, CUTOFF_SNIPPET_CHARS)),
        0.2,
      );
      summary = `worker EXCEEDED THE TOKEN LIMIT and was cut off before finishing task: ${taskDesc.slice(0, 80)}. ${stripThink(cutoff.text).trim()}`;
    }

    let wroteSolution = false;
    const code = extractPython(workerText);
    // Accept any fenced Python block, not only one under a `### CODE` header:
    // models frequently omit the header and the reference scaffold's extractor
    // falls back to the first fence the same way.
    if (code.trim()) {
      await writeText(dir, 'solution.py', code);
      wroteSolution = true;
    }

    let sampleResult: SampleTestSummary | undefined;
    if (wroteSolution && problem.tests?.length) {
      sampleResult = await runSampleTests(dir, problem.tests);
      if (sampleResult.ran && sampleResult.fail) {
        summary = sampleFailFeedback(sampleResult.passed, sampleResult.total, sampleResult.fail) + summary;
      } else if (sampleResult.ran) {
        summary = samplePassFeedback(sampleResult.total) + summary;
      }
    }

    if (worker.finishReason !== 'length' && workerSections.NOTES !== undefined) {
      await writeText(dir, 'notes.md', workerSections.NOTES, 8000);
    }

    proposals = bullets(workerSections.NEXT ?? '');
    manageResult = await manage(summary);
    tasks = manageResult.tasks;
    managerDone = manageResult.done && (await hasAnswer(dir, spec.kind));
    nextTask = manageResult.next;

    if (managerDone && sampleResult?.ran && sampleResult.fail) {
      managerDone = false;
      nextTask = nextTask || sampleFixTask(sampleResult.fail);
    }
    if (!managerDone && !nextTask) {
      nextTask = firstTodo(tasks) ?? FALLBACK_NEXT_TASK;
    }
  }

  if (!managerDone && nextTask && iters >= maxIters) termination = 'max_iters';

  let finalArtifact = await hasAnswer(dir, spec.kind);
  if (!(managerDone && finalArtifact)) {
    const finalizeCall = await call(
      'worker',
      workerSystem(spec.solverSystem),
      workerUser({
        problem: problem.statement,
        plan: await readText(dir, 'plan.md'),
        notes: await readText(dir, 'notes.md'),
        current: await readText(dir, 'solution.py'),
        goal: FINALIZE_GOAL,
      }),
      0.2,
    );
    const finalCode = extractPython(stripThink(finalizeCall.text));
    if (finalCode.trim()) await writeText(dir, 'solution.py', finalCode);
    finalArtifact = await hasAnswer(dir, spec.kind);
  }

  let status: LedgerResult['status'] = 'failed';
  if (finalArtifact) {
    if (managerDone) status = 'done';
    else if (termination === 'no_progress') status = 'no_progress';
    else if (termination === 'max_iters') status = 'max_iters';
    else status = 'done';
  }

  const solution = await readText(dir, 'solution.py');
  return { solution, status, calls, truncatedCalls, usage, ws: dir };
}