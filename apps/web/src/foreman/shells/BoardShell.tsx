import { useState } from 'react';
import type {
  ActivityEntry,
  Harness,
  Intervention,
  Objective,
  ObjectivePhase,
  Workstream,
} from '../types.js';
import type { ObjectiveState } from '../data/api.js';
import { groupByWorkstream } from '../data/useForeman.js';
import type { ResolveAction } from '../data/api.js';
import {
  Avatar,
  capRatio,
  clamp01,
  Meter,
  PulseSparkline,
  SectionLabel,
  StatusDot,
} from '../ui/primitives.js';
import { ago, duration, money, percent } from '../ui/format.js';

/**
 * Shell 1b — Ops board.
 *
 * The objective is the page. Fleet sits in workstream lanes and every card
 * carries its last twelve pulses, so a flatlining harness reads as a shape
 * rather than a status word.
 */
export function BoardShell({
  state,
  onFocus,
  onResolve,
  onResolveCard,
  onOpenLane,
  onToggleWorkstream,
}: {
  state: ObjectiveState;
  onFocus: (id: string) => void;
  onResolve: (intervention: Intervention, action: ResolveAction) => void;
  onResolveCard: (harness: Harness, action: 'reply' | 'raise-cap' | 'logs' | 'reassign') => void;
  onOpenLane: (workstreamId: string) => void;
  onToggleWorkstream: (workstream: Workstream) => void;
}) {
  const { objective, harnesses, workstreams, interventions, activity } = state;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas text-ink">
      <ObjectiveHeader objective={objective} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {groupByWorkstream(harnesses, workstreams).map((group) => (
            <Lane
              key={group.id}
              name={group.name}
              workstream={group.workstream}
              harnesses={group.harnesses}
              leadName={
                harnesses.find((h) => h.id === group.workstream?.leadHarnessId)?.name ?? null
              }
              onFocus={onFocus}
              onResolveCard={onResolveCard}
              onOpenLane={() => { if (group.workstream) onOpenLane(group.workstream.id); }}
              onToggle={() => { if (group.workstream) onToggleWorkstream(group.workstream); }}
            />
          ))}
        </div>
        <NeedsYouRail
          interventions={interventions}
          activity={activity}
          onResolve={onResolve}
          onFocus={onFocus}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function ObjectiveHeader({ objective }: { objective: Objective }) {
  const { stats } = objective;
  // The bar splits into landed work and work currently in flight.
  const inFlight =
    objective.ticketsTotal > 0
      ? Math.max(0, Math.min(1 - clamp01(objective.progress), stats.running / objective.ticketsTotal))
      : 0;
  const spendRatio = capRatio(objective.spendToday, objective.spendCap);

  return (
    <div className="flex-none border-b border-line bg-rail px-[22px] pb-4 pt-5">
      <div className="flex items-start gap-6">
        <div className="min-w-[300px]">
          <SectionLabel>
            Objective
            {objective.daysLeft != null ? ` · ${String(objective.daysLeft)} days left` : ''}
          </SectionLabel>
          <h2 className="m-0 mt-2 text-[23px] font-semibold leading-tight">{objective.name}</h2>
          <div className="mt-3 flex items-center gap-2.5">
            <div className="flex h-1.5 w-[190px] overflow-hidden rounded-full bg-trackDim">
              <div
                style={{ width: `${String(clamp01(objective.progress) * 100)}%`, background: '#4ec97a' }}
              />
              <div
                style={{ width: `${String(clamp01(inFlight) * 100)}%`, background: '#5b9dff' }}
              />
            </div>
            <span className="font-mono text-[12px] font-semibold">
              {percent(objective.progress)}
            </span>
            <span className="font-mono text-[10.5px] text-muted">
              of {objective.ticketsTotal} tickets
            </span>
          </div>
        </div>

        <div className="flex flex-1 gap-2.5">
          <Stat label="Running" value={String(stats.running)} note={stats.runningDelta} noteTone="ok" />
          <Stat
            label="Blocked"
            value={String(stats.blocked)}
            valueTone={stats.blocked > 0 ? 'warn' : undefined}
            note={stats.blockedNeedingYou > 0 ? `${String(stats.blockedNeedingYou)} need you` : null}
            noteTone="warn"
          />
          <Stat
            label="Merged today"
            value={String(stats.mergedToday)}
            note={
              stats.awaitingReview > 0 ? `${String(stats.awaitingReview)} awaiting review` : null
            }
          />
          <Stat label="Spend today" value={money(objective.spendToday)}>
            {spendRatio != null && objective.spendCap != null && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Meter
                  value={spendRatio}
                  color={spendRatio > 1 ? '#e5675b' : '#5b9dff'}
                  className="flex-1"
                  track="#25252c"
                />
                <span className="font-mono text-[9px] text-muted">
                  /{money(objective.spendCap)}
                </span>
              </div>
            )}
          </Stat>
        </div>
      </div>

      {objective.phases.length > 0 && <PhaseSpine phases={objective.phases} />}
    </div>
  );
}

