/**
 * Time formatting, shared by the harness chrome and by shells.
 *
 * The four here are one family: `clock` reads an instant, `duration` reads a
 * span, `elapsed` reads a measured one, and `ago` is `duration` against now.
 * Victoria's Live and Trades tabs need `clock`; splitting one of the four out
 * and leaving its siblings behind would mean the next shell that wants "4m ago"
 * either writes a fifth formatter or reaches back into the app, and two
 * definitions of "how long is that" is exactly the drift this package exists to
 * prevent.
 *
 * What stays in the app: `money`, `moneyShort`, `percent`, `compactCount` and
 * `plural`. Money and percentages are where a domain's conventions differ —
 * Victoria wants grouped, signed dollars and *unclamped* percentages, which is
 * not what the core chrome wants — so a shell brings its own (see
 * `victoria/format.ts`). Time is the one where everybody wants the same answer.
 *
 * The conventions here are load-bearing: an absent or unparseable value renders
 * as an em dash, never as `0` or `Invalid Date`. A dashboard that shows a zero
 * it did not measure is worse than one that admits it has no number.
 */

/** Minutes -> "4m", "1.1h", "13h", "2d". Null renders as an em dash. */
export function duration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, minutes);
  if (m < 60) return `${String(Math.round(m))}m`;
  const hours = m / 60;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  if (hours < 48) return `${String(Math.round(hours))}h`;
  return `${String(Math.round(hours / 24))}d`;
}

/** Milliseconds -> "6m 11s" / "0.4s", for pulse and tool-call timings. */
export function elapsed(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${String(Math.round(s))}s`;
  const mins = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${String(mins)}m ${String(rem)}s`;
}

/** An ISO timestamp as "how long ago", e.g. "4m ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return `${duration((now - t) / 60000)} ago`;
}

/** An ISO timestamp as wall-clock "14:02". */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
