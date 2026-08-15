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
    void onRun(tool)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setRunning(null); });
  };

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
                        tool.needsApproval
                          ? 'text-warn'
                          : RESULT_TONE[tool.lastResult?.tone ?? 'idle']
                      }`}
                    >
                      {running === tool.id
                        ? 'running…'
                        : tool.needsApproval
                          ? 'needs approval'
                          : tool.lastResult
                            ? tool.lastResult.label
                            : 'idle'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
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
