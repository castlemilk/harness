import { useMemo, useState } from 'react';
import type { Intervention, InterventionKind } from '../types.js';
import type { ResolveAction } from '../data/api.js';
import { Modal } from '../ui/Modal.js';
import { ago, money } from '../ui/format.js';

/**
 * Surface 1e — Approvals & interventions.
 *
 * One queue, oldest first, and every item is resolvable in place. The point is
 * that nothing here requires navigating away to act on.
 */

const KIND: Record<InterventionKind, { label: string; text: string; chip: string; row: string }> = {
  approval: {
    label: 'APPROVAL',
    text: 'text-danger',
    chip: 'bg-danger/[.12]',
    row: 'bg-danger/[.03]',
  },
  question: { label: 'QUESTION', text: 'text-warn', chip: 'bg-warn/[.12]', row: '' },
  budget: { label: 'BUDGET', text: 'text-info', chip: 'bg-info/[.12]', row: '' },
};

const FILTERS: { id: 'all' | InterventionKind; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'approval', label: 'approvals' },
  { id: 'question', label: 'questions' },
  { id: 'budget', label: 'budget' },
];

export function Interventions({
  open,
  onClose,
  interventions,
  onResolve,
  onOpenSession,
}: {
  open: boolean;
  onClose: () => void;
  interventions: Intervention[];
  onResolve: (item: Intervention, action: ResolveAction, payload?: { response?: string; value?: number }) => Promise<void>;
  onOpenSession: (harnessId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | InterventionKind>('all');

  // Oldest first: the queue is a backlog, not a feed.
  const items = useMemo(() => {
    const list = filter === 'all' ? interventions : interventions.filter((i) => i.kind === filter);
    // A malformed timestamp must not make the comparator inconsistent.
    const at = (v: string) => {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    };
    return [...list].sort((a, b) => at(a.createdAt) - at(b.createdAt));
  }, [interventions, filter]);

  return (
    <Modal open={open} onClose={onClose} width={700} label="Needs you">
      <div className="flex items-center gap-3 border-b border-line px-[18px] py-4">
        <h3 className="m-0 text-[15px] font-semibold">Needs you</h3>
        {interventions.length > 0 && (
          <span className="rounded-full bg-warn px-[7px] py-0.5 font-mono text-[10px] font-semibold text-[#16161a]">
            {interventions.length}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setFilter(f.id); }}
              className={`rounded-[5px] px-2 py-[3px] font-mono text-[10.5px] font-medium ${
                filter === f.id
                  ? 'border border-edge bg-controlAlt text-ink'
                  : 'border border-transparent text-muted hover:text-ink2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="m-0 px-[18px] py-10 text-center text-[12px] text-muted">
          Nothing in this queue.
        </p>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {items.map((item) => (
            <Row key={item.id} item={item} onResolve={onResolve} onOpenSession={onOpenSession} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function Row({
  item,
  onResolve,
  onOpenSession,
}: {
  item: Intervention;
  onResolve: (item: Intervention, action: ResolveAction, payload?: { response?: string; value?: number }) => Promise<void>;
  onOpenSession: (harnessId: string) => void;
}) {
  const tone = KIND[item.kind];
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const act = (action: ResolveAction, payload?: { response?: string; value?: number }) => {
    setBusy(true);
    void onResolve(item, action, payload).finally(() => { setBusy(false); });
  };

  return (
    <div className={`border-b border-hair px-[18px] py-3.5 ${tone.row}`}>
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className={`rounded px-[7px] py-0.5 font-mono text-[9.5px] font-semibold ${tone.text} ${tone.chip}`}
        >
          {tone.label}
        </span>
        <span className="font-mono text-[10.5px] text-muted">
          {item.harnessName} · {ago(item.createdAt)}
          {item.impact ? ` · ${item.impact}` : ''}
        </span>
      </div>

      <div className="text-[13.5px] font-semibold leading-[1.4]">{item.title}</div>

      {item.kind === 'approval' && item.diff && item.diff.lines.length > 0 && (
        <div className="mt-2.5 rounded-[7px] border border-hair bg-panel px-3 py-2.5 font-mono text-[10.5px] leading-[1.7]">
          {item.diff.lines.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === 'add' ? 'text-ok-tint' : l.kind === 'del' ? 'text-danger-tint' : 'text-muted'
              }
            >
              {l.text}
            </div>
          ))}
          <div className="text-muted">{item.diff.summary}</div>
        </div>
      )}

      {item.kind !== 'approval' && item.detail && (
        <div className="mt-1.5 text-[12px] leading-relaxed text-ink3">{item.detail}</div>
      )}

      {item.kind === 'approval' && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Action tone="ok" disabled={busy} onClick={() => { act('approve'); }}>
            Approve once
          </Action>
          <Action disabled={busy} onClick={() => { act('approve-always'); }}>
            Always allow for {item.harnessName}
          </Action>
          <Action disabled={busy} onClick={() => { act('deny'); }}>
            Deny
          </Action>
          <Action disabled={busy} onClick={() => { onOpenSession(item.harnessId); }}>
            Full diff
          </Action>
        </div>
      )}

      {item.kind === 'question' && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={reply}
            onChange={(e) => { setReply(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reply.trim() && !busy) act('answer', { response: reply.trim() });
            }}
            placeholder={`Reply to ${item.harnessName}…`}
            className="flex-1 rounded-md border border-edge bg-card px-2.5 py-2 text-[11px] text-ink outline-none placeholder:text-muted focus:border-accent/50"
          />
          <Action
            tone="primary"
            disabled={busy || !reply.trim()}
            onClick={() => { act('answer', { response: reply.trim() }); }}
          >
            Send
          </Action>
        </div>
      )}

      {item.kind === 'budget' && (
        <div className="mt-3 flex items-center gap-2">
          {item.budget && (
            <span className="font-mono text-[10.5px] text-muted">
              {money(item.budget.spent)} of {money(item.budget.cap)}
            </span>
          )}
          <div className="flex-1" />
          <Action
            tone="primary"
            disabled={busy}
            onClick={() => { act('raise-cap', { value: item.budget?.suggestedCap }); }}
          >
            Raise to {money(item.budget?.suggestedCap ?? 0)}
          </Action>
          <Action disabled={busy} onClick={() => { act('retire'); }}>
            Retire
          </Action>
        </div>
      )}
    </div>
  );
}

function Action({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'ok' | 'primary';
  disabled?: boolean;
}) {
  const cls =
    tone === 'ok'
      ? 'border-ok/30 bg-ok/[.14] text-ok-tint font-semibold'
      : tone === 'primary'
        ? 'border-edge bg-raised text-ink font-semibold'
        : 'border-line bg-control text-ink2 font-medium';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-[11px] transition-colors hover:border-edge disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
