import { useEffect, useMemo, useRef, useState } from 'react';
import type { Harness, Ticket } from '../types.js';
import { Modal } from '../ui/Modal.js';
import { SectionLabel, StatusDot } from '../ui/primitives.js';
import { duration, percent } from '../ui/format.js';

/**
 * Surface 1k — Command palette.
 *
 * Jump to any harness or ticket; lead with a verb and the same query becomes an
 * action on the selection. ⌘↵ widens the action to the whole subtree.
 */

export type PaletteVerb = 'pause' | 'resume' | 'retire' | 'spawn' | 'open';

export interface PaletteAction {
  id: string;
  verb: PaletteVerb;
  label: React.ReactNode;
  hint: string | null;
  subtree: boolean;
  run: () => void;
}

const VERBS: { verb: PaletteVerb; words: string[]; icon: string }[] = [
  { verb: 'pause', words: ['pause', 'stop', 'halt'], icon: '⏸' },
  { verb: 'resume', words: ['resume', 'start', 'unpause'], icon: '▶' },
  { verb: 'retire', words: ['retire', 'kill', 'end'], icon: '⏹' },
  { verb: 'spawn', words: ['spawn', 'new', 'create'], icon: '＋' },
  { verb: 'open', words: ['open', 'go', 'jump'], icon: '→' },
];

