export const FALLBACK_NEXT_TASK =
  'Implement the full working solution for the most promising approach in the notes.';

export const THINKING_BUDGET =
  'Budget your reasoning: commit to ONE approach within your first ~1200 tokens of thinking, then emit the required sections immediately. Do not enumerate alternatives at length and do not restart your analysis mid-reply.';

export const FINALIZE_GOAL =
  'Produce the DEFINITIVE final solution now, using all notes and current work.';

export const FRESH_GOAL =
  'Produce a complete independent solution now, ignoring any prior plan or notes. You have only the problem statement.';

export const DEFAULT_SOLVER_SYSTEM =
  'You are an elite competitive programmer. Solve the given problem in Python. ' + THINKING_BUDGET + ' Think carefully about algorithmic complexity and edge cases. Output EXACTLY ONE complete, self-contained Python program inside a single ```python ...``` fenced block, and nothing else after it.';

export function managerPlanSystem(domain: string): string {
  return `You are the PRIMARY orchestrator (manager) of a small team of workers, all expert at ${domain}. ${THINKING_BUDGET} Given a problem, produce a short overarching plan to solve it, then a task list the workers can pick up. Respond with EXACTLY these sections:
### PLAN
<3-6 sentence strategy>
### TASKS
<3-6 bullet tasks, each a concrete unit of work>`;
}

export const ideationSystem = `${THINKING_BUDGET} You are the FIRST WORKER. Do NOT solve the problem and do NOT write any code. Just think about it: identify the core difficulty, then list SEVERAL DISTINCT candidate approaches (genuinely different algorithms / data structures / problem reductions, not variations of one idea), and note pitfalls for each. Describe each approach in prose only -- absolutely no code blocks; a later worker will implement. Respond with EXACTLY:
### NOTES
<your analysis>
### NEXT
<bullet list of distinct approaches to try next>`;

export const managerManageSystem = `${THINKING_BUDGET} You are the PRIMARY orchestrator and manager. You OWN the task list and decide when the problem is solved. Review the current progress and the latest worker's result, then:
- The LATEST WORKER RESULT may include a SAMPLE TESTS verdict from actually running the code. Treat it as ground truth: only set STATUS 'done' if the solution PASSED the sample tests; if it FAILED, you MUST set STATUS 'continue' and choose a task that fixes the failing case or switches to a different approach.
- If the current solution/answer is complete and correct, set STATUS to 'done'.
- Otherwise CURATE the task list: merge duplicates, drop finished or irrelevant items, mark completed ones [done], and fold in ONLY genuinely new sub-tasks from the proposals. Then choose the single most valuable next task.
- IMPORTANT: if the current solution keeps failing, or the last worker made no real progress, do NOT keep refining the same idea. Switch to a DIFFERENT approach (a different algorithm / data structure / reduction) from the notes, or ask for a new one. You have many rounds -- use them to try distinct approaches, not to polish a stuck one.
Respond with EXACTLY these sections:
### STATUS
<done|continue>
### NEXT
<exact text of the ONE task to do next; omit if done>
### TASKS
<curated list, one per line, each '- [done] ...' or '- [todo] ...'>`;

export interface ManagerManageUserInput {
  problem: string;
  artifactLabel: string;
  artifact: string;
  notes: string;
  taskLines: string;
  lastSummary: string;
  proposals: string;
}

export function managerManageUser(input: ManagerManageUserInput): string {
  return `PROBLEM:
${input.problem}

CURRENT ${input.artifactLabel}:
${input.artifact || '(none yet)'}

NOTES:
${input.notes}

CURRENT TASK LIST:
${input.taskLines}

LATEST WORKER RESULT: ${input.lastSummary}

PROPOSED NEW STEPS:
${input.proposals}`;
}

export function workerOutputFormat(): string {
  return `### CODE
\`\`\`python
<the FULL updated self-contained program>
\`\`\`
### NOTES
<the COMPLETE notes file, rewritten. You are shown the current NOTES above: fold your findings into them, keep what still matters, and DELETE anything superseded, disproven, or now obvious. This REPLACES the file, so whatever you omit is gone. Organise it as '- **Topic:** ...' bullets, under ~800 words. Do NOT use markdown headings (#, ##), bold-only lines, or ALLCAPS: lines anywhere inside this section -- the reply is split on those, so they would truncate your notes.>
### NEXT
<bullet list of remaining steps, or 'none'>
### STATUS
<solved|continue>`;
}

export function workerSystem(solverSystem: string): string {
  return `You are a WORKER subagent, ${solverSystem} You share a workspace with the team. Build on the current work and notes where useful -- but if your task is to try a different approach, write a FRESH solution for that approach instead of patching the stuck one. Respond with EXACTLY these sections:
${workerOutputFormat()}`;
}

export interface WorkerUserInput {
  problem: string;
  plan: string;
  notes: string;
  current: string;
  goal: string;
}

export function workerUser(input: WorkerUserInput): string {
  return `PROBLEM:
${input.problem}

PLAN:
${input.plan}

NOTES:
${input.notes}

CURRENT WORK:
${input.current || '(none yet)'}

YOUR TASK: ${input.goal}`;
}

export const cutoffSystem = `A worker's solution attempt was CUT OFF when it hit the token limit. Summarize its partial attempt in 3-5 sentences: which approach it was pursuing, what it established or ruled out, how far it got, and what remained unfinished. Be concrete so another worker can resume or judge it. Do NOT try to finish the solution yourself.`;

export function cutoffUser(taskDesc: string, snippet: string): string {
  return `TASK: ${taskDesc}\n\nCUT-OFF ATTEMPT:\n${snippet}`;
}