import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Harness, HarnessStatus, Pulse } from '../types.js';
import type { ObjectiveState } from '../data/api.js';
import { liveHarnesses } from '../data/useForeman.js';
import { layoutGraph, edgePath, type LaidOutNode } from './graph-layout.js';
import {
  capRatio,
  ContextRing,
  Meter,
  SectionLabel,
  StatusDot,
  statusColor,
} from '../ui/primitives.js';
import { ago, clock, duration, money, percent } from '../ui/format.js';
import { useVocabulary } from '../usecases/vocabulary.js';

/**
 * Shell 1c — Topology.
 *
 * The hierarchy is the canvas: the objective is the root and every spawn
 * descends from it. Status is the ring on each node; the inspector opens
 * without leaving the map, and the scrubber replays the fleet as it was.
 */
export function GraphShell({
  state,
  focusId,
  onFocus,
  onAction,
}: {
  state: ObjectiveState;
  focusId: string | null;
  onFocus: (id: string) => void;
  onAction: (action: 'reply' | 'pause-subtree' | 'spawn-child', harness: Harness) => void;
}) {
  const { objective, harnesses } = state;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | HarnessStatus>('all');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Once the operator pans or zooms, stop re-fitting under them.
  const [adjusted, setAdjusted] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [rewindMinutes, setRewindMinutes] = useState(0);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const visible = useMemo(() => {
    const fleet = liveHarnesses(harnesses);
    return statusFilter === 'all' ? fleet : fleet.filter((h) => h.status === statusFilter);
  }, [harnesses, statusFilter]);

  const layout = useMemo(
    () => layoutGraph(objective, visible, collapsed),
    [objective, visible, collapsed],
  );

  // The scrub position as an absolute instant; nodes with no activity before it
  // are dimmed rather than removed, so the shape of the fleet stays readable.
  const asOf = rewindMinutes === 0 ? null : Date.now() - rewindMinutes * 60_000;

  const focus = harnesses.find((h) => h.id === focusId) ?? null;

  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || layout.width <= 0 || layout.height <= 0) return;
    // Leave room for the scrubber and a small margin.
    const next = Math.min(1, (box.width - 48) / layout.width, (box.height - 120) / layout.height);
    setZoom(Math.max(0.35, next));
    setPan({ x: 0, y: 0 });
  }, [layout.width, layout.height]);

  // Fit whenever the fleet's extent changes, until the operator takes over —
  // otherwise a wide fleet renders with whole workstreams off-screen.
  useLayoutEffect(() => {
    if (adjusted) return;
    fit();
  }, [fit, adjusted]);

  useEffect(() => {
    if (adjusted) return;
    const onResize = () => { fit(); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, [fit, adjusted]);

  // pointercancel (touch/pen, or a browser-initiated cancel) fires instead of
  // pointerup; without this the canvas keeps following the cursor afterwards.
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  return (
    <div className="flex min-h-0 flex-1 bg-canvas text-ink">
      <div className="flex w-[52px] flex-none flex-col items-center gap-2 border-r border-line bg-rail py-3">
        {(['all', 'working', 'waiting', 'failed', 'paused'] as const).map((s) => (
          <button
            key={s}
            type="button"
            title={s === 'all' ? 'All harnesses' : s}
            onClick={() => { setStatusFilter(s); }}
            className={`flex h-7 w-7 items-center justify-center rounded-md border ${
              statusFilter === s ? 'border-accent/30 bg-raised' : 'border-transparent bg-card'
            }`}
          >
            {s === 'all' ? (
              <span className="font-mono text-[10px] text-ink3">all</span>
            ) : (
              <StatusDot status={s} size={8} pulse={false} />
            )}
          </button>
        ))}
      </div>

      <div ref={viewport} className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,.055) 1px,transparent 1px)',
            backgroundSize: '26px 26px',
          }}
          onPointerDown={(e) => {
            // Only the canvas background starts a pan; pressing a node must not
            // arm one, or a 2px jitter while selecting drags the whole graph.
            if (e.target !== e.currentTarget) return;
            drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
            setAdjusted(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) });
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${String(pan.x + 24)}px, ${String(pan.y + 12)}px) scale(${String(zoom)})`,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              {layout.edges.map(({ id, from, to }) => (
                <path
                  key={id}
                  d={edgePath(from, to)}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={to.harness?.status === 'paused' ? '4 4' : undefined}
                  stroke={edgeColor(to.harness?.status)}
                />
              ))}
            </svg>

            {layout.nodes.map((node) =>
              node.objective ? (
                <ObjectiveNode key={node.id} node={node} />
              ) : (
                <HarnessNodeCard
                  key={node.id}
                  node={node}
                  focused={node.id === focusId}
                  dimmed={isDimmed(node.harness, asOf)}
                  onFocus={() => { onFocus(node.id); }}
                  onToggle={() => { toggleCollapse(node.id); }}
                />
              ),
            )}
          </div>
        </div>

        <Legend />

        <div className="absolute bottom-[76px] right-4 flex flex-col gap-1.5">
          {[
            {
              label: '+',
              act: () => {
                setAdjusted(true);
                setZoom((z) => Math.min(2, z + 0.15));
              },
            },
            {
              label: '−',
              act: () => {
                setAdjusted(true);
                setZoom((z) => Math.max(0.35, z - 0.15));
              },
            },
            // Fit to the fleet rather than snapping to 1:1, which on a wide
            // fleet just re-hides the right-hand workstreams.
            { label: '⤢', act: () => { setAdjusted(false); fit(); } },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.act}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hair bg-card/90 font-mono text-[12px] text-ink3 hover:text-ink"
            >
              {b.label}
            </button>
          ))}
        </div>

        <Scrubber
          harnesses={harnesses}
          rewindMinutes={rewindMinutes}
          onRewind={setRewindMinutes}
        />
      </div>

      {focus && (
        <Inspector harness={focus} onClose={() => { onFocus(''); }} onAction={onAction} />
      )}
    </div>
  );
}

function edgeColor(status: HarnessStatus | undefined): string {
  switch (status) {
    case 'working':
    case 'watching':
      return 'rgba(78,201,122,.32)';
    case 'waiting':
      return 'rgba(229,192,74,.32)';
    case 'failed':
      return 'rgba(229,103,91,.35)';
    case 'paused':
      return 'rgba(255,255,255,.08)';
    default:
      return 'rgba(255,255,255,.13)';
  }
}

/**
 * Dim a harness that had not started yet at the scrub instant.
 *
 * `recentPulses` is newest-first, so the OLDEST known pulse is the last entry:
 * if even that is after `asOf`, the harness didn't exist yet. Testing the
 * newest pulse instead dims every actively-working harness — backwards.
 */
function isDimmed(harness: Harness | null, asOf: number | null): boolean {
  if (!harness || asOf == null) return false;
  const oldest = harness.recentPulses.at(-1);
  if (!oldest) return true;
  const t = Date.parse(oldest.startedAt);
  return Number.isFinite(t) && t > asOf;
}

function ObjectiveNode({ node }: { node: LaidOutNode }) {
  const o = node.objective;
  if (!o) return null;
  return (
    <div
      className="absolute rounded-[9px] border border-accent/30 bg-[#1a1a20] px-3 py-2.5 shadow-[0_4px_18px_rgba(0,0,0,.4)]"
      style={{ left: node.x, top: node.y, width: node.width }}
    >
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[.07em] text-accent-dim">
        Objective
      </div>
      <div className="mt-1 truncate text-[12.5px] font-semibold">{o.name}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Meter value={o.progress} color="#e8963c" className="flex-1" />
        <span className="font-mono text-[9px] font-medium text-ink3">{percent(o.progress)}</span>
      </div>
    </div>
  );
}

function HarnessNodeCard({
  node,
  focused,
  dimmed,
  onFocus,
  onToggle,
}: {
  node: LaidOutNode;
  focused: boolean;
  dimmed: boolean;
  onFocus: () => void;
  onToggle: () => void;
}) {
  const h = node.harness;
  if (!h) return null;
  const paused = h.status === 'paused';
  const waiting = h.status === 'waiting';
  const failed = h.status === 'failed';
  const compact = node.depth >= 2;

  const border = focused
    ? 'border-[1.5px] border-accent shadow-[0_0_0_4px_rgba(232,150,60,.08)]'
    : waiting
      ? 'border border-warn/30'
      : failed
        ? 'border border-danger/30'
        : paused
          ? 'border border-dashed border-strong'
          : 'border border-edge';

  const bg = focused
    ? 'bg-accent/[.09]'
    : waiting
      ? 'bg-warn/5'
      : failed
        ? 'bg-danger/[.06]'
        : paused
          ? 'bg-[#141417]'
          : 'bg-card';

  return (
    <div
      className={`absolute rounded-lg ${border} ${bg} ${dimmed ? 'opacity-30' : ''}`}
      style={{ left: node.x, top: node.y, width: node.width }}
    >
      <button
        type="button"
        onClick={onFocus}
        className="block w-full px-2.5 py-2 text-left"
        style={{ minHeight: node.height }}
      >
        <div className="flex items-center gap-1.5">
          <ContextRing
            fraction={h.contextUsed}
            status={h.status}
            size={compact ? 12 : 15}
            stroke={2}
          />
          <span
            className={`min-w-0 flex-1 truncate ${
              compact ? 'font-mono text-[10px]' : 'text-[11.5px] font-semibold'
            } ${focused ? 'text-accent-tint' : waiting ? 'text-warn' : failed ? 'text-danger' : paused ? 'text-ink4' : ''}`}
            title={h.name}
          >
            {h.name}
          </span>
        </div>
        <div
          className={`mt-1.5 font-mono text-[8.5px] ${
            waiting ? 'text-warn-dim' : failed ? 'text-danger-dim' : 'text-faint'
          }`}
        >
          {waiting
            ? `waiting on you · ${duration(h.idleMinutes)}`
            : failed
              ? 'failed'
              : paused
                ? `paused · ${String(node.childCount)}`
                : `${percent(h.contextUsed)} · ${money(h.spend)}`}
        </div>
      </button>
      {node.childCount > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={node.collapsed ? 'Expand children' : 'Collapse children'}
          className="absolute bottom-1 right-1.5 font-mono text-[9px] text-muted hover:text-ink2"
        >
          {node.collapsed ? `▸${String(node.childCount)}` : `▾${String(node.childCount)}`}
        </button>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-[76px] left-4 rounded-lg border border-hair bg-rail/90 px-3 py-2.5">
      <SectionLabel className="mb-2">Ring = context used</SectionLabel>
      <div className="flex flex-col gap-1.5 font-mono text-[9.5px] text-ink3">
        {(
          [
            ['working', 'working'],
            ['waiting', 'waiting on you'],
            ['failed', 'failed'],
            ['paused', 'paused'],
          ] as const
        ).map(([status, label]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusColor(status) }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

const REWIND_MAX = 360;

function Scrubber({
  harnesses,
  rewindMinutes,
  onRewind,
}: {
  harnesses: Harness[];
  rewindMinutes: number;
  onRewind: (m: number) => void;
}) {
  // Ticks mark notable pulses in the window, so scrubbing has landmarks.
  const marks = useMemo(() => {
    const now = Date.now();
    const out: { left: number; color: string; key: string }[] = [];
    for (const h of harnesses) {
      for (const p of h.recentPulses) {
        if (p.outcome === 'ok') continue;
        const t = Date.parse(p.startedAt);
        if (!Number.isFinite(t)) continue;
        const minsAgo = (now - t) / 60000;
        if (minsAgo > REWIND_MAX || minsAgo < 0) continue;
        out.push({
          left: (1 - minsAgo / REWIND_MAX) * 100,
          color: p.outcome === 'fail' ? '#e5675b' : '#e5c04a',
          key: `${h.id}-${p.id}`,
        });
      }
    }
    return out.slice(0, 40);
  }, [harnesses]);

  const live = rewindMinutes === 0;

  return (
    <div className="absolute inset-x-0 bottom-0 h-[60px] border-t border-line bg-rail px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { onRewind(0); }}
          className={`rounded-full border px-2 py-[3px] font-mono text-[9.5px] font-semibold ${
            live ? 'border-ok/30 bg-ok/10 text-ok' : 'border-hair bg-control text-muted'
          }`}
        >
          ● LIVE
        </button>
        <div className="relative h-[22px] flex-1">
          <div className="absolute inset-x-0 top-2.5 h-0.5 bg-trackDim" />
          {marks.map((m) => (
            <div
              key={m.key}
              className="absolute top-1 h-3.5 w-0.5"
              style={{ left: `${String(m.left)}%`, background: m.color }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={REWIND_MAX}
            step={5}
            value={REWIND_MAX - rewindMinutes}
            onChange={(e) => { onRewind(REWIND_MAX - Number(e.target.value)); }}
            aria-label="Rewind the fleet"
            className="absolute inset-x-0 top-0 h-[22px] w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[3px] [&::-webkit-slider-thumb]:bg-ink"
          />
        </div>
        <span className="w-12 text-right font-mono text-[10px] text-muted">
          {live ? 'now' : `−${duration(rewindMinutes)}`}
        </span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-faint">
        <span>{clock(new Date(Date.now() - REWIND_MAX * 60000).toISOString())}</span>
        <span>{clock(new Date(Date.now() - (REWIND_MAX * 60000) / 2).toISOString())}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- inspector */

function Inspector({
  harness,
  onClose,
  onAction,
}: {
  harness: Harness;
  onClose: () => void;
  onAction: (action: 'reply' | 'pause-subtree' | 'spawn-child', harness: Harness) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'transcript' | 'tools' | 'cost'>('overview');

  return (
    <aside className="flex w-[340px] flex-none flex-col border-l border-line bg-rail">
      <div className="border-b border-hair p-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className="h-8 w-8 flex-none rounded-[7px]"
            style={{ background: statusColor(harness.status), opacity: 0.25 }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{harness.name}</div>
            <div className="mt-0.5 font-mono text-[9.5px] text-accent-dim">
              ● {harness.status}
              {harness.latestPulseSeq != null ? ` · pulse #${String(harness.latestPulseSeq)}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="font-mono text-[12px] text-muted hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="mt-3 flex gap-1.5">
          <InspectorButton onClick={() => { onAction('reply', harness); }} primary>
            Reply
          </InspectorButton>
          <InspectorButton onClick={() => { onAction('pause-subtree', harness); }}>
            Pause subtree
          </InspectorButton>
          <InspectorButton onClick={() => { onAction('spawn-child', harness); }}>
            Spawn child
          </InspectorButton>
        </div>
      </div>

      <div className="flex gap-3.5 border-b border-hair px-3.5 pt-3 text-[11px] font-medium">
        {(['overview', 'transcript', 'tools', 'cost'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); }}
            className={`border-b-2 pb-2.5 capitalize ${
              tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink2'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {tab === 'overview' && <OverviewTab harness={harness} />}
        {tab === 'transcript' && <PulseList pulses={harness.recentPulses} />}
        {tab === 'tools' && (
          <p className="m-0 text-[11.5px] text-muted">
            Open the Toolkit surface for {harness.name} to run an action.
          </p>
        )}
        {tab === 'cost' && <CostTab harness={harness} />}
      </div>
    </aside>
  );
}

function InspectorButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-[10.5px] transition-colors hover:border-edge ${
        primary
          ? 'border-edge bg-raised font-semibold text-ink'
          : 'border-hair bg-control font-medium text-ink3'
      }`}
    >
      {children}
    </button>
  );
}

