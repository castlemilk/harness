/**
 * Paired comparison statistics for benchmark arms (e.g. ledger vs single),
 * mirroring the tests used in arXiv:2608.26480: paired sign-flip permutation
 * on per-problem deltas, exact McNemar on pooled discordants, Holm correction,
 * and a normal-approximation CI for the mean pass@1.
 */

export interface SignFlipResult {
  meanDelta: number;
  pValue: number;
  samples: number;
  method: 'exact' | 'monte-carlo';
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-sided paired sign-flip permutation test on per-problem deltas.
 * Exact enumeration for n <= 16 (all 2^n sign assignments); Monte Carlo
 * otherwise. Deltas of zero contribute nothing under either branch.
 */
export function signFlipPermutation(
  deltas: number[],
  options: { resamples?: number; seed?: number } = {}
): SignFlipResult {
  const values = deltas.filter((value) => Number.isFinite(value));
  const n = values.length;
  if (n === 0) return { meanDelta: 0, pValue: 1, samples: 0, method: 'exact' };
  const meanDelta = values.reduce((sum, value) => sum + value, 0) / n;
  const observed = Math.abs(meanDelta);

  if (n <= 16) {
    let extreme = 0;
    const total = 2 ** n;
    for (let mask = 0; mask < total; mask++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (mask & (1 << i)) === 0 ? values[i] : -values[i];
      if (Math.abs(sum / n) >= observed - 1e-12) extreme += 1;
    }
    return { meanDelta, pValue: extreme / total, samples: total, method: 'exact' };
  }

  const resamples = options.resamples ?? 200_000;
  const random = mulberry32(options.seed ?? 1);
  let extreme = 0;
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += random() < 0.5 ? values[i] : -values[i];
    if (Math.abs(sum / n) >= observed - 1e-12) extreme += 1;
  }
  const pValue = (extreme + 1) / (resamples + 1);
  return { meanDelta, pValue, samples: resamples, method: 'monte-carlo' };
}

/**
 * Two-sided exact McNemar test over discordant pairs: a = first arm right and
 * second wrong, b = first wrong and second right. Under H0 each discordant
 * pair is a fair coin, so p = 2 * P(X <= min(a,b)) with X ~ Binomial(a+b, 0.5).
 */
export function mcnemarExact(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  let combinations = 1;
  for (let i = 0; i <= k; i++) {
    if (i > 0) combinations = (combinations * (n - i + 1)) / i;
    tail += combinations;
  }
  const p = Math.min(1, (2 * tail) / 2 ** n);
  return p;
}

/** Holm-Bonferroni step-down correction; returns adjusted p-values in input order. */
export function holmBonferroni(pValues: number[]): number[] {
  const indexed = pValues.map((p, index) => ({ p, index })).sort((x, y) => x.p - y.p);
  const m = pValues.length;
  const adjusted = new Array<number>(m).fill(1);
  let running = 0;
  indexed.forEach((entry, rank) => {
    const candidate = Math.min(1, entry.p * (m - rank));
    running = Math.max(running, candidate);
    adjusted[entry.index] = running;
  });
  return adjusted;
}

/** Mean and 95% CI using the normal approximation (z = 1.96). */
export function meanCi95(values: number[]): { mean: number; low: number; high: number; sd: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, low: 0, high: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n === 1) return { mean, low: mean, high: mean, sd: 0 };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const half = 1.96 * (sd / Math.sqrt(n));
  return { mean, low: mean - half, high: mean + half, sd };
}

/** Discordant pair counts for two per-problem boolean vectors. */
export function discordantCounts(
  first: boolean[],
  second: boolean[]
): { a: number; b: number; both: number; neither: number } {
  let a = 0;
  let b = 0;
  let both = 0;
  let neither = 0;
  const n = Math.min(first.length, second.length);
  for (let i = 0; i < n; i++) {
    if (first[i] && second[i]) both += 1;
    else if (first[i] && !second[i]) a += 1;
    else if (!first[i] && second[i]) b += 1;
    else neither += 1;
  }
  return { a, b, both, neither };
}
