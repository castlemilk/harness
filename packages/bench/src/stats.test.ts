import { describe, expect, it } from 'vitest';
import { discordantCounts, holmBonferroni, mcnemarExact, meanCi95, signFlipPermutation } from './stats.js';

describe('signFlipPermutation', () => {
  it('returns p=1 when deltas are symmetric around zero', () => {
    const result = signFlipPermutation([1, -1]);
    expect(result.meanDelta).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.method).toBe('exact');
  });

  it('matches exact enumeration for four consistent positive deltas', () => {
    // Under H0 all 16 sign patterns are equally likely; the observed all-positive
    // pattern and its mirror are the only ones at least as extreme.
    const result = signFlipPermutation([2, 2, 2, 2]);
    expect(result.meanDelta).toBe(2);
    expect(result.pValue).toBeCloseTo(2 / 16, 10);
  });

  it('lowers p as the effect becomes consistent', () => {
    const weak = signFlipPermutation([1, -1, 1, -1, 1, -1]);
    const strong = signFlipPermutation([1, 1, 1, 1, 1, 1]);
    expect(strong.pValue).toBeLessThan(weak.pValue);
  });

  it('uses monte carlo for large samples', () => {
    const deltas = Array.from({ length: 30 }, () => 1);
    const result = signFlipPermutation(deltas, { resamples: 2000, seed: 7 });
    expect(result.method).toBe('monte-carlo');
    expect(result.pValue).toBeLessThan(0.01);
  });
});

describe('mcnemarExact', () => {
  it('returns 1 with no discordant pairs', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });

  it('is symmetric and significant for lopsided discordants', () => {
    const left = mcnemarExact(1, 9);
    expect(left).toBeCloseTo(mcnemarExact(9, 1), 12);
    expect(left).toBeLessThan(0.05);
  });

  it('matches the known 4/0 case', () => {
    // n=4, k=0: p = 2 * (1/16) = 0.125
    expect(mcnemarExact(4, 0)).toBeCloseTo(0.125, 10);
  });
});

describe('holmBonferroni', () => {
  it('adjusts in input order and caps at 1', () => {
    const adjusted = holmBonferroni([0.01, 0.04, 0.03]);
    expect(adjusted[0]).toBeCloseTo(0.03, 10);
    expect(adjusted[1]).toBeCloseTo(0.06, 10);
    expect(adjusted[2]).toBeCloseTo(0.06, 10);
  });
});

describe('meanCi95', () => {
  it('narrows with more samples and preserves the mean', () => {
    const one = meanCi95([50]);
    expect(one.low).toBe(one.high);
    const many = meanCi95([50, 50, 50, 50]);
    expect(many.mean).toBe(50);
    expect(many.low).toBe(50);
  });
});

describe('discordantCounts', () => {
  it('counts each agreement cell', () => {
    const counts = discordantCounts([true, true, false, false], [true, false, true, false]);
    expect(counts).toEqual({ a: 1, b: 1, both: 1, neither: 1 });
  });
});
