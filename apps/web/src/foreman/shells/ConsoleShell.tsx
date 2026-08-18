import { useMemo, useState } from 'react';
import type { Harness, Objective, Tool, Workstream } from '../types.js';
import type { ObjectiveState } from '../data/api.js';
import {
  buildTree,
  flattenTree,
  groupByWorkstream,
  liveHarnesses,
  type HarnessNode,
} from '../data/useForeman.js';
import {
  Avatar,
  Button,
  Meter,
  Panel,
  Pill,
  SectionLabel,
  SliderReadout,
  StatusDot,
  statusColor,
} from '../ui/primitives.js';
import { duration, money, percent, plural } from '../ui/format.js';
import { useVocabulary } from '../usecases/vocabulary.js';

/**
 * Shell 1a — Console.
 *
 * Hierarchy is a nested tree on the left, one harness holds focus in the
 * middle, and the fleet roster never leaves the right-hand rail.
 */
export function ConsoleShell({
  state,
  focusId,
  onFocus,
  tools,
  onAction,
  onSpawn,
}: {
  state: ObjectiveState;
  focusId: string | null;
  onFocus: (id: string) => void;
  tools: Tool[];
  onAction: (action: ConsoleAction, harness: Harness) => void;
  onSpawn: (parentId: string | null) => void;
}) {
  const { objective, harnesses, workstreams } = state;
  const focus = harnesses.find((h) => h.id === focusId) ?? harnesses.at(0) ?? null;
  // One of the chrome-level labels the active shell may rename; see
  // `usecases/vocabulary.tsx` for the (short) list.
  const words = useVocabulary();

  return (
    <div className="flex min-h-0 flex-1 bg-canvas text-ink">
      <FleetTree
        objective={objective}
        harnesses={harnesses}
        workstreams={workstreams}
        focusId={focus?.id ?? null}
        onFocus={onFocus}
        onSpawn={onSpawn}
      />
      {focus ? (
        <FocusColumn
          harness={focus}
          harnesses={harnesses}
          objective={objective}
          workstreams={workstreams}
          onAction={onAction}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
          No {words.harness} selected.
        </div>
      )}
      <RosterRail
        harnesses={harnesses}
        workstreams={workstreams}
        focusId={focus?.id ?? null}
        onFocus={onFocus}
        tools={tools}
        focusName={focus?.name ?? ''}
        onAction={onAction}
        focus={focus}
      />
    </div>
  );
}

export type ConsoleAction =
  | 'reply'
  | 'rendezvous'
  | 'transcript'
  | 'pause'
  | 'resume'
  | 'run-tool';

/* ---------------------------------------------------------------- left rail */