function OverviewTab({ harness }: { harness: Harness }) {
  const rows: [string, string][] = [
    ['heartbeat', `every ${String(harness.heartbeatMinutes)}m`],
    ['children', `${String(harness.childCount)} / ${String(harness.maxChildren)} max`],
    ['model', harness.model],
    ['context', percent(harness.contextUsed)],
    [
      'spend',
      harness.spendCap != null
        ? `${money(harness.spend)} · cap ${money(harness.spendCap)}`
        : money(harness.spend),
    ],
    ['subtree spend', money(harness.subtreeSpend)],
  ];
  return (
    <>
      <SectionLabel className="mb-2">Mission</SectionLabel>
      <p className="m-0 mb-3.5 text-[12px] leading-relaxed text-ink2 [text-wrap:pretty]">
        {harness.mission}
      </p>
      <div className="overflow-hidden rounded-lg border border-hair">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={`flex justify-between px-3 py-2 font-mono text-[10.5px] ${
              i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'
            }`}
          >
            <span className="text-muted">{k}</span>
            <span className="text-ink2">{v}</span>
          </div>
        ))}
      </div>
      <SectionLabel className="mb-2 mt-4">Last pulses</SectionLabel>
      <PulseList pulses={harness.recentPulses.slice(0, 3)} />
    </>
  );
}

