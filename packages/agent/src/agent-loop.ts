import type { ResolvedSkill } from './skill-resolver.js';
import type { ToolResult } from './tool-types.js';
import type { AgentContext, AgentResult } from './agent-types.js';
import { logger } from './logger.js';
import { sanitizeForDb } from './utils.js';
import { executeTool } from './tools.js';
import { validatePatch } from './patch-utils.js';
import { sendToProvider, parseToolCalls, recordUsage } from './provider-client.js';
import {
  buildTaskPrompt,
  buildToolResultPrompt,
  type ToolResultEntry,
  generateAutoApiChecks,
  FORCE_ACTION_PROMPT,
} from './prompts.js';
import { hasChanges, stageAllChanges, commit, getDiff } from './git.js';
import { validateProject } from './validator.js';
import { publishOmega, type PublishResult } from './publisher.js';
import {
  isTypeScriptProject,
  looksLikeTestCommand,
  taskMentionsPublicApi,
  taskLikelyHasTests,
  toCoreTask,
} from './project-utils.js';
import { withProviderRetry } from './retry.js';
import { createPlan } from './planner.js';
import { isReadOnlyShellCommand, isFileReadingShellCommand } from './shell-patterns.js';
import { runTypeCheck } from './ts-runner.js';
import {
  addTrace,
  failTask,
  tryStuckSolve,
  reflectOnTrace,
  checkpointCommit,
  getModifiedTsFiles,
  applySkillPatches,
  runAutoApiChecks,
} from './agent-helpers.js';

export { failTask };

