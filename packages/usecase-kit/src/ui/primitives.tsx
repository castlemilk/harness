import type { ReactNode } from 'react';
import type { HarnessStatus } from '../state.js';

/**
 * The presentational primitives a use-case shell is allowed to reuse.
 *
 * These four components — `Panel`, `Pill`, `SectionLabel`, `StatusDot` — plus
 * the status colour they are decided by, are the visual vocabulary a domain tab
 * needs in order to look like part of Foreman rather than like a page someone
 * bolted on. They lived in the app (`apps/web/src/foreman/ui/primitives.tsx`)
 * while every shell lived in the app too; the moment a shell moved to another
 * repository, a relative import into the harness became impossible and the
 * choice was to duplicate them per plugin or to give them a home a plugin can
 * reach. This is that home, and the app now re-exports them from here so there
 * is exactly one definition of what a panel looks like.
 *
 * What deliberately did **not** move: `PulseSparkline`, `ContextRing`, `Meter`,
 * `SliderReadout`, `Avatar`, `Button`, `Modal`. Those render *Foreman's* own
 * concepts (a pulse history, a context window, a harness avatar) or are
 * interactive chrome the host owns the behaviour of. A shell that wants a chart
 * draws its own — Victoria does — and one that wants a button is asking for a
 * design system, which this is not.
 *
 * Styling is Tailwind class names and the harness palette (`bg-panel`,
 * `text-faint`, `border-line`). That is not an accident of implementation: it
 * is the contract. A plugin renders inside the harness's stylesheet, and
 * `tailwind.config.js` scans every configured plugin directory — including
 * out-of-tree ones — precisely so these classes survive the purge.
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

/** The palette a harness state is drawn in — one decision, every surface. */
export function statusColor(status: HarnessStatus): string {
  return STATUS_COLOR[status];
}

/** The same decision as a text class, for labels rather than marks. */
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