function FleetTree({
  objective,
  harnesses,
  workstreams,
  focusId,
  onFocus,
  onSpawn,
}: {
  objective: Objective;
  harnesses: Harness[];
  workstreams: Workstream[];
  focusId: string | null;
  onFocus: (id: string) => void;
  onSpawn: (parentId: string | null) => void;
}) {
  const [filter, setFilter] = useState('');
  const words = useVocabulary();
  // Collapsed-sets rather than expanded-sets: a harness or workstream that
  // arrives over the stream after mount defaults to visible.
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set());
  const [closedStreams, setClosedStreams] = useState<Set<string>>(
    () => new Set(workstreams.slice(1).map((w) => w.id)),
  );

  const needle = filter.trim().toLowerCase();
  const fleet = useMemo(() => liveHarnesses(harnesses), [harnesses]);
  const visible = useMemo(
    () => (needle ? fleet.filter((h) => h.name.toLowerCase().includes(needle)) : fleet),
    [fleet, needle],
  );

  const groups = useMemo(() => groupByWorkstream(visible, workstreams), [visible, workstreams]);

  const online = fleet.filter(
    (h) => h.status === 'working' || h.status === 'watching' || h.status === 'waiting',
  ).length;

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  return (
    <aside className="flex w-56 flex-none flex-col border-r border-line bg-rail">
      <div className="border-b border-hair px-3.5 py-3">
        <input
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
          placeholder={`Filter ${words.harnesses}…`}
          className="w-full rounded-md border border-hair bg-control px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-edge"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2.5 pt-0.5">
        <SectionLabel className="px-1.5 pb-1.5 pt-2">Objective</SectionLabel>
        <div className="rounded-md border border-accent/25 bg-accent/[.07] px-2 py-1.5">
          <div className="text-[11.5px] font-semibold text-accent-tint">{objective.name}</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Meter value={objective.progress} color="#e8963c" className="flex-1" />
            <span className="font-mono text-[9.5px] font-medium text-ink3">
              {percent(objective.progress)}
            </span>
          </div>
        </div>

        <SectionLabel className="px-1.5 pb-1.5 pt-3.5">
          Fleet · {fleet.length}
        </SectionLabel>

        <div className="flex flex-col gap-px">
          {groups.map((group) => {
            const members = group.harnesses;
            if (members.length === 0) return null;
            const roots = buildTree(members);
            const open = !closedStreams.has(group.id) || Boolean(needle);
            const ws = group.workstream;
            return (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => { toggle(closedStreams, group.id, setClosedStreams); }}
                  className="flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-left hover:bg-card"
                >
                  <span className="font-mono text-[9px] text-muted">{open ? '▾' : '▸'}</span>
                  <StatusDot status={ws ? (ws.paused ? 'paused' : ws.status) : 'ready'} />
                  <span className="flex-1 truncate text-[11.5px] font-medium">{group.name}</span>
                  <span
                    className="font-mono text-[9.5px]"
                    style={{ color: ws?.status === 'failed' ? '#e5675b' : '#6b6b74' }}
                  >
                    {members.length}
                  </span>
                </button>
                {open &&
                  flattenTree(
                    roots,
                    new Set(members.filter((m) => !collapsedNodes.has(m.id)).map((m) => m.id)),
                  ).map(({ node, hasChildren }) => (
                    <TreeRow
                      key={node.harness.id}
                      node={node}
                      hasChildren={hasChildren}
                      expanded={!collapsedNodes.has(node.harness.id)}
                      focused={node.harness.id === focusId}
                      onToggle={() => { toggle(collapsedNodes, node.harness.id, setCollapsedNodes); }}
                      onFocus={() => { onFocus(node.harness.id); }}
                    />
                  ))}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => { onSpawn(null); }}
          className="mt-1 w-full rounded-[5px] px-1.5 py-1.5 text-left text-[11px] text-muted hover:bg-card hover:text-ink2"
        >
          + New harness
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-hair px-3 py-2.5">
        <span className="font-mono text-[10px] font-medium text-ok">● {online} online</span>
        <span className="font-mono text-[10px] text-muted">{money(objective.spendToday)} today</span>
      </div>
    </aside>
  );
}

function TreeRow({
  node,
  hasChildren,
  expanded,
  focused,
  onToggle,
  onFocus,
}: {
  node: HarnessNode;
  hasChildren: boolean;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  const h = node.harness;
  const isLead = hasChildren || h.childCount > 0;
  return (
    <div
      className={`flex items-center gap-1.5 rounded-[5px] py-[5px] pr-1.5 ${
        focused ? 'border border-accent/30 bg-accent/10' : 'hover:bg-card'
      }`}
      style={{ paddingLeft: 8 + node.depth * 12 }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="font-mono text-[9px] text-muted"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="w-[7px]" />
      )}
      <StatusDot status={h.status} size={5} />
      <button
        type="button"
        onClick={onFocus}
        className={`flex-1 truncate text-left ${
          isLead
            ? `text-[11px] font-semibold ${focused ? 'text-accent-tint' : ''}`
            : 'font-mono text-[11px] text-ink2'
        }`}
        title={h.name}
      >
        {h.name}
      </button>
      {h.status === 'waiting' && <span className="font-mono text-[9px] text-warn">wait</span>}
      {isLead && (
        <span
          className={`font-mono text-[9.5px] ${focused ? 'text-accent-dim' : 'text-muted'}`}
        >
          {h.childCount}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ centre column */

function FocusColumn({
  harness,
  harnesses,
  objective,
  workstreams,
  onAction,
}: {
  harness: Harness;
  harnesses: Harness[];
  objective: Objective;
  workstreams: Workstream[];
  onAction: (action: ConsoleAction, harness: Harness) => void;
}) {
  const workstream = workstreams.find((w) => w.id === harness.workstreamId);
  const parent = harnesses.find((h) => h.id === harness.parentId);
  const paused = harness.status === 'paused';

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex h-11 flex-none items-center gap-2.5 border-b border-line px-4">
        <span className="truncate font-mono text-[11px] text-muted">
          {objective.name} / {workstream?.name ?? '—'} /{parent ? ` ${parent.name} /` : ''}
        </span>
        <span className="text-[12px] font-semibold">{harness.name}</span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-muted">
          {harness.latestPulseSeq != null ? `pulse #${String(harness.latestPulseSeq)}` : 'no pulses yet'}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
        <Panel className="flex">
          <div className="flex w-[196px] flex-none flex-col gap-3.5 border-r border-hair p-4">
            <div
              className="h-[82px] w-[82px] rounded-[9px] border border-line bg-raised"
              aria-hidden="true"
            />
            <div>
              <SectionLabel className="mb-1.5">Heartbeat</SectionLabel>
              <SliderReadout
                value={Math.min(1, harness.heartbeatMinutes / 120)}
                label={`${String(harness.heartbeatMinutes)}m`}
              />
            </div>
            <div>
              <SectionLabel className="mb-1.5">Max children</SectionLabel>
              <SliderReadout
                value={harness.maxChildren / 24}
                label={String(harness.maxChildren)}
              />
            </div>
            <div>
              <SectionLabel className="mb-1.5">Model</SectionLabel>
              <div className="rounded-md border border-edge bg-controlAlt px-2.5 py-1.5 font-mono text-[11px] text-ink2">
                {harness.model}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 p-4 px-[18px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-[19px] font-semibold leading-tight">
                  {harness.name} · mission
                </h2>
                <div className="mt-1.5 font-mono text-[11px] text-muted">
                  owns {plural(harness.childCount, 'child', 'children')} · idle{' '}
                  {duration(harness.idleMinutes)} ·{' '}
                  {harness.nextPulseInMinutes != null
                    ? `next pulse in ${duration(harness.nextPulseInMinutes)}`
                    : 'no pulse scheduled'}
                </div>
              </div>
              <Pill color={statusColor(harness.status)}>● {harness.status}</Pill>
            </div>

            <div className="my-4 flex flex-wrap gap-2">
              <Button tone="primary" onClick={() => { onAction('reply', harness); }}>
                Reply now
              </Button>
              <Button onClick={() => { onAction('rendezvous', harness); }}>Rendezvous</Button>
              <Button onClick={() => { onAction('transcript', harness); }}>Transcript</Button>
              <Button onClick={() => { onAction(paused ? 'resume' : 'pause', harness); }}>
                {paused ? 'Resume fleet' : 'Pause fleet'}
              </Button>
            </div>

            <SectionLabel className="mb-2">How it reasons</SectionLabel>
            <p className="m-0 mb-4 text-[13px] leading-relaxed text-ink2 [text-wrap:pretty]">
              {harness.mission}
            </p>
            <SectionLabel className="mb-2">Current job</SectionLabel>
            <p className="m-0 text-[13px] leading-relaxed text-ink2 [text-wrap:pretty]">
              {harness.currentJob || '—'}
            </p>
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-1">
          <div className="w-[196px] flex-none border-r border-hair p-4">
            <div
              className="mb-3 h-[52px] w-[52px] rounded-lg border border-line bg-raised"
              aria-hidden="true"
            />
            <p className="m-0 font-mono text-[10.5px] leading-relaxed text-muted">
              The standing routine this harness runs on every pulse. Recurring duties live here.
            </p>
          </div>
          <div className="min-w-0 flex-1 p-4 px-[18px]">
            <h3 className="m-0 mb-3 text-[15px] font-semibold">Every-pulse actions</h3>
            {harness.routine.length === 0 ? (
              <p className="m-0 text-[12px] text-muted">
                No routine — this harness has no playbook attached.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {harness.routine.map((step) => (
                  <div key={step.id} className="flex gap-2.5 rounded-[7px] bg-[#191920] px-3 py-2.5">
                    <span className="mt-0.5 font-mono text-[10px] text-accent">
                      {String(step.index).padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                      <span className="text-[12.5px] leading-normal text-ink2">{step.text}</span>
                      {step.condition && (
                        <div className="mt-1 font-mono text-[9.5px] text-warn-tint">
                          {step.condition}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- right rail */

function RosterRail({
  harnesses,
  workstreams,
  focusId,
  focus,
  focusName,
  onFocus,
  tools,
  onAction,
}: {
  harnesses: Harness[];
  workstreams: Workstream[];
  focusId: string | null;
  focus: Harness | null;
  focusName: string;
  onFocus: (id: string) => void;
  tools: Tool[];
  onAction: (action: ConsoleAction, harness: Harness) => void;
}) {
  const [tab, setTab] = useState<'sessions' | 'usage'>('sessions');

  return (
    <aside className="flex w-[352px] flex-none flex-col border-l border-line bg-rail">
      <div className="flex h-11 flex-none items-center gap-3.5 border-b border-hair px-3.5">
        {(['sessions', 'usage'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); }}
            className={`text-[12.5px] capitalize ${
              tab === t ? 'font-semibold text-ink' : 'text-muted hover:text-ink2'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === 'sessions'
          ? groupByWorkstream(harnesses, workstreams).map((group) => {
              const members = group.harnesses;
              if (members.length === 0) return null;
              const blocked = members.filter(
                (m) => m.status === 'waiting' || m.status === 'failed',
              ).length;
              const lead = members.find((m) => m.id === group.workstream?.leadHarnessId);
              const rest = members.filter((m) => m.id !== lead?.id);
              return (
                <div key={group.id} className="mb-3">
                  <div className="flex items-center justify-between px-1 pb-2 pt-1">
                    <SectionLabel>
                      {group.name} · {members.length}
                    </SectionLabel>
                    {blocked > 0 && (
                      <span className="font-mono text-[9.5px] text-danger">{blocked} blocked</span>
                    )}
                  </div>
                  {lead && (
                    <LeadCard
                      harness={lead}
                      focused={lead.id === focusId}
                      onFocus={() => { onFocus(lead.id); }}
                    />
                  )}
                  <div className="flex flex-col gap-1.5">
                    {rest.map((h) => (
                      <RosterRow
                        key={h.id}
                        harness={h}
                        focused={h.id === focusId}
                        onFocus={() => { onFocus(h.id); }}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          : <UsageTab harnesses={liveHarnesses(harnesses)} />}
      </div>

      {focus && (
        <div className="flex-none border-t border-line bg-[#131316] px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11.5px] font-semibold">Toolkit · {focusName}</span>
          </div>
          {tools.length === 0 ? (
            <p className="m-0 font-mono text-[10px] text-muted">No tools configured.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => { onAction('run-tool', focus); }}
                  className={`rounded-md border px-2.5 py-[7px] text-left text-[10.5px] font-medium text-ink2 transition-colors hover:border-edge ${
                    tool.needsApproval ? 'border-danger/25 bg-controlAlt' : 'border-line bg-controlAlt'
                  }`}
                >
                  ▷ {tool.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function LeadCard({
  harness,
  focused,
  onFocus,
}: {
  harness: Harness;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFocus}
      className={`mb-2 w-full rounded-lg border px-2.5 py-2.5 text-left ${
        focused ? 'border-accent/30 bg-accent/[.06]' : 'border-line bg-card'
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar seed={harness.name} size={28} />
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[12.5px] font-semibold ${focused ? 'text-accent-tint' : ''}`}
          >
            {harness.name}
          </div>
          <div
            className={`mt-0.5 font-mono text-[9.5px] ${focused ? 'text-accent-dim' : 'text-muted'}`}
          >
            {harness.status} · {plural(harness.childCount, 'child', 'children')} ·{' '}
            {duration(harness.idleMinutes)}
          </div>
        </div>
        <span className="flex-none font-mono text-[9.5px] font-medium text-accent">
          {harness.status === 'watching' ? 'watching' : ''}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Meter
          value={harness.contextUsed}
          color={statusColor(harness.status)}
          className="flex-1"
          track="rgba(255,255,255,.1)"
        />
        <span className="font-mono text-[9.5px] font-medium text-accent-dim">
          {percent(harness.contextUsed)} ctx
        </span>
      </div>
    </button>
  );
}

function RosterRow({
  harness,
  focused,
  onFocus,
}: {
  harness: Harness;
  focused: boolean;
  onFocus: () => void;
}) {
  const waiting = harness.status === 'waiting';
  return (
    <button
      type="button"
      onClick={onFocus}
      className={`flex w-full items-center gap-2.5 rounded-[7px] border px-2.5 py-2 text-left ${
        waiting
          ? 'border-warn/25 bg-warn/5'
          : focused
            ? 'border-edge bg-raised'
            : 'border-white/5 bg-[#171719]'
      }`}
    >
      <Avatar seed={harness.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-semibold">{harness.name}</div>
        <div
          className={`mt-0.5 font-mono text-[9.5px] ${waiting ? 'text-warn' : 'text-muted'}`}
        >
          {waiting ? (
            <>⧗ waiting on you · {duration(harness.idleMinutes)}</>
          ) : (
            <>
              <span style={{ color: statusColor(harness.status) }}>●</span> {harness.status}
              {harness.latestPulseSeq != null ? ` · #${String(harness.latestPulseSeq)}` : ''}
            </>
          )}
        </div>
      </div>
      {waiting ? (
        <span className="flex-none font-mono text-[9.5px] font-medium text-warn">reply</span>
      ) : (
        <div className="flex-none text-right">
          <div className="flex items-center gap-1.5">
            <Meter
              value={harness.contextUsed}
              color={harness.contextUsed > 0.5 ? '#e5c04a' : '#4ec97a'}
              className="w-[38px]"
            />
            <span className="font-mono text-[9.5px] font-medium text-ink3">
              {percent(harness.contextUsed)}
            </span>
          </div>
          <div className="mt-[3px] font-mono text-[9px] text-faint">
            {harness.model} · {money(harness.spend)}
          </div>
        </div>
      )}
    </button>
  );
}

function UsageTab({ harnesses }: { harnesses: Harness[] }) {
  const ranked = [...harnesses].sort((a, b) => b.spend - a.spend).slice(0, 12);
  const top = ranked[0]?.spend ?? 1;
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel className="px-1 pb-1">Spend by harness</SectionLabel>
      {ranked.map((h) => (
        <div key={h.id} className="flex items-center gap-2.5 px-1 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink2">{h.name}</span>
          <Meter
            value={top > 0 ? h.spend / top : 0}
            color={h.status === 'failed' ? '#e5675b' : '#5b9dff'}
            height={4}
            className="w-[110px]"
          />
          <span className="w-12 text-right font-mono text-[10.5px] text-ink">{money(h.spend)}</span>
        </div>
      ))}
    </div>
  );
}
