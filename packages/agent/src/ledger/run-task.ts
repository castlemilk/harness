import path from 'node:path';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { estimateCostUsd, omegaWorkDir, type ProviderConfig } from '@omega/core';
import { createProvider } from '@omega/providers';
import type { PrismaClient } from '@omega/db';
import { runLedgerLoop } from './loop.js';
import { DEFAULT_SOLVER_SYSTEM } from './prompts.js';
import type { LedgerCallRecord, LedgerSend, LedgerUsage } from './types.js';

export interface LedgerTaskOptions {
  maxIters?: number;
  maxOutputTokens?: number;
  provider?: string;
  model?: string;
  freshPerspective?: boolean;
}

/**
 * Runs a harness task through the ledger manager-worker scaffold instead of
 * the tool-using agent loop. The task description is the problem statement and
 * the workspace lives under ${OMEGA_STORAGE_ROOT}/work/orchestrations/<taskId>.
 */
export async function runLedgerTask(
  prisma: PrismaClient,
  taskId: string,
  options: LedgerTaskOptions = {}
): Promise<{ status: string; taskId: string; solution: string; calls: LedgerCallRecord[] }> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const configs = await prisma.providerConfig.findMany();
  const coreConfigs: ProviderConfig[] = configs.map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    kind: cfg.kind as ProviderConfig['kind'],
    baseUrl: cfg.baseUrl ?? undefined,
    apiKey: cfg.apiKey ?? undefined,
    refreshToken: cfg.refreshToken ?? undefined,
    tokenExpiresAt: cfg.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: cfg.defaultModel,
    capabilities: JSON.parse(cfg.capabilities) as ProviderConfig['capabilities'],
    enabled: cfg.enabled,
    defaultCacheMode: cfg.defaultCacheMode as ProviderConfig['defaultCacheMode'] ?? undefined,
    defaultWarmupRuns: cfg.defaultWarmupRuns ?? undefined,
    defaultContextTokens: cfg.defaultContextTokens ?? undefined,
  }));

  const providerName = options.provider ?? task.provider ?? undefined;
  const selected =
    (providerName ? coreConfigs.find((cfg) => cfg.name === providerName) : undefined) ??
    coreConfigs.find((cfg) => cfg.enabled);
  if (!selected) {
    const reason = 'Ledger scaffold stopped before its first model turn: no provider is available.';
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: reason, result: reason } });
    throw new Error(reason);
  }
  const model = options.model ?? task.model ?? selected.defaultModel;
  const provider = createProvider(selected);

  const usageTotals: LedgerUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const knownCosts: number[] = [];

  const tracer = trace.getTracer('omega-ledger', '0.1.0');
  const taskSpan = tracer.startSpan('ledger.task', {
    attributes: { 'ledger.task_id': task.id, 'ledger.model': model, 'ledger.provider': selected.name },
  });

  const send: LedgerSend = async (request) => {
    const callSpan = tracer.startSpan(
      `ledger.${request.role}`,
      {
        attributes: {
          'ledger.role': request.role,
          'ledger.temperature': request.temperature,
          'ledger.max_output_tokens': request.maxOutputTokens ?? options.maxOutputTokens ?? 0,
        },
      },
      trace.setSpan(context.active(), taskSpan)
    );
    let finishReason: string | undefined;
    let usage: LedgerUsage | undefined;
    try {
      return await context.with(trace.setSpan(context.active(), callSpan), async () => {
        const text = await provider.send(request.user, {
          system: request.system,
          model,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens ?? options.maxOutputTokens,
          thinking: false,
          onFinishReason: (reason, reportedUsage) => {
            finishReason = reason;
            if (reportedUsage) usage = reportedUsage;
          },
          onUsage: (reportedUsage) => {
            usage = reportedUsage;
          },
        });
        const callCost = usage ? estimateCostUsd(model, usage) : null;
        if (callCost !== null) knownCosts.push(callCost);
        callSpan.setAttributes({
          'ledger.finish_reason': finishReason ?? 'unknown',
          'ledger.truncated': finishReason === 'length',
          'ledger.prompt_tokens': usage?.promptTokens ?? 0,
          'ledger.completion_tokens': usage?.completionTokens ?? 0,
          'ledger.cost_usd': callCost ?? 0,
        });
        return { text, finishReason, usage, costUsd: callCost ?? undefined };
      });
    } catch (err) {
      callSpan.recordException(err instanceof Error ? err : String(err));
      callSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      callSpan.end();
    }
  };

  const workspaceDir = path.join(omegaWorkDir(), 'orchestrations', task.id);
  const statement = [task.title, task.description].filter(Boolean).join('\n\n');
  const startedAt = Date.now();

  try {
    const result = await runLedgerLoop(
      send,
      { id: task.id, statement, tests: [] },
      { kind: 'code', solverSystem: DEFAULT_SOLVER_SYSTEM },
      { workspaceDir, maxIters: options.maxIters, maxOutputTokens: options.maxOutputTokens, freshPerspective: options.freshPerspective }
    );

    for (const call of result.calls) {
      usageTotals.promptTokens = (usageTotals.promptTokens ?? 0) + (call.usage?.promptTokens ?? 0);
      usageTotals.completionTokens = (usageTotals.completionTokens ?? 0) + (call.usage?.completionTokens ?? 0);
      usageTotals.totalTokens = (usageTotals.totalTokens ?? 0) + (call.usage?.totalTokens ?? 0);
    }

    const costUsd =
      knownCosts.length > 0 ? knownCosts.reduce((sum, value) => sum + value, 0) : null;
    const failed = result.solution.trim().length === 0;
    const summary = JSON.stringify({
      mode: 'ledger',
      status: result.status,
      calls: result.calls.length,
      truncatedCalls: result.truncatedCalls,
      usage: usageTotals,
      costUsd,
      workspace: workspaceDir,
    });

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: failed ? 'failed' : 'done',
        result: summary,
        error: failed ? `Ledger scaffold finished with status ${result.status} and no solution.` : null,
        provider: selected.name,
        model,
      },
    });

    await prisma.taskStep.create({
      data: {
        taskId,
        idx: 0,
        name: 'ledger.loop',
        status: failed ? 'failed' : 'done',
        input: JSON.stringify({ maxIters: options.maxIters ?? 10, maxOutputTokens: options.maxOutputTokens ?? null }),
        output: summary,
      },
    });
    await prisma.taskTrace.create({
      data: {
        taskId,
        role: 'assistant',
        content: `Ledger scaffold finished: ${result.status}, ${String(result.calls.length)} calls ` +
          `(${String(result.truncatedCalls)} truncated) in ${String(Math.round((Date.now() - startedAt) / 1000))}s.`,
      },
    });
    await prisma.agentRun.create({
      data: {
        taskId,
        branch: `ledger/${task.id}`,
        baseCommit: 'ledger',
        resultStatus: failed ? 'failed' : 'done',
        promptTokens: usageTotals.promptTokens ?? 0,
        completionTokens: usageTotals.completionTokens ?? 0,
        totalTokens: usageTotals.totalTokens ?? 0,
        costUsd,
        turnCount: result.calls.length,
        effectiveModel: model,
      },
    });

    // Persist a span per call so the existing trace views (and Tempo, when the
    // OTel SDK is active) show the ledger's role timeline.
    taskSpan.setAttributes({
      'ledger.status': result.status,
      'ledger.calls': result.calls.length,
      'ledger.truncated_calls': result.truncatedCalls,
      'ledger.completion_tokens': usageTotals.completionTokens ?? 0,
      'ledger.cost_usd': costUsd ?? 0,
    });
    taskSpan.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    taskSpan.end();

    const traceId = `ledger-${task.id}`;
    const rootSpanId = 'ledger-root';
    const finishedAt = Date.now();
    await prisma.traceSpan.create({
      data: {
        traceId,
        spanId: rootSpanId,
        parentId: null,
        taskId,
        name: 'ledger.task',
        startTime: new Date(startedAt),
        endTime: new Date(finishedAt),
        status: failed ? 'error' : 'ok',
        attributes: JSON.stringify({
          status: result.status,
          calls: result.calls.length,
          truncatedCalls: result.truncatedCalls,
          usage: usageTotals,
          costUsd,
          provider: selected.name,
          model,
          workspace: workspaceDir,
        }),
        events: JSON.stringify([]),
      },
    });
    for (const [index, call] of result.calls.entries()) {
      const callStart = new Date(call.startedAt ?? startedAt);
      const callEnd = new Date((call.startedAt ?? startedAt) + (call.durationMs ?? 0));
      await prisma.traceSpan.create({
        data: {
          traceId,
          spanId: `ledger-${String(index + 1).padStart(3, '0')}`,
          parentId: rootSpanId,
          taskId,
          name: `ledger.${call.role}`,
          startTime: callStart,
          endTime: callEnd,
          status: call.finishReason === 'error' ? 'error' : 'ok',
          attributes: JSON.stringify({
            role: call.role,
            temperature: call.request.temperature,
            finishReason: call.finishReason ?? null,
            truncated: call.truncated,
            promptTokens: call.usage?.promptTokens ?? 0,
            completionTokens: call.usage?.completionTokens ?? 0,
            costUsd: call.costUsd ?? null,
            responseChars: call.response.length,
          }),
          events: JSON.stringify([]),
        },
      });
    }

    return { status: updated.status, taskId, solution: result.solution, calls: result.calls };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    taskSpan.recordException(err instanceof Error ? err : String(err));
    taskSpan.setStatus({ code: SpanStatusCode.ERROR, message });
    taskSpan.end();
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: message, result: message } });
    throw err;
  }
}