export async function executeAgentLoop(ctx: AgentContext, skills: ResolvedSkill[]): Promise<AgentResult> {
  await addTrace(ctx, 'system', ctx.systemPrompt);
  await addTrace(ctx, 'user', buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined));

  let stepIndex = 0;
  let finished = false;
  let success = false;
  let summary = '';
  let noActionCount = 0;
  let lastTurnHadFailure = false;
  let capWarningLevel = 0;
  let stuckTurnCount = 0;
  let forcedEditMode = false;
  let forcedEditModeSteps = 0;

  const messages: {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    tool_call_id?: string;
  }[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined) },
  ];

  const skillVerify = process.env.OMEGA_SKILL_VERIFY === 'true';
  const skillPatchResult = await applySkillPatches(ctx.projectPath, ctx.baseCommit, skills);
  const appliedSkills = skillPatchResult.applied;
  const skillPatch = skillPatchResult.patch;
  if (appliedSkills.length > 0) {
    await addTrace(
      ctx,
      'system',
      `Reference patch applied automatically from skill(s): ${appliedSkills.join(', ')}. Verify the changes with the skill's verification command, then finish if tests pass.`
    );
    messages.push({
      role: 'user',
      content:
        `IMPORTANT: The reference patch for this task has already been applied automatically from skill(s): ${appliedSkills.join(', ')}. ` +
        `Do NOT run \`git apply\` again. Skip directly to the skill's verification command, run it, and call finish with success=true if it passes. ` +
        `Only make further edits if the verification command fails.`
    });
    const trimPatchWorkflow = (text: string): string =>
      text.replace(
        /### ONE-SHOT PATCH WORKFLOW\s*[\s\S]*?(?=### Verification)/gi,
        '### Patch status\nThe reference patch has already been applied. Proceed directly to verification below.\n\n'
      );
    ctx.systemPrompt = trimPatchWorkflow(ctx.systemPrompt);
    if (ctx.promptContext) {
      ctx.promptContext = trimPatchWorkflow(ctx.promptContext);
    }
    if (messages[0]?.content) {
      messages[0].content = ctx.systemPrompt;
    }

    if (!skillVerify) {
      if (skillPatch) {
        success = true;
        finished = true;
        summary = `Finished via skill reference patch: ${appliedSkills.join(', ')}`;
        await checkpointCommit(ctx);
        await ctx.prisma.taskDiff.create({
          data: {
            taskId: ctx.task.id,
            branch: ctx.branch,
            patch: skillPatch,
          },
        });
        ctx.rootSpan.addEvent('agent.skill_oracle.finish', { skills: appliedSkills.join(', ') });
      } else {
        logger.warn('Skill patch reported applied but produced empty diff; falling back to agent loop', {
          taskId: ctx.task.id,
          skills: appliedSkills.join(', '),
        });
        ctx.rootSpan.addEvent('agent.skill_patch.empty_fallback', { skills: appliedSkills.join(', ') });
      }
    } else {
      ctx.rootSpan.addEvent('agent.skill_patch.applied', { skills: appliedSkills.join(', ') });
    }
  }

  if (!finished) {
    const planSpan = ctx.tracer.startSpan('agent.plan', ctx.rootSpan.toContext());
    const plan = await withProviderRetry('planner', () =>
      createPlan(
        ctx.provider,
        ctx.task.title,
        ctx.task.description ?? undefined,
        ctx.promptContext,
        (usage) => {
          recordUsage(ctx, usage);
        }
      ),
      ctx.signal,
      logger
    );
    planSpan.setAttributes({ planSteps: plan.plan.length });
    planSpan.addEvent('plan.created');
    await planSpan.end('ok');
    await addTrace(ctx, 'assistant', `Plan: ${JSON.stringify(plan)}`);
    messages.push({ role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` });
  }

  while (stepIndex < ctx.maxSteps && !finished) {
    if (Date.now() >= ctx.deadlineMs) {
      logger.warn('Agent wall-clock deadline exceeded', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
        deadlineMs: ctx.deadlineMs,
      });
      ctx.rootSpan.addEvent('deadline.exceeded', { stepIndex });
      summary = `Wall-clock deadline exceeded after ${String(stepIndex)} steps`;
      finished = true;
      break;
    }

    if (ctx.signal?.aborted) {
      logger.warn('Agent task externally aborted', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
      });
      ctx.rootSpan.addEvent('abort.external', { stepIndex });
      summary = 'Task externally aborted (timeout or cancellation)';
      finished = true;
      break;
    }

    if (
      ctx.tokenBudget !== undefined &&
      (ctx.usage.totalTokens ?? 0) > ctx.tokenBudget
    ) {
      logger.warn('Token budget exceeded, ending agent loop', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        tokenBudget: ctx.tokenBudget,
        used: ctx.usage.totalTokens,
      });
      ctx.rootSpan.addEvent('token_budget.exceeded', {
        budget: ctx.tokenBudget,
        used: ctx.usage.totalTokens,
      });
      summary = `Token budget exceeded: used ${String(ctx.usage.totalTokens)} of ${String(ctx.tokenBudget)}`;
      finished = true;
      break;
    }

    const nextCapLevel = stepIndex >= Math.floor(ctx.maxSteps * 0.9) ? 2 : stepIndex >= Math.floor(ctx.maxSteps * 0.75) ? 1 : 0;
    if (nextCapLevel > capWarningLevel) {
      capWarningLevel = nextCapLevel;
      const remaining = ctx.maxSteps - stepIndex;
      messages.push({
        role: 'user',
        content:
          `[budget notice] ${String(remaining)} steps remain. Focus: complete the core implementation, verify it compiles/tests, clean scratch files, then finish. No new exploration.`,
      });
    }

    const response = await sendToProvider(ctx, messages);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      noActionCount++;
      if (noActionCount >= 2) {
        const reflection = await withProviderRetry('reflection', () => reflectOnTrace(ctx, 8), ctx.signal, logger);
        messages.push({
          role: 'user',
          content: reflection ? `${FORCE_ACTION_PROMPT}\n\n${reflection}` : FORCE_ACTION_PROMPT,
        });
      } else {
        messages.push({
          role: 'user',
          content: 'No tool calls detected. Please respond with a JSON object containing tool_calls.',
        });
      }
      if (noActionCount >= 5) {
        logger.warn('Provider returned no tool calls repeatedly, ending agent loop', {
          taskId: ctx.task.id,
          agentRunId: ctx.agentRunId,
          noActionCount,
        });
        summary = 'Provider repeatedly returned no tool calls; agent loop ended.';
        finished = true;
        break;
      }
      continue;
    }
    noActionCount = 0;

    const toolCalls = parseToolCalls(response.toolCalls).map((c, i) => ({
      ...c,
      id: c.id && c.id.length > 0 ? c.id : `tool-${String(stepIndex)}-${String(i)}`,
    }));
    const assistantToolCalls = toolCalls.map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    }));
    messages.push({
      role: 'assistant',
      content: response.content ?? undefined,
      tool_calls: assistantToolCalls,
    });
    await addTrace(ctx, 'assistant', response.content ?? '', response.toolCalls);

    const toolResults: ToolResultEntry[] = [];
    let turnHadFailure = false;
    let turnForcedCount = 0;
    let turnToolCount = 0;
    const processedToolCallIds = new Set<string>();

    function rejectRemainingToolCalls(reason: string): void {
      for (const call of toolCalls) {
        if (!processedToolCallIds.has(call.id)) {
          const output = `Tool call rejected: ${reason}`;
          toolResults.push({ toolCallId: call.id, name: call.name, output, success: false });
          messages.push({ role: 'tool', tool_call_id: call.id, content: output });
          processedToolCallIds.add(call.id);
        }
      }
    }

    for (const call of toolCalls) {
      const input =
        call.name === 'run_command'
          ? (call.arguments.command as string | undefined)
          : call.name === 'read_file' || call.name === 'write_file' || call.name === 'edit_file'
            ? (call.arguments.path as string | undefined)
            : JSON.stringify(call.arguments);
      const step = await ctx.prisma.taskStep.create({
        data: {
          taskId: ctx.task.id,
          idx: stepIndex,
          name: call.name,
          status: 'pending',
          input: sanitizeForDb(input),
        },
      });
      const stepId = step.id;

      const rejectFinish = async (message: string): Promise<void> => {
        turnHadFailure = true;
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: { status: 'failed', output: sanitizeForDb(message) },
        });
        toolResults.push({ toolCallId: call.id, name: 'finish', output: message, success: false });
        messages.push({ role: 'tool', tool_call_id: call.id, content: message });
        processedToolCallIds.add(call.id);
        rejectRemainingToolCalls('finish was rejected');
      };

      if (call.name === 'finish') {
        const finishingWithFailure = call.arguments.success === false;
        const earlyFailure = finishingWithFailure && stepIndex < ctx.maxSteps - 5;
        if (earlyFailure) {
          await rejectFinish(
            `finish rejected: you are declaring failure too early (step ${String(stepIndex)} of ${String(ctx.maxSteps)}). Continue diagnosing and fixing the issue instead of giving up.`,
          );
          stepIndex++;
          break;
        }
        if (!ctx.hasRunTestCommand && taskLikelyHasTests(ctx.task, ctx.promptContext) && ctx.projectHasTests) {
          await rejectFinish(
            'finish rejected: this task has a test suite but you have not run any test command. Run the project\'s test command (e.g. npm test, pnpm test, pytest, go test ./..., cargo test) and fix any failures before finishing.',
          );
          stepIndex++;
          break;
        }
        const requiresApiCheck = taskMentionsPublicApi(ctx.task);
        if (requiresApiCheck && !ctx.apiSurfaceVerified) {
          await rejectFinish(
            'finish rejected: the task describes public API requirements. Call verify_api_surface first to confirm required methods/properties are exposed.',
          );
          break;
        }
        if (ctx.modifiedFiles.size > 0 || (await hasChanges(ctx.projectPath))) {
          const patchCheck = await validatePatch(ctx.projectPath, ctx.baseCommit);
          if (!patchCheck.success) {
            await rejectFinish(
              `finish rejected: the current changes do not form a clean patch. Run validate_patch to diagnose, then fix the diff before finishing. Details: ${patchCheck.output}`,
            );
            stepIndex++;
            break;
          }
        }

        const modifiedTsFiles = await getModifiedTsFiles(ctx);
        if (modifiedTsFiles.length > 0) {
          const typeCheck = await runTypeCheck(ctx.projectPath);
          if (!typeCheck.success) {
            await rejectFinish(
              `finish rejected: TypeScript typecheck failed after editing ${String(modifiedTsFiles.length)} file(s). Fix the type errors before finishing.\n\n${typeCheck.output}`,
            );
            stepIndex++;
            break;
          }
        }

        const skipValidation = ctx.task.tags.includes('skip-validation');
        const validation = skipValidation
          ? { lint: { passed: true, output: '' }, test: { passed: true, output: '' }, build: { passed: true, output: '' }, allPassed: true }
          : await validateProject(ctx.projectPath);
        const validationSpan = ctx.tracer.startSpan('agent.validate', ctx.rootSpan.toContext());
        await ctx.prisma.agentRun.update({
          where: { id: ctx.agentRunId },
          data: { validationSummary: sanitizeForDb(JSON.stringify(validation)) },
        });
        validationSpan.setAttributes({ allPassed: validation.allPassed });
        await validationSpan.end(validation.allPassed ? 'ok' : 'error');
        if (!validation.allPassed) {
          const failures = [
            !validation.lint.passed ? `lint failed:\n${validation.lint.output}` : '',
            !validation.test.passed ? `test failed:\n${validation.test.output}` : '',
            !validation.build.passed ? `build failed:\n${validation.build.output}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          await rejectFinish(`finish rejected: project validation did not pass. Fix the failures and try again.\n\n${failures}`);
          break;
        }

        const autoChecks = generateAutoApiChecks(ctx.task.description);
        if (autoChecks.length > 0) {
          const checkResult = await runAutoApiChecks(ctx.projectPath, autoChecks);
          if (!checkResult.success) {
            await rejectFinish(`finish rejected: automatic API surface check failed. ${checkResult.output}`);
            break;
          }
        }
        finished = true;
        const successArg = call.arguments.success;
        success =
          typeof successArg === 'string'
            ? successArg.trim().toLowerCase() !== 'false'
            : successArg === undefined
              ? true
              : Boolean(successArg);
        const summaryArg =
          typeof call.arguments.summary === 'string'
            ? call.arguments.summary
            : typeof call.arguments.message === 'string'
              ? call.arguments.message
              : '';
        summary = summaryArg;
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: { status: success ? 'done' : 'failed', output: sanitizeForDb(summary) },
        });
        ctx.rootSpan.addEvent('agent.finish', { success, summary });
        toolResults.push({ toolCallId: call.id, name: 'finish', output: summary, success });
        messages.push({ role: 'tool', tool_call_id: call.id, content: summary });
        break;
      }

      if (call.name === 'publish') {
        const publishSpan = ctx.tracer.startSpan('agent.publish', ctx.rootSpan.toContext());
        const skipValidation = ctx.task.tags.includes('skip-validation');
        const validation = skipValidation
          ? { lint: { passed: true, output: '' }, test: { passed: true, output: '' }, build: { passed: true, output: '' }, allPassed: true }
          : await validateProject(ctx.projectPath);
        await ctx.prisma.agentRun.update({
          where: { id: ctx.agentRunId },
          data: { validationSummary: sanitizeForDb(JSON.stringify(validation)) },
        });
        publishSpan.setAttributes({ allPassed: validation.allPassed });

        let publishResult: PublishResult | undefined;
        if (ctx.autoPublish && validation.allPassed) {
          publishSpan.addEvent('agent.publish.start');
          publishResult = await publishOmega(ctx.projectPath, call.arguments.version as string | undefined);
          publishSpan.setAttributes({ publishedVersion: publishResult.version ?? 'none' });
        }
        await publishSpan.end(validation.allPassed ? 'ok' : 'error');

        const output = JSON.stringify({ validation, publish: publishResult });
        toolResults.push({ toolCallId: call.id, name: 'publish', output, success: validation.allPassed });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        processedToolCallIds.add(call.id);
        await ctx.prisma.taskStep.update({
          where: { id: stepId },
          data: {
            status: validation.allPassed ? 'done' : 'failed',
            output: sanitizeForDb(output),
          },
        });
        if (!validation.allPassed) {
          finished = true;
          success = false;
          summary = 'Validation failed';
        }
        rejectRemainingToolCalls('publish completed');
        break;
      }

      const explorationTools = ['think', 'read_file', 'list_files', 'search', 'run_command', 'lsp_diagnostics', 'lsp_hover', 'lsp_symbol'];
      const editTools = ['edit_file', 'write_file', 'edit_lines', 'apply_patch'];
      const isTestCommand =
        call.name === 'run_command' &&
        typeof call.arguments.command === 'string' &&
        looksLikeTestCommand(call.arguments.command);
      const isPatchCommand =
        call.name === 'run_command' &&
        typeof call.arguments.command === 'string' &&
        /\bgit\s+apply\b|\bpatch\s+[-p]/.test(call.arguments.command);
      const isExploration = explorationTools.includes(call.name) && !isTestCommand && !isPatchCommand;
      const isEdit = editTools.includes(call.name) || isPatchCommand;
      if (isExploration) {
        ctx.explorationCount++;
        ctx.explorationSinceLastEdit++;
      }
      if (isEdit) {
        ctx.editCount++;
        ctx.explorationAtLastEdit = ctx.explorationCount;
        if (ctx.editCount % 5 === 0) {
          await checkpointCommit(ctx);
        }
      }

      const toolSpan = ctx.tracer.startSpan(`agent.tool.${call.name}`, ctx.rootSpan.toContext());
      toolSpan.setAttributes({ tool: call.name });

      if (isTestCommand) {
        ctx.hasRunTestCommand = true;
      }

      let result: ToolResult;
      turnToolCount++;
      const stuckWithoutEdits =
        ctx.editCount === 0 &&
        ctx.explorationCount >= ctx.explorationBudget.beforeFirstEdit * 2 &&
        !editTools.includes(call.name) &&
        call.name !== 'finish' &&
        call.name !== 'publish';
      if (stuckWithoutEdits) turnForcedCount++;
      const wanderingTooLong =
        ctx.editCount > 0 &&
        ctx.explorationSinceLastEdit >= ctx.explorationBudget.betweenEdits &&
        isExploration;
      if (wanderingTooLong) turnForcedCount++;
      const explorationBudgetExhausted =
        ctx.editCount === 0 && ctx.explorationCount > ctx.explorationBudget.beforeFirstEdit && isExploration;
      const wanderingAfterEdits =
        ctx.editCount > 0 && ctx.explorationCount - ctx.explorationAtLastEdit > ctx.explorationBudget.betweenEdits && isExploration;
      const budgetAdvisory =
        !forcedEditMode && (explorationBudgetExhausted || wanderingAfterEdits || stuckWithoutEdits || wanderingTooLong);

      const allowedInForcedMode = new Set(['edit_file', 'write_file', 'edit_lines', 'apply_patch', 'read_file', 'search', 'think']);
      if (stuckWithoutEdits && !forcedEditMode) {
        const solved = await tryStuckSolve(ctx);
        if (solved) {
          ctx.editCount++;
          ctx.explorationAtLastEdit = ctx.explorationCount;
          ctx.explorationSinceLastEdit = 0;
          result = {
            success: true,
            output: 'Stuck-solver applied a draft patch to break the exploration loop. Review the change, then run the project build/test command and fix any issues.',
          };
          toolResults.push({ toolCallId: call.id, name: call.name, output: result.output, success: result.success });
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
          processedToolCallIds.add(call.id);
          await addTrace(ctx, 'tool', result.output, undefined, stepId);
          await ctx.prisma.taskStep.update({
            where: { id: stepId },
            data: { status: 'done', output: sanitizeForDb(result.output) },
          });
          await toolSpan.end('ok');
          stepIndex++;
          continue;
        }
      }
      if (forcedEditMode && !allowedInForcedMode.has(call.name) && !isPatchCommand) {
        result = {
          success: false,
          output: 'EDIT-FIRST MODE: you have explored too long without editing. read_file, search, and think are still allowed, but run_command, list_files, code_overview, lsp_*, finish, publish, validate_patch, and verify_api_surface are rejected until you make a concrete source change. Make an edit now (use edit_file, edit_lines, apply_patch, or write_file for a new file).',
        };
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string' && isReadOnlyShellCommand(call.arguments.command)) {
        result = {
          success: false,
          output: `Shell inspection command rejected: use read_file, search, or list_files instead of \`${call.arguments.command}\`.`,
        };
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string' && isFileReadingShellCommand(call.arguments.command)) {
        result = {
          success: false,
          output: `Shell file-reading command rejected: use read_file, search, or list_files instead of \`${call.arguments.command}\`.`,
        };
      } else if (call.name === 'think') {
        ctx.consecutiveThinks++;
        if (ctx.consecutiveThinks > 2) {
          result = {
            success: false,
            output: `Think rejected: you have already thought ${String(ctx.consecutiveThinks - 1)} times in a row. Stop planning and execute the next concrete step using read_file, run_command, or edit_file.`,
          };
        } else {
          result = await executeTool(ctx.projectPath, call.name, call.arguments);
        }
      } else if (call.name === 'read_file' && typeof call.arguments.path === 'string') {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      } else if (call.name === 'run_command' && typeof call.arguments.command === 'string') {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      } else {
        ctx.consecutiveThinks = 0;
        result = await executeTool(ctx.projectPath, call.name, call.arguments);
      }

      if (budgetAdvisory && result.success) {
        const sinceEdit = ctx.explorationCount - ctx.explorationAtLastEdit;
        const strong = stuckWithoutEdits || wanderingTooLong;
        const notice = strong
          ? `\n[EDIT-FIRST ADVISORY] You have used ${String(ctx.explorationCount)} exploration steps and made ${String(ctx.editCount)} edits (${String(sinceEdit)} since your last edit). Treat this as an instruction, not a tool failure: make the smallest edit_file/edit_lines/apply_patch change now, even if partial, then run the project's build/test command.`
          : `\n[budget notice] ${String(sinceEdit)} exploration steps since your last edit. Make a concrete edit or run the focused tests next — do not re-read files you already know.`;
        result = {
          success: true,
          output: `${result.output}${notice}`,
        };
      }

      const TOOL_OUTPUT_LIMIT = 6_000;
      const displayOutput =
        result.output.length > TOOL_OUTPUT_LIMIT
          ? `${result.output.slice(0, TOOL_OUTPUT_LIMIT)}\n... [truncated]`
          : result.output;

      if (call.name === 'write_file' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'edit_file' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'edit_lines' && typeof call.arguments.path === 'string') {
        ctx.modifiedFiles.add(call.arguments.path);
      }
      if (call.name === 'apply_patch' && result.success) {
        ctx.modifiedFiles.add('(patch)');
      }

      toolSpan.setAttributes({
        success: result.success,
        outputLength: result.output.length,
        ...(result.success
          ? {}
          : { error: result.output.slice(0, 500) }),
      });
      if (call.name === 'verify_api_surface' && result.success) {
        ctx.apiSurfaceVerified = true;
      }
      logger.info(`Tool ${call.name} executed`, {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        traceId: ctx.tracer.traceId,
        spanId: toolSpan.spanId,
        tool: call.name,
        success: result.success,
      });
      await toolSpan.end(result.success ? 'ok' : 'error');
      if (!result.success) {
        turnHadFailure = true;
      }
      if (isEdit && result.success) {
        forcedEditMode = false;
        forcedEditModeSteps = 0;
        ctx.explorationSinceLastEdit = 0;

        if (await isTypeScriptProject(ctx.projectPath)) {
          const typeCheck = await runTypeCheck(ctx.projectPath);
          if (!typeCheck.success) {
            result = {
              success: false,
              output: `TypeScript typecheck failed after this edit. Fix the type errors before continuing.\n\n${typeCheck.output}`,
            };
            turnHadFailure = true;
          }
        }
      }
      await ctx.prisma.taskStep.update({
        where: { id: stepId },
        data: {
          status: result.success ? 'done' : 'failed',
          output: sanitizeForDb(result.output),
          error: sanitizeForDb(result.success ? null : result.output),
        },
      });
      await addTrace(ctx, 'tool', result.output, undefined, stepId);
      toolResults.push({ toolCallId: call.id, name: call.name, output: displayOutput, success: result.success });
      messages.push({ role: 'tool', tool_call_id: call.id, content: displayOutput });
      processedToolCallIds.add(call.id);
      stepIndex++;

      if (forcedEditMode) {
        forcedEditModeSteps++;
        if (forcedEditModeSteps > ctx.explorationBudget.beforeFirstEdit * 2) {
          logger.warn('Agent refused to edit in forced edit mode; ending task', {
            taskId: ctx.task.id,
            agentRunId: ctx.agentRunId,
            forcedEditModeSteps,
          });
          summary = 'Agent refused to make a concrete edit after repeated prompting.';
          finished = true;
          success = false;
          break;
        }
      }
    }

    const turnAllForced = turnToolCount > 0 && turnForcedCount === turnToolCount;
    if (turnAllForced) {
      stuckTurnCount++;
    } else {
      stuckTurnCount = 0;
    }
    if (stuckTurnCount >= 2 && !finished) {
      logger.warn('Agent stuck in exploration loop; resetting conversation to force an edit', {
        taskId: ctx.task.id,
        agentRunId: ctx.agentRunId,
        stepIndex,
        explorationCount: ctx.explorationCount,
      });
      ctx.explorationCount = 0;
      ctx.explorationAtLastEdit = 0;
      ctx.explorationSinceLastEdit = 0;
      ctx.consecutiveThinks = 0;
      stuckTurnCount = 0;
      forcedEditMode = true;
      forcedEditModeSteps = 0;
      messages.length = 0;
      messages.push({ role: 'system', content: ctx.systemPrompt });
      messages.push({ role: 'user', content: buildTaskPrompt(ctx.task.title, ctx.task.description ?? undefined) });
      messages.push({
        role: 'user',
        content:
          `[ACTION REQUIRED] You have explored long enough without editing. ` +
          `You are now in FORCED EDIT MODE. Only read_file, search, and edit_file are accepted. ` +
          `All other tools (write_file, run_command, list_files, code_overview, think, lsp_*) will be rejected until you make a concrete edit. ` +
          `Choose the most relevant source file, read the exact lines you need, and make the smallest edit_file change that advances the task. ` +
          `Do not explain. Do not ask for clarification. Edit now.`,
      });
    }

    const shouldReflect = turnHadFailure || lastTurnHadFailure;
    lastTurnHadFailure = turnHadFailure;

    let nextPrompt = buildToolResultPrompt(ctx.task, toolResults);
    if (shouldReflect && !finished) {
      nextPrompt =
        'One or more tools failed in the last turn. Diagnose the failure from the tool results below, then respond with the single next concrete action (read_file, edit_file, run_command, etc.). Do not just think or explain; execute the next step.\n\n' +
        nextPrompt;
    }

    if (!finished) {
      messages.push({ role: 'user', content: nextPrompt });
    }
  }

  if (ctx.modifiedFiles.size > 0 || (await hasChanges(ctx.projectPath))) {
    await stageAllChanges(ctx.projectPath);
    await commit(ctx.projectPath, `agent: ${ctx.task.title}`, true);
  }
  const diff = await getDiff(ctx.projectPath, ctx.baseCommit);
  if (diff.output) {
    await ctx.prisma.taskDiff.create({
      data: {
        taskId: ctx.task.id,
        branch: ctx.branch,
        patch: diff.output,
      },
    });
  }

  const updatedTask = await ctx.prisma.task.update({
    where: { id: ctx.task.id },
    data: {
      status: success ? 'done' : 'failed',
      result: sanitizeForDb(summary),
      error: sanitizeForDb(success ? null : summary),
      provider: ctx.provider.config.name,
      model: ctx.model,
    },
  });

  await ctx.prisma.agentRun.update({
    where: { id: ctx.agentRunId },
    data: {
      resultStatus: success ? 'done' : 'failed',
      promptTokens: ctx.usage.promptTokens,
      completionTokens: ctx.usage.completionTokens,
      totalTokens: ctx.usage.totalTokens,
    },
  });

  return {
    task: toCoreTask(updatedTask),
    agentRunId: ctx.agentRunId,
  };
}
