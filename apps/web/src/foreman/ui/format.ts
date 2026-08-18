/** Formatting used across the Foreman surfaces. Kept in one place so a duration
 *  or a dollar figure reads identically in the tree, on a card, and in usage.
 *
 *  The **time** family — `duration`, `elapsed`, `ago`, `clock` — now lives in
 *  `@omega-harness/usecase-kit/ui` and is re-exported below, so this module is
 *  still the one import site for the chrome. It moved with the shells (OT-3):
 *  Victoria's Live and Trades tabs render wall-clock times and, out-of-tree,
 *  cannot import this file. Money and percentages stayed, because that is
 *  exactly where a domain disagrees with the chrome — Victoria wants grouped,
 *  signed dollars and unclamped percentages, and brings its own. */

export { ago, clock, duration, elapsed } from '@omega-harness/usecase-kit/ui';

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

/** "1 child" / "3 children" — count with a correctly pluralised noun. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const n = Number.isFinite(count) ? count : 0;
  return `${String(n)} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
