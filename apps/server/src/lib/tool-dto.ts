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

/**
 * What a redacted payload field says instead of what it held. A visible marker,
 * not a silent `null`: a caller that cannot see the output should be told the
 * output exists and why it is hidden, so the Toolkit can degrade honestly
 * rather than look like a tool that printed nothing.
 */
export const TOOL_REDACTION_MARKER = '«secret required»';

/**
 * Everything a tool's wire shape carries that is PAYLOAD rather than workflow:
 * the command text, and whatever the command printed. Names, groups, statuses,
 * timings and permission ids stay visible when redacted — they are how the
 * Toolkit stays legible, and they are not what a tool leaks.
 */
function redactString(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return value ?? null;
  return TOOL_REDACTION_MARKER;
}

export function serializeTool(
  tool: HarnessTool,
  lastRun?: HarnessToolRun | null,
  options: { redactPayload?: boolean } = {},
): Record<string, unknown> {
  const redact = options.redactPayload === true;
  return {
    ...tool,
    command: redact ? redactString(tool.command) : tool.command,
    group: tool.groupName,
    // Whether this tool can execute at all, so the UI can say "records only"
    // without having to know about the feature flag. Computed from the REAL
    // command, so redaction does not turn an executable tool into a dead one.
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
          output: redact ? redactString(lastRun.output) : lastRun.output,
          createdAt: lastRun.createdAt,
        }
      : null,
  };
}
