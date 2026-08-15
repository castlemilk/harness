import { useEffect, useMemo, useState } from 'react';
import type { Harness, Playbook, RoutineStep } from '../types.js';
import { Button, SectionLabel } from '../ui/primitives.js';

/**
 * Surface 1j — Playbook editor.
 *
 * Left is the routine as written; right is what a specific child actually
 * receives once its variables are resolved. Saving cuts a new version, which
 * is why the right-hand rail warns how many live harnesses it will reach.
 */
export function PlaybookEditor({
  playbooks,
  selectedId,
  onSelect,
  harnesses,
  onSave,
}: {
  playbooks: Playbook[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  harnesses: Harness[];
  onSave: (
    id: string,
    body: {
      steps: { index: number; text: string; condition: string | null }[];
      variables: string[];
      cadence: string;
      retireWhen: string;
    },
  ) => Promise<void>;
}) {
  const playbook = playbooks.find((p) => p.id === selectedId) ?? playbooks.at(0) ?? null;

  const [steps, setSteps] = useState<RoutineStep[]>([]);
  const [variables, setVariables] = useState<string[]>([]);
  const [cadence, setCadence] = useState('');
  const [retireWhen, setRetireWhen] = useState('');
  const [resolveFor, setResolveFor] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playbook) return;
    setSteps(playbook.steps);
    setVariables(playbook.variables);
    setCadence(playbook.cadence);
    setRetireWhen(playbook.retireWhen);
    setError(null);
  }, [playbook]);

  // Users of this playbook are the only sensible preview subjects.
  const users = useMemo(
    () => harnesses.filter((h) => h.playbookId === playbook?.id),
    [harnesses, playbook?.id],
  );

  useEffect(() => {
    setResolveFor((current) =>
      current && users.some((u) => u.id === current) ? current : (users.at(0)?.id ?? ''),
    );
  }, [users]);

  if (!playbook) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
        No playbooks yet.
      </div>
    );
  }

  const subject = users.find((u) => u.id === resolveFor) ?? null;

  const dirty =
    cadence !== playbook.cadence ||
    retireWhen !== playbook.retireWhen ||
    variables.join('\u0000') !== playbook.variables.join('\u0000') ||
    steps.map((s) => s.text).join('\u0000') !==
      playbook.steps.map((s) => s.text).join('\u0000');

  const save = () => {
    setSaving(true);
    setError(null);
    void onSave(playbook.id, {
      steps: steps.map((s, i) => ({ index: i + 1, text: s.text, condition: s.condition })),
      variables,
      cadence,
      retireWhen,
    })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setSaving(false); });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSteps(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas text-ink">
      <div className="flex flex-none items-center gap-3 border-b border-line px-[18px] py-3.5">
        <div>
          <h3 className="m-0 text-[15px] font-semibold">{playbook.name}</h3>
          <div className="mt-1 font-mono text-[9.5px] text-muted">
            playbook · v{playbook.version} · used by {playbook.usedByCount} live harnesses
          </div>
        </div>
        {playbooks.length > 1 && (
          <select
            value={playbook.id}
            onChange={(e) => {
              if (dirty && !window.confirm('Discard unsaved changes to this playbook?')) {
                return;
              }
              onSelect(e.target.value);
            }}
            className="ml-2 cursor-pointer rounded-md border border-line bg-control px-2 py-1 text-[11px] text-ink2 outline-none"
          >
            {playbooks.map((p) => (
              <option key={p.id} value={p.id} className="bg-control">
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <Button tone="accent" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save v${String(playbook.version + 1)}`}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto border-r border-line px-[18px] py-4">
          <SectionLabel className="mb-2">Variables</SectionLabel>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <span
                key={v}
                className="rounded-[5px] border border-info/25 bg-info/10 px-2 py-[3px] font-mono text-[10px] text-info-tint"
              >
                {v}
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Variable name (e.g. $reviewer)');
                if (name?.trim()) setVariables((prev) => [...prev, name.trim()]);
              }}
              className="rounded-[5px] border border-dashed border-strong px-2 py-[3px] font-mono text-[10px] text-faint hover:text-ink3"
            >
              + add
            </button>
          </div>

          <SectionLabel className="mb-2">Every-pulse routine</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <div
                key={step.id}
                className={`flex gap-2.5 rounded-[7px] border bg-card px-3 py-2.5 ${
                  step.condition ? 'border-warn/20' : 'border-hair'
                }`}
              >
                <div className="mt-0.5 flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => { move(i, i - 1); }}
                    disabled={i === 0}
                    aria-label="Move step up"
                    className="font-mono text-[8px] text-faint hover:text-ink3 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <span className="font-mono text-[9.5px] text-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={() => { move(i, i + 1); }}
                    disabled={i === steps.length - 1}
                    aria-label="Move step down"
                    className="font-mono text-[8px] text-faint hover:text-ink3 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <div className="flex-1">
                  <textarea
                    value={step.text}
                    rows={2}
                    onChange={(e) =>
                      { setSteps((prev) =>
                        prev.map((s) => (s.id === step.id ? { ...s, text: e.target.value } : s)),
                      ); }
                    }
                    className="w-full resize-none bg-transparent text-[11.5px] leading-[1.5] text-ink2 outline-none"
                  />
                  {step.condition && (
                    <div className="mt-1 font-mono text-[9.5px] text-warn-tint">
                      {step.condition}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setSteps((prev) => prev.filter((s) => s.id !== step.id)); }}
                  aria-label="Remove step"
                  className="font-mono text-[11px] text-faint hover:text-danger"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                { setSteps((prev) => [
                  ...prev,
                  {
                    id: `new-${String(prev.length)}-${String(Date.now())}`,
                    index: prev.length + 1,
                    text: '',
                    condition: null,
                  },
                ]); }
              }
              className="rounded-[7px] border border-dashed border-strong px-3 py-2.5 text-left font-mono text-[10.5px] text-faint hover:text-ink3"
            >
              + add step
            </button>
          </div>

          <div className="mt-4 flex gap-3.5">
            <label className="flex-1">
              <SectionLabel className="mb-1.5">Cadence</SectionLabel>
              <input
                value={cadence}
                onChange={(e) => { setCadence(e.target.value); }}
                className="w-full rounded-md border border-edge bg-card px-2.5 py-1.5 font-mono text-[11px] text-ink2 outline-none focus:border-accent/50"
              />
            </label>
            <label className="flex-1">
              <SectionLabel className="mb-1.5">Retire when</SectionLabel>
              <input
                value={retireWhen}
                onChange={(e) => { setRetireWhen(e.target.value); }}
                className="w-full rounded-md border border-edge bg-card px-2.5 py-1.5 font-mono text-[11px] text-ink2 outline-none focus:border-accent/50"
              />
            </label>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger-tint">
              {error}
            </div>
          )}
        </div>

        <aside className="w-[288px] flex-none overflow-y-auto bg-[#0f0f12] p-4">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Resolved for</SectionLabel>
            {users.length > 0 ? (
              <select
                value={resolveFor}
                onChange={(e) => { setResolveFor(e.target.value); }}
                className="cursor-pointer bg-transparent font-mono text-[10px] text-info-tint outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id} className="bg-card">
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-[10px] text-faint">no live users</span>
            )}
          </div>

          <div className="rounded-[7px] border border-hair bg-panel p-3 font-mono text-[10.5px] leading-[1.75] text-ink3">
            {steps.length === 0 ? (
              <span className="text-faint">The routine is empty.</span>
            ) : (
              steps.map((s, i) => (
                <p key={s.id} className={i === 0 ? 'm-0' : 'mb-0 mt-3'}>
                  {resolve(s.text, subject)}
                </p>
              ))
            )}
          </div>

          {playbook.diffFromPrevious.length > 0 && (
            <div className="mt-3 rounded-[7px] border border-hair bg-panel px-3 py-2.5">
              <SectionLabel className="mb-2">
                Diff from v{playbook.version - 1}
              </SectionLabel>
              <div className="font-mono text-[10.5px] leading-[1.7]">
                {playbook.diffFromPrevious.map((d, i) => (
                  <div key={i} className={d.kind === 'add' ? 'text-ok-tint' : 'text-danger-tint'}>
                    {d.kind === 'add' ? '+' : '−'} {d.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {playbook.usedByCount > 0 && (
            <div className="mt-3 rounded-[7px] border border-warn/20 bg-warn/5 px-3 py-2.5 text-[10.5px] leading-[1.55] text-warn-tint">
              Saving v{playbook.version + 1} applies to {playbook.usedByCount} live harnesses at
              their next pulse.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Substitute the playbook's variables for the chosen harness. Anything we can't
 * resolve is left as the literal token rather than blanked, so the preview
 * shows exactly what would ship.
 */
function resolve(text: string, harness: Harness | null): string {
  if (!harness) return text;
  const values: Record<string, string> = {
    $ticket: harness.ticketId ?? '$ticket',
    $branch: harness.branch ?? '$branch',
    $model: harness.model,
    $name: harness.name,
  };
  return text.replace(/\$[a-zA-Z_][\w]*/g, (token) => values[token] ?? token);
}
