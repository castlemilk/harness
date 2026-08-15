import { useMemo, useState } from 'react';
import type { Ticket, TicketState } from '../types.js';
import { SectionLabel, StatusDot } from '../ui/primitives.js';
import { plural } from '../ui/format.js';

/**
 * Surface 1g — Work board.
 *
 * The tickets the fleet is working, with the owning harness on every card so
 * "who has this" is never a second question.
 */

const COLUMNS: { id: TicketState; label: string; dot: string }[] = [
  { id: 'backlog', label: 'Backlog', dot: '#6b6b74' },
  { id: 'triaged', label: 'Triaged', dot: '#5b9dff' },
  { id: 'in-progress', label: 'In progress', dot: '#e8963c' },
  { id: 'in-review', label: 'In review', dot: '#a67ff0' },
];

const LABEL_TONE: Record<string, string> = {
  growth: 'text-violet-tint bg-violet/[.12]',
  medium: 'text-warn-tint bg-warn/[.12]',
  high: 'text-danger-tint bg-danger/[.12]',
  integrations: 'text-ok-tint bg-ok/[.12]',
};

export function WorkBoard({
  tickets,
  objectiveName,
  onOpenHarness,
}: {
  tickets: Ticket[];
  objectiveName: string;
  onOpenHarness: (harnessId: string) => void;
}) {
  const [layout, setLayout] = useState<'kanban' | 'table'>('kanban');
  const [query, setQuery] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (ownedOnly && !t.ownerHarnessId) return false;
      if (!needle) return true;
      return (
        t.title.toLowerCase().includes(needle) ||
        t.ref.toLowerCase().includes(needle) ||
        (t.ownerHarnessName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [tickets, query, ownedOnly]);

  const doneCount = filtered.filter((t) => t.state === 'done').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas text-ink">
      <div className="flex-none border-b border-line px-[18px] pb-3 pt-4">
        <div className="flex items-center gap-3.5">
          <div>
            <div className="font-mono text-[9.5px] text-faint">
              {layout === 'table' ? 'TABLE' : 'BOARD'} · {tickets.length} rows
            </div>
            <h3 className="m-0 mt-1 text-[17px] font-semibold">{objectiveName}</h3>
          </div>
          <div className="flex-1" />
          <div className="flex gap-1 rounded-[7px] border border-line bg-card p-[3px] text-[11px] font-medium">
            {(['table', 'kanban'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => { setLayout(l); }}
                className={`rounded-[5px] px-2.5 py-1 capitalize ${
                  layout === l ? 'bg-[#26262e] text-ink' : 'text-muted hover:text-ink2'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder={`Search ${String(tickets.length)} rows…`}
            className="w-[230px] rounded-md border border-line bg-card px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-edge"
          />
          <button
            type="button"
            onClick={() => { setOwnedOnly((v) => !v); }}
            className={`font-mono text-[10.5px] ${ownedOnly ? 'text-accent' : 'text-muted hover:text-ink2'}`}
          >
            owner: {ownedOnly ? 'fleet · 1 filter' : 'anyone'}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="m-0 px-[18px] py-12 text-center text-[12px] text-muted">
          No tickets match this filter.
        </p>
      ) : layout === 'kanban' ? (
        <div className="min-h-0 flex-1 overflow-auto px-[18px] py-3.5">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${String(COLUMNS.length)},minmax(0,1fr)) 52px` }}
          >
            {COLUMNS.map((col) => {
              const items = filtered.filter((t) => t.state === col.id);
              return (
                <div key={col.id} className="min-w-0">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: col.dot }}
                    />
                    <span className="text-[11.5px] font-semibold">{col.label}</span>
                    <span className="font-mono text-[10px] text-faint">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((t) => (
                      <Card key={t.id} ticket={t} onOpenHarness={onOpenHarness} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-center rounded-[7px] border border-dashed border-strong font-mono text-[10px] text-faint [writing-mode:vertical-rl]">
              Done {doneCount}
            </div>
          </div>
        </div>
      ) : (
        <Table tickets={filtered} onOpenHarness={onOpenHarness} />
      )}
    </div>
  );
}

function Card({
  ticket,
  onOpenHarness,
}: {
  ticket: Ticket;
  onOpenHarness: (harnessId: string) => void;
}) {
  const active = ticket.state === 'in-progress' && ticket.ownerStatus === 'working';
  const ownerId = ticket.ownerHarnessId;
  return (
    <div
      className={`rounded-[7px] border bg-card px-3 py-2.5 ${
        active ? 'border-accent/25' : 'border-line'
      }`}
    >
      <div className="text-[11.5px] font-medium leading-[1.45]">{ticket.title}</div>

      {ownerId && ticket.ownerHarnessName && (
        <button
          type="button"
          onClick={() => { onOpenHarness(ownerId); }}
          className="mt-2 flex items-center gap-1.5"
        >
          <div className="h-4 w-4 flex-none rounded bg-[#26263a]" aria-hidden="true" />
          <span className="font-mono text-[9.5px] text-ink3 hover:text-ink">
            {ticket.ownerHarnessName}
          </span>
          {ticket.ownerStatus && <StatusDot status={ticket.ownerStatus} />}
        </button>
      )}

      <div className="mt-2 font-mono text-[9.5px] text-faint">
        {ticket.ref}
        {ticket.branch
          ? ` · ${ticket.branch}`
          : ticket.prNumber != null
            ? ` · PR #${String(ticket.prNumber)}`
            : ticket.childCount > 0
              ? ` · ${plural(ticket.childCount, 'child', 'children')}`
              : ticket.assignmentNote
                ? ` · ${ticket.assignmentNote}`
                : ''}
      </div>

      {ticket.labels.length > 0 && (
        <div className="mt-2 flex gap-1">
          {ticket.labels.map((l) => (
            <span
              key={l.text}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
                LABEL_TONE[l.tone] ?? 'bg-control text-muted'
              }`}
            >
              {l.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Table({
  tickets,
  onOpenHarness,
}: {
  tickets: Ticket[];
  onOpenHarness: (harnessId: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-[18px] py-3.5">
      <SectionLabel className="mb-2">All tickets</SectionLabel>
      <div className="overflow-hidden rounded-lg border border-hair">
        {tickets.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-3 py-2.5 ${i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'}`}
          >
            <span className="w-16 flex-none font-mono text-[10px] text-muted">{t.ref}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{t.title}</span>
            <span className="w-24 flex-none font-mono text-[10px] text-faint">{t.state}</span>
            <span className="w-36 flex-none truncate text-right font-mono text-[10px]">
              {t.ownerHarnessName ? (
                <OwnerButton
                  harnessId={t.ownerHarnessId}
                  name={t.ownerHarnessName}
                  onOpen={onOpenHarness}
                />
              ) : (
                <span className="text-faint">unassigned</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Owner cell in the table view; unowned tickets render as plain text upstream. */
function OwnerButton({
  harnessId,
  name,
  onOpen,
}: {
  harnessId: string | null;
  name: string;
  onOpen: (id: string) => void;
}) {
  if (harnessId == null) return <span className="text-faint">{name}</span>;
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(harnessId);
      }}
      className="text-ink3 hover:text-ink"
    >
      {name}
    </button>
  );
}
