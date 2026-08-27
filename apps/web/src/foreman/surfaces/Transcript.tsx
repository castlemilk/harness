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

/**
 * What a filtered transcript keeps. A pulse divider survives only when at
 * least one MATCHING entry follows it before the next divider — the old rule
 * ("dividers always pass") meant filtering a noisy harness stripped the
 * substance and left the wall of dividers, the exact opposite of the point.
 */
export function visibleEntries(entries: TranscriptEntry[], filter: Filter): TranscriptEntry[] {
  if (filter === 'all') return entries;
  const matches = (e: TranscriptEntry): boolean => {
    if (filter === 'tools') return e.kind === 'tool';
    if (filter === 'errors') return e.kind === 'tool' && e.status === 'fail';
    return e.kind === 'human';
  };
  const out: TranscriptEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.kind === 'pulse-divider') {
      let keep = false;
      for (let j = i + 1; j < entries.length && entries[j].kind !== 'pulse-divider'; j++) {
        if (matches(entries[j])) { keep = true; break; }
      }
      if (keep) out.push(entry);
    } else if (matches(entry)) {
      out.push(entry);
    }
  }
  return out;
}

export interface IdleGroup {
  kind: 'idle-group';
  id: string;
  count: number;
  from: string;
  to: string;
  cost: number;
  /** The collapsed dividers, renderable when the group is expanded. */
  members: Extract<TranscriptEntry, { kind: 'pulse-divider' }>[];
}

export type TranscriptRow = TranscriptEntry | IdleGroup;

/** An ok-outcome pulse whose window carried no trace entries: a heartbeat that
 *  found nothing to do. warn/fail pulses are never idle — they are findings. */
function isIdleDivider(entry: TranscriptEntry): entry is Extract<TranscriptEntry, { kind: 'pulse-divider' }> {
  return entry.kind === 'pulse-divider' && entry.empty === true && (entry.outcome ?? 'ok') === 'ok';
}

/**
 * Collapse runs of 2+ consecutive idle heartbeat pulses into one aggregate
 * row. A single idle pulse renders normally; a run reads as what it is —
 * "the agent woke N times and had nothing to report" — in one line instead of
 * N. Payloads from servers that predate the `empty` flag collapse nothing.
 */
export function groupIdlePulses(entries: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let run: Extract<TranscriptEntry, { kind: 'pulse-divider' }>[] = [];
  const flush = () => {
    if (run.length >= 2) {
      rows.push({
        kind: 'idle-group',
        id: `idle-${run[0].id}`,
        count: run.length,
        from: run[0].at,
        to: run[run.length - 1].at,
        cost: run.reduce((sum, p) => sum + p.cost, 0),
        members: run,
      });
    } else {
      rows.push(...run);
    }
    run = [];
  };
  for (const entry of entries) {
    if (isIdleDivider(entry)) {
      run.push(entry);
    } else {
      flush();
      rows.push(entry);
    }
  }
  flush();
  return rows;
}

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

  const shown = useMemo(
    () => groupIdlePulses(visibleEntries(entries, filter)),
    [entries, filter],
  );

  // Interjects that landed AFTER the last pulse have not been consumed yet —
  // say so, or a reply to a slow harness looks ignored (and a reply to a
  // waiting one used to actually BE ignored).
  const queuedIds = useMemo(() => {
    let lastDivider = -1;
    entries.forEach((e, i) => { if (e.kind === 'pulse-divider') lastDivider = i; });
    return new Set(
      entries.filter((e, i) => e.kind === 'human' && i > lastDivider).map((e) => e.id),
    );
  }, [entries]);

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
                queued={entry.kind === 'human' && queuedIds.has(entry.id)}
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
  queued = false,
}: {
  entry: TranscriptRow;
  expanded: boolean;
  onToggle: () => void;
  /** A human interject the next pulse has not consumed yet. */
  queued?: boolean;
}) {
  switch (entry.kind) {
    case 'idle-group':
      return (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center gap-2.5 text-left"
          >
            <div className="h-px flex-1 bg-white/[.05]" />
            <span className="font-mono text-[9.5px] font-medium text-faint">
              {expanded ? '▾' : '▸'} {entry.count} idle pulses · {displayTime(entry.from)} →{' '}
              {displayTime(entry.to)} · {money(entry.cost)}
            </span>
            <div className="h-px flex-1 bg-white/[.05]" />
          </button>
          {expanded && entry.members.map((member) => (
            <PulseDivider key={member.id} entry={member} />
          ))}

        </div>
      );

    case 'pulse-divider':
      return <PulseDivider entry={entry} expanded={expanded} onToggle={onToggle} />;

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
            {queued && (
              <span className="font-mono text-[9px] text-warn">queued for next pulse</span>
            )}
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

function PulseDivider({
  entry,
  expanded = false,
  onToggle,
}: {
  entry: Extract<TranscriptEntry, { kind: 'pulse-divider' }>;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const outcome = entry.outcome ?? 'ok';
  const outcomeClass = outcome === 'fail' ? 'text-danger' : outcome === 'warn' ? 'text-warn' : 'text-faint';
  // The stored exchange — the audit trail. Old rows have none; external CLI
  // pulses keep theirs in the task traces below the divider instead.
  const canExpand = Boolean(onToggle && (entry.promptText ?? entry.responseText));
  const label = (
    <span className={`font-mono text-[9.5px] font-medium ${outcomeClass}`}>
      {canExpand ? (expanded ? '▾ ' : '▸ ') : ''}
      PULSE #{entry.seq} · {displayTime(entry.at)} · {entry.duration} ·{' '}
      {money(entry.cost)}
      {entry.model != null && entry.model !== '' ? ` · ${entry.model}` : ''}
      {outcome !== 'ok' ? ` · ${outcome}` : ''}
    </span>
  );
  return (
    <div className="flex flex-col gap-1">
      {canExpand ? (
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5">
          <div className="h-px flex-1 bg-white/[.07]" />
          {label}
          <div className="h-px flex-1 bg-white/[.07]" />
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          <div className="h-px flex-1 bg-white/[.07]" />
          {label}
          <div className="h-px flex-1 bg-white/[.07]" />
        </div>
      )}
      {/* The pulse's own work-log line — the engine's narration used to be
          invisible in the transcript, which made a chat-model harness's
          transcript nothing but dividers. */}
      {entry.summary != null && entry.summary !== '' && (
        <div className="px-6 text-center font-mono text-[10px] leading-relaxed text-muted">
          {entry.summary}
        </div>
      )}
      {canExpand && expanded && (
        <div className="mx-3 flex flex-col gap-2">
          {entry.promptText != null && entry.promptText !== '' && (
            <div className="rounded-[5px] bg-[#0f0f12] px-3 py-2.5">
              <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-info-tint">
                prompt sent
              </div>
              <pre className="m-0 max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-[1.6] text-ink3">
                {entry.promptText}
              </pre>
            </div>
          )}
          {entry.responseText != null && entry.responseText !== '' && (
            <div className="rounded-[5px] bg-[#0f0f12] px-3 py-2.5">
              <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-ok-tint">
                raw response
              </div>
              <pre className="m-0 max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-[1.6] text-ink3">
                {entry.responseText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