export function CommandPalette({
  open,
  onClose,
  harnesses,
  tickets,
  onOpenHarness,
  onOpenTicket,
  onRunVerb,
}: {
  open: boolean;
  onClose: () => void;
  harnesses: Harness[];
  tickets: Ticket[];
  onOpenHarness: (id: string) => void;
  onOpenTicket: (id: string) => void;
  onRunVerb: (verb: PaletteVerb, harness: Harness, subtree: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Autofocus after the modal mounts so typing lands in the field.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { verb, needle } = useMemo(() => parseQuery(query), [query]);

  const matchedHarnesses = useMemo(
    () => (needle ? harnesses.filter((h) => h.name.toLowerCase().includes(needle)) : harnesses).slice(0, 6),
    [harnesses, needle],
  );

  const matchedTickets = useMemo(
    () =>
      (needle
        ? tickets.filter(
            (t) =>
              t.title.toLowerCase().includes(needle) || t.ref.toLowerCase().includes(needle),
          )
        : tickets
      ).slice(0, 4),
    [tickets, needle],
  );

  const actions: PaletteAction[] = useMemo(() => {
    // Requiring a needle stops "pause" + Enter from pausing whichever harness
    // happens to sort first.
    if (!verb || !needle) return [];
    const target = matchedHarnesses.at(0);
    if (!target) return [];
    const out: PaletteAction[] = [
      {
        id: `${verb}-${target.id}`,
        verb,
        label: (
          <>
            {capitalise(verb)} <Mono>{target.name}</Mono>
            {target.childCount > 0 ? ` and its ${String(target.childCount)} children` : ''}
          </>
        ),
        hint: '↵',
        subtree: target.childCount > 0,
        run: () => {
          onRunVerb(verb, target, target.childCount > 0);
          onClose();
        },
      },
    ];
    // A branch-wide variant when several harnesses share the branch.
    if (target.branch) {
      const sameBranch = harnesses.filter((h) => h.branch === target.branch);
      if (sameBranch.length > 1) {
        out.push({
          id: `${verb}-branch`,
          verb,
          label: (
            <>
              {capitalise(verb)} every harness on <Mono>{target.branch}</Mono>
            </>
          ),
          hint: `${String(sameBranch.length)} agents`,
          subtree: false,
          run: () => {
            for (const h of sameBranch) onRunVerb(verb, h, false);
            onClose();
          },
        });
      }
    }
    return out;
  }, [verb, needle, matchedHarnesses, harnesses, onRunVerb, onClose]);

  // One flat list drives keyboard selection across all three sections.
  const rows = useMemo(
    () => [
      ...actions.map((a) => ({ kind: 'action' as const, action: a })),
      ...matchedHarnesses.map((h) => ({ kind: 'harness' as const, harness: h })),
      ...matchedTickets.map((t) => ({ kind: 'ticket' as const, ticket: t })),
    ],
    [actions, matchedHarnesses, matchedTickets],
  );

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const activate = (index: number, subtree: boolean) => {
    const row = rows.at(index);
    if (!row) return;
    if (row.kind === 'action') {
      if (subtree) {
        const target = matchedHarnesses.at(0);
        if (verb && target) {
          onRunVerb(verb, target, true);
          onClose();
          return;
        }
      }
      row.action.run();
    } else if (row.kind === 'harness') {
      onOpenHarness(row.harness.id);
      onClose();
    } else {
      onOpenTicket(row.ticket.id);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={620} label="Command palette">
      <div className="p-3.5">
        <div className="flex items-center gap-2.5 rounded-lg border border-strong bg-card px-3 py-2.5">
          <span className="font-mono text-[13px] text-accent">›</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(rows.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                activate(cursor, e.metaKey || e.ctrlKey);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                const first = matchedHarnesses.at(0);
                if (first) setQuery(`${verb ?? 'open'} ${first.name} `);
              }
            }}
            placeholder="Jump to a harness or ticket, or type a verb…"
            className="flex-1 bg-transparent font-mono text-[13.5px] text-ink outline-none placeholder:text-faint"
          />
          <span className="font-mono text-[10px] text-faint">⌘K</span>
        </div>

        {rows.length === 0 ? (
          <p className="m-0 px-1 py-8 text-center text-[12px] text-muted">Nothing matches.</p>
        ) : (
          <>
            {actions.length > 0 && (
              <Section label="Actions">
                {actions.map((a, i) => (
                  <Row key={a.id} active={cursor === i} onClick={() => { activate(i, false); }}>
                    <span
                      className={`font-mono text-[11px] ${cursor === i ? 'text-accent' : 'text-muted'}`}
                    >
                      {VERBS.find((v) => v.verb === a.verb)?.icon}
                    </span>
                    <span className="flex-1 text-[12px] font-medium">{a.label}</span>
                    <span
                      className={`font-mono text-[9.5px] ${cursor === i ? 'text-accent-dim' : 'text-faint'}`}
                    >
                      {a.hint}
                    </span>
                  </Row>
                ))}
              </Section>
            )}

            {matchedHarnesses.length > 0 && (
              <Section label="Harnesses">
                {matchedHarnesses.map((h, i) => {
                  const index = actions.length + i;
                  return (
                    <Row
                      key={h.id}
                      active={cursor === index}
                      onClick={() => { activate(index, false); }}
                    >
                      <div className="h-[18px] w-[18px] rounded bg-[#26263a]" aria-hidden="true" />
                      <span className="flex-1 truncate font-mono text-[11.5px] text-ink2">
                        {h.name}
                      </span>
                      <StatusDot status={h.status} />
                      <span className="font-mono text-[9.5px] text-faint">
                        {h.status === 'waiting'
                          ? `waiting ${duration(h.idleMinutes)}`
                          : percent(h.contextUsed)}
                      </span>
                    </Row>
                  );
                })}
              </Section>
            )}

            {matchedTickets.length > 0 && (
              <Section label="Tickets">
                {matchedTickets.map((t, i) => {
                  const index = actions.length + matchedHarnesses.length + i;
                  return (
                    <Row
                      key={t.id}
                      active={cursor === index}
                      onClick={() => { activate(index, false); }}
                    >
                      <span className="font-mono text-[10px] text-muted">{t.ref}</span>
                      <span className="flex-1 truncate text-[11.5px] text-ink2">{t.title}</span>
                      <span className="font-mono text-[9.5px] text-faint">{t.state}</span>
                    </Row>
                  );
                })}
              </Section>
            )}
          </>
        )}

        <div className="mt-3.5 flex items-center gap-3.5 border-t border-hair pt-3 font-mono text-[9.5px] text-faint">
          <span>↵ run</span>
          <span>⇥ narrow</span>
          <span>⌘↵ run on subtree</span>
          <span className="ml-auto">verbs: pause, resume, retire, spawn, open</span>
        </div>
      </div>
    </Modal>
  );
}

function parseQuery(query: string): { verb: PaletteVerb | null; needle: string } {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return { verb: null, needle: '' };
  const [head, ...rest] = trimmed.split(/\s+/);
  const match = VERBS.find((v) => v.words.includes(head));
  if (match) return { verb: match.verb, needle: rest.join(' ') };
  return { verb: null, needle: trimmed };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px]">{children}</span>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <SectionLabel className="mb-1.5 mt-3.5">{label}</SectionLabel>
      <div className="flex flex-col gap-[3px]">{children}</div>
    </>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left ${
        active ? 'border border-accent/25 bg-accent/10' : 'border border-transparent hover:bg-card'
      }`}
    >
      {children}
    </button>
  );
}