function Stat({
  label,
  value,
  valueTone,
  note,
  noteTone,
  children,
}: {
  label: string;
  value: string;
  valueTone?: 'warn' | 'danger';
  note?: string | null;
  noteTone?: 'ok' | 'warn';
  children?: React.ReactNode;
}) {
  const valueClass =
    valueTone === 'warn' ? 'text-warn' : valueTone === 'danger' ? 'text-danger' : '';
  const noteClass = noteTone === 'ok' ? 'text-ok' : noteTone === 'warn' ? 'text-warn' : 'text-muted';
  return (
    <div className="flex-1 rounded-lg border border-hair bg-card px-3.5 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[.07em] text-faint">
        {label}
      </div>
      <div className={`mt-1.5 text-[22px] font-semibold ${valueClass}`}>{value}</div>
      {note && <div className={`mt-1 font-mono text-[9.5px] ${noteClass}`}>{note}</div>}
      {children}
    </div>
  );
}

function PhaseSpine({ phases }: { phases: ObjectivePhase[] }) {
  const tone: Record<ObjectivePhase['state'], { bg: string; title: string; detail: string }> = {
    done: { bg: 'rgba(78,201,122,.1)', title: 'text-ok-tint', detail: 'text-muted' },
    active: { bg: 'rgba(232,150,60,.1)', title: 'text-accent-tint', detail: 'text-accent-dim' },
    pending: { bg: '#17171b', title: 'text-ink3', detail: 'text-faint' },
  };
  return (
    <div className="mt-4 flex overflow-hidden rounded-[7px] border border-line">
      {phases.map((p, i) => (
        <div
          key={p.name}
          className={`px-3 py-2 ${i < phases.length - 1 ? 'border-r border-line' : ''}`}
          style={{ flex: p.weight, background: tone[p.state].bg }}
        >
          <div className={`text-[10.5px] font-semibold ${tone[p.state].title}`}>
            {p.name}
            {p.state === 'done' ? ' · done' : p.state === 'active' ? ' · in progress' : ''}
          </div>
          <div className={`mt-0.5 font-mono text-[9.5px] ${tone[p.state].detail}`}>{p.detail}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- lanes */

const LANE_VISIBLE = 4;

function Lane({
  name,
  workstream,
  harnesses,
  leadName,
  onFocus,
  onResolveCard,
  onOpenLane,
  onToggle,
}: {
  name: string;
  /** Null for the synthetic "Unassigned" lane, which cannot be paused. */
  workstream: Workstream | null;
  harnesses: Harness[];
  leadName: string | null;
  onFocus: (id: string) => void;
  onResolveCard: (harness: Harness, action: 'reply' | 'raise-cap' | 'logs' | 'reassign') => void;
  onOpenLane: () => void;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const spend = harnesses.reduce((sum, h) => sum + h.spend, 0);
  const paused = workstream?.paused ?? false;
  const shown = expanded ? harnesses : harnesses.slice(0, LANE_VISIBLE);
  const overflow = harnesses.length - shown.length;

  return (
    <section className="mb-5">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot status={paused ? 'paused' : (workstream?.status ?? 'ready')} size={7} />
          <span className={`text-[12.5px] font-semibold ${paused ? 'text-ink3' : ''}`}>{name}</span>
          <span className="font-mono text-[10.5px] text-muted">
            {harnesses.length} agents
            {paused ? ' · paused' : leadName ? ` · ${leadName}` : ''}
            {paused ? '' : ` · ${money(spend)}`}
          </span>
        </div>
        {workstream && (
          <button
            type="button"
            onClick={paused ? onToggle : onOpenLane}
            className="font-mono text-[10.5px] text-muted hover:text-ink2"
          >
            {paused ? 'resume lane' : 'open lane →'}
          </button>
        )}
      </div>

      {paused ? (
        <div className="flex h-14 items-center rounded-lg border border-dashed border-strong px-3.5 font-mono text-[11px] text-faint">
          {workstream?.pausedNote ??
            `${String(harnesses.length)} harnesses paused — collapsed`}
        </div>
      ) : (
        <div
          className="grid gap-2.5"
          style={{
            gridTemplateColumns: `repeat(${String(LANE_VISIBLE)},minmax(0,1fr))${overflow > 0 ? ' 88px' : ''}`,
          }}
        >
          {shown.map((h) => (
            <HarnessCard
              key={h.id}
              harness={h}
              onFocus={() => { onFocus(h.id); }}
              onResolve={onResolveCard}
            />
          ))}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => { setExpanded(true); }}
              className="rounded-lg border border-dashed border-strong text-center text-[11px] font-medium text-muted hover:text-ink2"
            >
              +{overflow} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function HarnessCard({
  harness,
  onFocus,
  onResolve,
}: {
  harness: Harness;
  onFocus: () => void;
  onResolve: (harness: Harness, action: 'reply' | 'raise-cap' | 'logs' | 'reassign') => void;
}) {
  const waiting = harness.status === 'waiting';
  const failed = harness.status === 'failed';
  const border = waiting
    ? 'border-warn/25 bg-warn/5'
    : failed
      ? 'border-danger/25 bg-danger/5'
      : 'border-line bg-card';

  return (
    <div
      className={`min-w-0 rounded-lg border p-3 transition-colors hover:border-edge ${border}`}
    >
      <button type="button" onClick={onFocus} className="w-full text-left">
      <div className="flex items-center gap-2">
        <Avatar seed={harness.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold">{harness.name}</span>
        {waiting ? (
          <span className="font-mono text-[9px] font-medium text-warn">
            {duration(harness.idleMinutes)}
          </span>
        ) : failed ? (
          <span className="font-mono text-[9px] font-medium text-danger">failed</span>
        ) : (
          <StatusDot status={harness.status} />
        )}
      </div>

      <div
        className={`mt-2.5 h-8 overflow-hidden text-[11px] leading-[1.45] ${
          waiting ? 'text-warn-tint' : failed ? 'text-danger-tint' : 'text-ink3'
        }`}
      >
        {harness.activity}
      </div>

      <div className="mt-2.5">
        <PulseSparkline
          pulses={harness.recentPulses.map((p) => ({ weight: p.weight, outcome: p.outcome }))}
        />
      </div>

      </button>

      {waiting || failed ? (
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => { onResolve(harness, waiting ? 'reply' : 'raise-cap'); }}
            className={`flex-1 rounded-[5px] border px-0 py-1 text-center text-[10px] font-semibold ${
              waiting
                ? 'border-warn/30 bg-warn/[.14] text-warn'
                : 'border-danger/30 bg-danger/[.14] text-danger'
            }`}
          >
            {waiting ? 'Reply' : 'Raise cap'}
          </button>
          <button
            type="button"
            onClick={() => { onResolve(harness, waiting ? 'reassign' : 'logs'); }}
            className="flex-1 rounded-[5px] border border-line bg-controlAlt py-1 text-center text-[10px] font-medium text-ink3 hover:border-edge"
          >
            {waiting ? 'Reassign' : 'Logs'}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-between font-mono text-[9.5px] text-faint">
          <span>
            {percent(harness.contextUsed)} ctx ·{' '}
            {harness.childCount > 0
              ? `${String(harness.childCount)} children`
              : harness.latestPulseSeq != null
                ? `#${String(harness.latestPulseSeq)}`
                : 'no pulses'}
          </span>
          <span>{money(harness.spend)}</span>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- right rail */

function NeedsYouRail({
  interventions,
  activity,
  onResolve,
  onFocus,
}: {
  interventions: Intervention[];
  activity: ActivityEntry[];
  onResolve: (intervention: Intervention, action: ResolveAction) => void;
  onFocus: (id: string) => void;
}) {
  return (
    <aside className="w-[308px] flex-none overflow-y-auto border-l border-line bg-rail px-3.5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Needs you</span>
        {interventions.length > 0 && (
          <span className="rounded-full bg-warn px-[7px] py-0.5 font-mono text-[10px] font-semibold text-[#16161a]">
            {interventions.length}
          </span>
        )}
      </div>

      {interventions.length === 0 ? (
        <p className="m-0 rounded-lg border border-hair bg-card px-3 py-3 text-[11.5px] text-muted">
          Nothing is waiting on you.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {interventions.map((item) => (
            <InterventionCard
              key={item.id}
              item={item}
              onResolve={onResolve}
              onFocus={() => { onFocus(item.harnessId); }}
            />
          ))}
        </div>
      )}

      {activity.length > 0 && (
        <div className="mt-5 border-t border-line pt-3.5">
          <SectionLabel className="mb-2.5">Recent</SectionLabel>
          <div className="flex flex-col gap-2 font-mono text-[10.5px] leading-[1.45] text-muted">
            {activity.map((a) => (
              <div key={a.id}>
                <span className={ACTIVITY_TONE[a.verb]}>{a.verb}</span> {a.text} · {ago(a.at)}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

const ACTIVITY_TONE: Record<ActivityEntry['verb'], string> = {
  merged: 'text-ok-tint',
  spawned: 'text-info-tint',
  paused: 'text-warn-tint',
  failed: 'text-danger-tint',
  retired: 'text-muted',
};

const KIND_TONE: Record<Intervention['kind'], { label: string; text: string; border: string }> = {
  approval: { label: 'APPROVAL', text: 'text-danger', border: 'border-danger/25' },
  question: { label: 'DECISION', text: 'text-warn', border: 'border-warn/25' },
  budget: { label: 'BUDGET', text: 'text-info', border: 'border-line' },
};

function InterventionCard({
  item,
  onResolve,
  onFocus,
}: {
  item: Intervention;
  onResolve: (intervention: Intervention, action: ResolveAction) => void;
  onFocus: () => void;
}) {
  const tone = KIND_TONE[item.kind];
  return (
    <div className={`rounded-lg border bg-card px-3 py-3 ${tone.border}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`font-mono text-[9.5px] font-medium ${tone.text}`}>{tone.label}</span>
        <span className="ml-auto font-mono text-[9.5px] text-faint">{ago(item.createdAt)}</span>
      </div>
      <div className="text-[11.5px] font-semibold leading-[1.4]">{item.title}</div>
      {item.detail && (
        <div className="mt-1.5 text-[10.5px] leading-[1.45] text-ink3">{item.detail}</div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {item.kind === 'approval' && (
          <>
            <MiniButton tone="ok" onClick={() => { onResolve(item, 'approve'); }}>
              Approve
            </MiniButton>
            <MiniButton onClick={() => { onResolve(item, 'deny'); }}>Deny</MiniButton>
          </>
        )}
        {item.kind === 'question' && (
          <MiniButton tone="primary" onClick={onFocus}>
            Reply
          </MiniButton>
        )}
        {item.kind === 'budget' && (
          <>
            <MiniButton tone="primary" onClick={() => { onResolve(item, 'raise-cap'); }}>
              Raise to {money(item.budget?.suggestedCap ?? 0)}
            </MiniButton>
            <MiniButton onClick={() => { onResolve(item, 'retire'); }}>Retire</MiniButton>
          </>
        )}
        <MiniButton onClick={onFocus}>Open session</MiniButton>
      </div>
    </div>
  );
}

function MiniButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'ok' | 'primary';
}) {
  const cls =
    tone === 'ok'
      ? 'border-ok/30 bg-ok/[.14] text-ok-tint font-semibold'
      : tone === 'primary'
        ? 'border-edge bg-raised text-ink font-semibold'
        : 'border-hair bg-control text-ink3 font-medium';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[5px] border px-2.5 py-1 text-[10px] transition-colors hover:border-edge ${cls}`}
    >
      {children}
    </button>
  );
}
