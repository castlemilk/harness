/** Formatting used across the Foreman surfaces. Kept in one place so a duration
 *  or a dollar figure reads identically in the tree, on a card, and in usage. */

/** "$1.02", "$41.20" — always two decimals, matching the wireframes. */
export function money(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

/** "$268" for headline figures where cents are noise. */
export function moneyShort(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
}

/** 0.56 -> "56%" */
export function percent(fraction: number): string {
  return `${String(Math.round(Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100))}%`;
}

/** 184_000_000 -> "184M" */
export function compactCount(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${String(Math.round(v / 1e6))}M`;
  if (v >= 1e3) return `${String(Math.round(v / 1e3))}k`;
  return String(Math.round(v));
}

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
