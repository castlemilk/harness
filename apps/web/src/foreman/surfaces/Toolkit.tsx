import { useMemo, useState } from 'react';
import type { Tool } from '../types.js';
import { Modal } from '../ui/Modal.js';
import { SectionLabel } from '../ui/primitives.js';

/**
 * Surface 1i — Toolkit.
 *
 * The actions a harness may run, each carrying the result of the last time it
 * ran, so the panel doubles as a health readout rather than a menu.
 */

const RESULT_TONE: Record<string, string> = {
  ok: 'text-ok-tint',
  fail: 'text-danger',
  warn: 'text-warn',
  idle: 'text-faint',
};

export function Toolkit({
  open,
  onClose,
  harnessName,
  tools,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  harnessName: string;
  tools: Tool[];
  onRun: (tool: Tool) => Promise<void>;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The tool this session last fired, so its result can be shown in full
  // rather than squeezed into a one-line label.
  const [lastRanId, setLastRanId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Tool[]>();
    for (const t of tools) {
      const list = map.get(t.group);
      if (list) list.push(t);
      else map.set(t.group, [t]);
    }
    return [...map.entries()];
  }, [tools]);

  const run = (tool: Tool) => {
    setRunning(tool.id);
    setError(null);
    setLastRanId(tool.id);
    void onRun(tool)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setRunning(null); });
  };

  const lastRan = lastRanId === null ? null : tools.find((t) => t.id === lastRanId) ?? null;
  const detail = lastRan?.lastRun ?? null;

  return (
    <Modal open={open} onClose={onClose} width={380} label={`Toolkit for ${harnessName}`}>
      <div className="px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[13px] font-semibold">Toolkit</span>
          <span className="font-mono text-[10px] text-muted">{harnessName}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-muted hover:text-ink"
          >
            esc
          </button>
        </div>

        {groups.length === 0 ? (
          <p className="m-0 text-[11.5px] text-muted">
            No tools are configured for this harness.
          </p>
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className="mb-3.5">
              <SectionLabel className="mb-2">{group}</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    disabled={running === tool.id}
                    onClick={() => { run(tool); }}
                    className={`rounded-md border bg-card px-2.5 py-2 text-left transition-colors hover:border-edge disabled:opacity-50 ${
                      tool.needsApproval ? 'border-danger/25' : 'border-line'
                    }`}
                  >
                    <div className="text-[11px] font-medium">▷ {tool.name}</div>
                    <div
                      className={`mt-1 font-mono text-[8.5px] ${
                        RESULT_TONE[
                          tool.lastResult?.tone ?? (tool.needsApproval ? 'warn' : 'idle')
                        ]
                      }`}
                      title={tool.command ?? undefined}
                    >
                      {running === tool.id
                        ? 'running…'
                        : tool.lastResult
                          ? tool.lastResult.label
                          : tool.needsApproval
                            ? 'needs approval'
                            : tool.executable === false
                              ? 'records only'
                              : 'idle'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {lastRan && detail && (
          <div className="mt-3 rounded-md border border-line bg-card px-3 py-2.5">
            <div className="flex items-center gap-2 font-mono text-[9.5px] text-muted">
              <span className={RESULT_TONE[lastRan.lastResult?.tone ?? 'idle']}>
                {lastRan.name} · {detail.status}
              </span>
              <div className="flex-1" />
              {detail.exitCode !== null && <span>exit {detail.exitCode}</span>}
              {detail.durationMs !== null && <span>{detail.durationMs}ms</span>}
            </div>
            {lastRan.command && (
              <div className="mt-1.5 truncate font-mono text-[9.5px] text-faint" title={lastRan.command}>
                $ {lastRan.command}
              </div>
            )}
            {detail.cwd && (
              <div className="truncate font-mono text-[9px] text-faint" title={detail.cwd}>
                in {detail.cwd}
              </div>
            )}
            {detail.status === 'blocked-pending-approval' && (
              <div className="mt-1.5 text-[11px] text-warn">
                Blocked — an approval is waiting for you in Needs you.
              </div>
            )}
            {detail.output && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-panel px-2 py-1.5 font-mono text-[9.5px] leading-[1.6] text-ink3">
                {detail.output}
              </pre>
            )}
            <div className="mt-1.5 font-mono text-[9px] text-faint">
              {detail.status === 'blocked-pending-approval'
                ? `needs permission ${detail.permissionId ?? '—'}`
                : detail.permissionId
                  ? `authorised by permission ${detail.permissionId}`
                  : detail.interventionId
                    ? `authorised by approval ${detail.interventionId.slice(0, 8)}`
                    : 'nothing ran — nothing was authorised'}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger-tint">
            {error}
          </div>
        )}

        <div className="mt-3 rounded-md border border-dashed border-strong px-3 py-2.5 font-mono text-[10px] text-faint">
          + add a tool — shell, HTTP, or another harness
        </div>
      </div>
    </Modal>
  );
}
