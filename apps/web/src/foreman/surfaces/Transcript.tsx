import { useEffect, useMemo, useState } from 'react';
import type { Harness, TranscriptEntry } from '../types.js';
import { Modal } from '../ui/Modal.js';
import { Avatar } from '../ui/primitives.js';
import { clock, money, percent } from '../ui/format.js';

/**
 * Surface 1f — Transcript.
 *
 * Pulses are the spine. Tool calls collapse by default so the reasoning stays
 * legible, and your own interjections sit inline where they landed.
 */

type Filter = 'all' | 'tools' | 'errors' | 'mine';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'tools', label: 'tools' },
  { id: 'errors', label: 'errors' },
  { id: 'mine', label: 'mine' },
];

export function Transcript({
  open,
  onClose,
  harness,
  parentName,
  entries,
  loading,
  onInterject,
  onInterrupt,
}: {
  open: boolean;
  onClose: () => void;
  harness: Harness | null;
  parentName: string | null;
  entries: TranscriptEntry[];
  loading: boolean;
  onInterject: (text: string) => Promise<void>;
  onInterrupt: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft('');
      setFilter('all');
    }
  }, [open, harness?.id]);

  const shown = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => {
      if (e.kind === 'pulse-divider') return true;
      if (filter === 'tools') return e.kind === 'tool';
      if (filter === 'errors') return e.kind === 'tool' && e.status === 'fail';
      return e.kind === 'human';
    });
  }, [entries, filter]);

  if (!harness) return null;

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    void onInterject(text)
      .then(() => { setDraft(''); })
      .catch((err: unknown) => {
        setSendError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setSending(false); });
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <Modal open={open} onClose={onClose} width={820} label={`Transcript for ${harness.name}`}>
      <div className="flex h-[664px] max-h-[80vh] flex-col">
        <header className="flex flex-none items-center gap-3 border-b border-line px-4 py-3">
          <Avatar seed={harness.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">{harness.name}</div>
            <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted">
              {parentName ? `under ${parentName} · ` : ''}
              {harness.branch ? `branch ${harness.branch} · ` : ''}
              {percent(harness.contextUsed)} ctx · {money(harness.spend)}
            </div>
          </div>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setFilter(f.id); }}
                className={`rounded-[5px] px-2 py-[3px] font-mono text-[10px] font-medium ${
                  filter === f.id
                    ? 'border border-edge bg-controlAlt text-ink'
                    : 'border border-transparent text-muted hover:text-ink2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {loading ? (
            <p className="m-0 text-[12px] text-muted">Loading transcript…</p>
          ) : shown.length === 0 ? (
            <p className="m-0 text-[12px] text-muted">Nothing recorded for this filter yet.</p>
          ) : (
            shown.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                expanded={expanded.has(entry.id)}
                onToggle={() => { toggle(entry.id); }}
              />
            ))
          )}
        </div>

        {sendError && (
          <div className="flex-none border-t border-danger/30 bg-danger/10 px-4 py-1.5 text-[11px] text-danger-tint">
            {sendError}
          </div>
        )}

        <footer className="flex flex-none items-center gap-2.5 border-t border-line px-4 py-3">
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Interject — lands at the start of the next pulse…"
            className="flex-1 rounded-[7px] border border-edge bg-card px-3 py-2.5 text-[11.5px] text-ink outline-none placeholder:text-muted focus:border-accent/50"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !draft.trim()}
            className="rounded-md border border-edge bg-raised px-3.5 py-2 text-[11px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button
            type="button"
            onClick={onInterrupt}
            className="rounded-md border border-line bg-control px-3.5 py-2 text-[11px] font-medium text-ink3 hover:text-ink2"
          >
            Interrupt now
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function Entry({
  entry,
  expanded,
  onToggle,
}: {
  entry: TranscriptEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  switch (entry.kind) {
    case 'pulse-divider':
      return (
        <div className="flex items-center gap-2.5">
          <div className="h-px flex-1 bg-white/[.07]" />
          <span className="font-mono text-[9.5px] font-medium text-faint">
            PULSE #{entry.seq} · {displayTime(entry.at)} · {entry.duration} ·{' '}
            {money(entry.cost)}
          </span>
          <div className="h-px flex-1 bg-white/[.07]" />
        </div>
      );

    case 'plan':
      return (
        <Block accent="#5b9dff" label="PLAN" labelClass="text-info-tint">
          {entry.text}
        </Block>
      );

    case 'finding':
      return (
        <Block accent="#4ec97a" label="FINDING" labelClass="text-ok-tint">
          {entry.text}
        </Block>
      );

    case 'human':
      return (
        <div className="rounded-lg border border-accent/25 bg-accent/[.06] px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2">
            <div className="h-[18px] w-[18px] rounded bg-[#33262a]" aria-hidden="true" />
            <span className="text-[10.5px] font-semibold text-accent-tint">
              you · {displayTime(entry.at)}
            </span>
          </div>
          <div className="text-[12.5px] leading-relaxed text-[#e8d8c4]">{entry.text}</div>
        </div>
      );

    case 'live':
      return (
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-faint">
          <span className="h-[7px] w-[7px] animate-bp-fast rounded-full bg-ok" />
          {entry.text}
        </div>
      );

    case 'tool': {
      const failed = entry.status === 'fail';
      const canExpand = Boolean(entry.output && entry.output.length > 0);
      return (
        <div
          className={`rounded-[7px] border bg-panel ${failed ? 'border-danger/25' : 'border-white/5'}`}
        >
          <button
            type="button"
            onClick={canExpand ? onToggle : undefined}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-[11px] ${
              canExpand ? '' : 'cursor-default'
            }`}
          >
            <span className="text-faint">{canExpand ? (expanded ? '▾' : '▸') : '·'}</span>
            <span className="text-violet">{entry.tool}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{entry.target}</span>
            <span className={failed ? 'text-danger' : 'text-faint'}>
              {entry.resultLabel ?? entry.duration ?? ''}
            </span>
          </button>
          {canExpand && expanded && entry.output && (
            <div className="mx-3 mb-2.5 rounded-[5px] bg-[#0f0f12] px-3 py-2.5 font-mono text-[10.5px] leading-[1.7] text-ink3">
              {entry.output.map((line, i) => (
                <div key={i}>
                  <span className={line.ok ? 'text-ok-tint' : 'text-danger'}>
                    {line.ok ? '✓' : '✗'}
                  </span>{' '}
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

/** Accepts either a wall-clock string ("14:02") or an ISO instant. */
function displayTime(value: string): string {
  return /^\d{1,2}:\d{2}/.test(value) ? value : clock(value);
}

function Block({
  accent,
  label,
  labelClass,
  children,
}: {
  accent: string;
  label: string;
  labelClass: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg bg-cardAlt px-3.5 py-3"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <div className={`mb-1.5 font-mono text-[9.5px] font-semibold ${labelClass}`}>{label}</div>
      <div className="text-[12.5px] leading-relaxed text-ink2 [text-wrap:pretty]">{children}</div>
    </div>
  );
}