const PULSE_BORDER: Record<Pulse['outcome'], string> = {
  ok: '#4ec97a',
  warn: '#e5c04a',
  fail: '#e5675b',
  idle: '#3d3d45',
};

function PulseList({ pulses }: { pulses: Pulse[] }) {
  if (pulses.length === 0) {
    return <p className="m-0 text-[11.5px] text-muted">No pulses recorded yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {pulses.map((p) => (
        <div
          key={p.id}
          className="rounded-[7px] bg-card px-2.5 py-2"
          style={{ borderLeft: `2px solid ${PULSE_BORDER[p.outcome]}` }}
        >
          <div className="font-mono text-[10.5px] text-muted">
            #{p.seq} · {ago(p.startedAt)}
          </div>
          <div className="mt-1 text-[11px] leading-[1.45] text-ink2">
            {p.summary ?? <span className="text-faint">no summary recorded</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostTab({ harness }: { harness: Harness }) {
  const cap = harness.spendCap;
  const ratio = capRatio(harness.spend, cap);
  // The inspector's own heading for the thing in focus — a chrome-level label
  // the active shell may rename; see `usecases/vocabulary.tsx`.
  const words = useVocabulary();
  return (
    <>
      <SectionLabel className="mb-2">This {words.harness}</SectionLabel>
      <div className="mb-4 text-[21px] font-semibold">{money(harness.spend)}</div>
      {ratio != null && cap != null && (
        <>
          <Meter value={ratio} color={ratio > 0.9 ? '#e5675b' : '#5b9dff'} height={4} />
          <div className="mt-1.5 font-mono text-[9.5px] text-muted">of {money(cap)} cap</div>
        </>
      )}
      <SectionLabel className="mb-2 mt-5">Subtree</SectionLabel>
      <div className="text-[16px] font-semibold">{money(harness.subtreeSpend)}</div>
      <div className="mt-4 flex flex-col gap-1.5">
        {harness.recentPulses.slice(0, 8).map((p) => (
          <div key={p.id} className="flex justify-between font-mono text-[10px]">
            <span className="text-muted">
              #{p.seq} · {clock(p.startedAt)}
            </span>
            <span className="text-ink2">{money(p.cost)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
