import type { HarnessTool, HarnessToolRun } from '@omega/db';

/**
 * The wire shape of a tool. Shared by the read routes and the run mutation so
 * a tool never looks different depending on which one produced it.
 */
export function toolTone(status: string | null): 'ok' | 'fail' | 'warn' | 'idle' {
  if (status === 'fail') return 'fail';
  if (status === 'warn' || status === 'blocked') return 'warn';
  if (status === 'ok') return 'ok';
  return 'idle';
}

export function serializeTool(
  tool: HarnessTool,
  lastRun?: HarnessToolRun | null,
): Record<string, unknown> {
  return {
    ...tool,
    group: tool.groupName,
    // Whether this tool can execute at all, so the UI can say "records only"
    // without having to know about the feature flag.
    executable: (tool.command?.trim().length ?? 0) > 0,
    lastResult: tool.lastStatus || tool.lastResultLabel
      ? {
          label: tool.lastResultLabel ?? tool.lastStatus ?? 'No result',
          tone: toolTone(tool.lastStatus),
        }
      : null,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          exitCode: lastRun.exitCode,
          durationMs: lastRun.durationMs,
          cwd: lastRun.cwd,
          permissionId: lastRun.permissionId,
          interventionId: lastRun.interventionId,
          output: lastRun.output,
          createdAt: lastRun.createdAt,
        }
      : null,
  };
}
