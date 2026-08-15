import type { ReactNode } from 'react';
import type { HarnessStatus, PulseOutcome } from '../types.js';

/**
 * The visual vocabulary shared by all three shells and the supporting surfaces.
 * Status colour is decided here once so a harness reads the same in the tree,
 * on a board card, and as a node on the graph.
 */

const STATUS_COLOR: Record<HarnessStatus, string> = {
  working: '#4ec97a',
  watching: '#e8963c',
  waiting: '#e5c04a',
  failed: '#e5675b',
  paused: '#3d3d45',
  ready: '#565660',
  retired: '#2b2b33',
};

const STATUS_TEXT: Record<HarnessStatus, string> = {
  working: 'text-ok',
  watching: 'text-accent',
  waiting: 'text-warn',
  failed: 'text-danger',
  paused: 'text-muted',
  ready: 'text-faint',
  retired: 'text-faint',
};

export function statusColor(status: HarnessStatus): string {
  return STATUS_COLOR[status];
}

export function statusTextClass(status: HarnessStatus): string {
  return STATUS_TEXT[status];
}

/** A harness's state as a single dot. Live states breathe; settled ones don't. */
export function StatusDot({
  status,
  size = 6,
  pulse,
}: {
  status: HarnessStatus;
  size?: number;
  pulse?: boolean;
}) {
  const live = pulse ?? (status === 'watching' || status === 'waiting');
  return (
    <span
      role="img"
      aria-label={status}
      className={`flex-none rounded-full ${live ? 'animate-bp' : ''}`}
      style={{ width: size, height: size, background: statusColor(status) }}
    />
  );
}

/** Horizontal fraction bar — context used, objective progress, spend against cap. */
export function Meter({
  value,
  color = '#4ec97a',
  height = 3,
  className = '',
  track = '#2a2a32',
}: {
  /** 0..1. Values outside the range are clamped so a blown budget still renders full. */
  value: number;
  color?: string;
  height?: number;
  className?: string;
  track?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div
      className={`overflow-hidden rounded-sm ${className}`}
      style={{ height, background: track }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${String(pct)}%`, height: '100%', background: color }} />
    </div>
  );
}

/** A slider-style readout: filled track with a knob, used for heartbeat and caps. */
export function SliderReadout({
  value,
  label,
}: {
  /** 0..1 position of the knob. */
  value: number;
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-[3px] flex-1 rounded-sm bg-track">
        <div className="h-full rounded-sm bg-info" style={{ width: `${String(pct)}%` }} />
        <div
          className="absolute -top-1 h-[11px] w-[11px] rounded-full bg-ink"
          style={{ left: `calc(${String(pct)}% - 5.5px)` }}
        />
      </div>
      <span className="font-mono text-[10.5px] font-medium text-ink3">{label}</span>
    </div>
  );
}

/**
 * The last N pulses as bars. Height encodes how much the harness did that pulse;
 * colour encodes how it went — so a flatlining or failing agent reads at a glance.
 */
export function PulseSparkline({
  pulses,
  height = 20,
  count = 12,
}: {
  /** Newest first, matching `Harness.recentPulses`; reversed here for display. */
  pulses: { weight: number; outcome: PulseOutcome }[];
  height?: number;
  count?: number;
}) {
  const fill: Record<PulseOutcome, string> = {
    ok: '#4ec97a',
    warn: '#e8963c',
    fail: '#e5675b',
    idle: '#3a4a3e',
  };
  // Oldest on the left; pad the left with idle so a young harness doesn't stretch.
  const tail = pulses.slice(0, count).reverse();
  const padded = [
    ...Array.from({ length: Math.max(0, count - tail.length) }, () => ({
      weight: 0.14,
      outcome: 'idle' as const,
    })),
    ...tail,
  ];
  return (
    <div className="flex items-end gap-[2px]" style={{ height }} aria-hidden="true">
      {padded.map((p, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${String(Math.max(10, Math.min(100, p.weight * 100)))}%`,
            background: fill[p.outcome],
          }}
        />
      ))}
    </div>
  );
}

/**
 * Context-window usage drawn as a ring, for graph nodes where there's no room
 * for a bar. The arc sweeps clockwise from 12 o'clock.
 */
export function ContextRing({
  fraction,
  status,
  size = 15,
  stroke = 2,
}: {
  fraction: number;
  status: HarnessStatus;
  size?: number;
  stroke?: number;
}) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="flex-none"
      role="img"
      aria-label={`${String(Math.round(f * 100))}% context used`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a32" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={statusColor(status)}
        strokeWidth={stroke}
        strokeDasharray={`${String(c * f)} ${String(c)}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
      />
    </svg>
  );
}

/** Mono micro-heading that labels every block in the design. */
export function SectionLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-faint ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonTone = 'primary' | 'accent' | 'secondary' | 'ok' | 'warn' | 'danger';

const BUTTON_TONE: Record<ButtonTone, string> = {
  primary: 'bg-raised border-edge text-ink font-semibold',
  accent: 'bg-accent border-accent text-[#1a1108] font-semibold',
  secondary: 'bg-control border-line text-ink2 font-medium',
  ok: 'bg-ok/15 border-ok/30 text-ok-tint font-semibold',
  warn: 'bg-warn/15 border-warn/30 text-warn font-semibold',
  danger: 'bg-danger/15 border-danger/30 text-danger font-semibold',
};

export function Button({
  children,
  tone = 'secondary',
  onClick,
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_TONE[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Small status/label chip. */
export function Pill({
  children,
  color,
  className = '',
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  const style = color
    ? { color, background: `${color}1a`, borderColor: `${color}4d` }
    : undefined;
  return (
    <span
      style={style}
      className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium ${color ? '' : 'border-line bg-control text-muted'} ${className}`}
    >
      {children}
    </span>
  );
}

/** Bordered surface used for every panel in the shells. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-[9px] border border-line bg-panel ${className}`}>
      {children}
    </div>
  );
}

/**
 * Deterministic avatar tint for a harness. The wireframes give each agent a
 * distinct muted square; deriving it from the name keeps it stable across views.
 */
const AVATAR_TINTS = [
  '#26263a',
  '#243228',
  '#332e20',
  '#2a2438',
  '#382a2a',
  '#203038',
  '#2e2438',
  '#24382c',
  '#33262a',
  '#3a2626',
];

export function avatarTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function Avatar({ seed, size = 26 }: { seed: string; size?: number }) {
  return (
    <div
      className="flex-none rounded-md"
      style={{ width: size, height: size, background: avatarTint(seed) }}
      aria-hidden="true"
    />
  );
}

/**
 * Fraction of a cap, or null when the cap cannot express one.
 *
 * A zero, negative or missing cap must NOT collapse to 0 — an empty meter reads
 * as "nothing spent", the opposite of a blown budget. Callers hide the meter
 * instead of drawing a misleading one.
 */
export function capRatio(value: number, cap: number | null | undefined): number | null {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return null;
  if (!Number.isFinite(value)) return null;
  return value / cap;
}

/** Clamp an externally-supplied fraction before it becomes a CSS width. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
