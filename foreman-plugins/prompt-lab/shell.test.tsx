/**
 * The Prompt Lab shell, on its own terms.
 *
 * Registration and tab derivation are asserted in the harness against the
 * generated roster (`apps/web/src/foreman/usecases/roster.test.ts`); what is
 * here is what the shell decides: its manifest, its endpoints, and the
 * summarisation its Benchmarks tab renders.
 *
 * `renderToStaticMarkup` rather than a DOM — the repo carries no jsdom, and
 * these views are read-only text. Effects never run under static rendering, so
 * the fetch paths are asserted through `loadPromptVersions` / `loadBenchSummary`
 * against a stub client instead: same URLs the views end up hitting, without a
 * browser to hit them from.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectiveState } from '@omega-harness/usecase-kit';
import { PROMPT_LAB_ACCENT, promptLabUseCase } from './index.js';
import { HARNESS_API_SOURCE } from './source.js';
import { loadBenchSummary, loadPromptVersions, summariseReport } from './client.js';
import { PromptVersionsView } from './views/PromptVersions.js';

function stubClient(getJson: ReturnType<typeof vi.fn>) {
  return { getJson };
}

describe('the manifest', () => {
  it('is a slug the registry will accept and an honest name', () => {
    expect(promptLabUseCase.id).toBe('prompt-lab');
    expect(promptLabUseCase.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(promptLabUseCase.name).toBe('Prompt Lab — self-improvement');
  });

  it('carries the blue accent, distinct from every status colour and domain accent', () => {
    // green #4ec97a (ok) / amber #e8963c (watching) / yellow #e5c04a (waiting)
    // / red #e5675b (failed) are status colours; #3fd97d is Victoria,
    // #a67ff0 is Polymarket.
    expect(PROMPT_LAB_ACCENT).toBe('#4da3ff');
  });

  it('reads only the harness API — one source, probed on /projects', () => {
    expect(promptLabUseCase.dataSources).toEqual([HARNESS_API_SOURCE]);
    expect(HARNESS_API_SOURCE.baseUrl).toBe('http://localhost:4000');
    expect(HARNESS_API_SOURCE.probePath).toBe('/projects');
  });

  it('renames nothing in the vocabulary', () => {
    expect(promptLabUseCase.vocabulary).toBeUndefined();
  });

  it('states its package version', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf8')
    ) as { version: string };
    expect(promptLabUseCase.version).toBe(pkg.version);
  });

  it('contributes exactly two tabs, Prompts first', () => {
    expect(promptLabUseCase.views.map((v) => v.id)).toEqual([
      'prompt-lab-versions',
      'prompt-lab-bench',
    ]);
    expect(promptLabUseCase.views[0]?.label).toBe('Prompts');
  });
});

describe('loadPromptVersions', () => {
  it('hits GET /prompt-versions and returns the rows', async () => {
    const rows = [{ id: 'pv1', name: 'auto-x', hash: 'abc123', benchmarkScore: null, createdAt: '2026-08-26T00:00:00Z' }];
    const getJson = vi.fn().mockResolvedValue(rows);
    await expect(loadPromptVersions(stubClient(getJson))).resolves.toBe(rows);
    expect(getJson).toHaveBeenCalledWith('/prompt-versions');
  });

  it('propagates transport errors so the view can show them', async () => {
    const getJson = vi.fn().mockRejectedValue(new Error('harness-api failed: 500'));
    await expect(loadPromptVersions(stubClient(getJson))).rejects.toThrow(/500/);
  });
});

describe('summariseReport', () => {
  it('computes pass rate and failure list from the newest report body', () => {
    const summary = summariseReport(
      { benchmark: ['benchmark-b.json', 'benchmark-a.json'], ab: [] },
      {
        passed: 3,
        total: 4,
        results: [
          { task: { name: 'ok-task' }, evaluation: { passed: true } },
          { task: { name: 'bad-task' }, evaluation: { passed: false, message: 'timeout' } },
          { evaluation: { passed: false } },
        ],
      }
    );
    expect(summary.file).toBe('benchmark-b.json');
    expect(summary.passRate).toBe(75);
    expect(summary.failures).toEqual([
      { name: 'bad-task', message: 'timeout' },
      { name: 'unnamed', message: null },
    ]);
    expect(summary.recent).toEqual(['benchmark-b.json', 'benchmark-a.json']);
  });

  it('yields a null rate for an empty roster or a report without tasks', () => {
    expect(summariseReport({ benchmark: [], ab: [] }, undefined)).toEqual({
      file: null,
      passRate: null,
      failures: [],
      recent: [],
    });
    expect(summariseReport({ benchmark: ['benchmark-a.json'], ab: [] }, { passed: 0, total: 0 }).passRate).toBeNull();
  });
});

describe('loadBenchSummary', () => {
  it('returns null-equivalent summary when no reports exist — one request only', async () => {
    const getJson = vi.fn().mockResolvedValue({ benchmark: [], ab: [] });
    const summary = await loadBenchSummary(stubClient(getJson));
    expect(summary?.file).toBeNull();
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('fetches the newest benchmark body and encodes the file name', async () => {
    const getJson = vi
      .fn<(path: string) => Promise<unknown>>()
      .mockResolvedValueOnce({ benchmark: ['benchmark-2026 1.json'], ab: [] })
      .mockResolvedValueOnce({ passed: 1, total: 2, results: [] });
    const summary = await loadBenchSummary(stubClient(getJson));
    expect(getJson).toHaveBeenNthCalledWith(2, '/benchmarks/reports/benchmark-2026%201.json');
    expect(summary?.passRate).toBe(50);
  });
});

describe('the views render honestly before data lands', () => {
  const state = {
    objective: { id: 'o1', name: 'Improve the harness' },
  } as unknown as ObjectiveState;

  it('Prompts shows its loading state and the objective it scopes to', () => {
    const html = renderToStaticMarkup(<PromptVersionsView state={state} />);
    expect(html).toContain('loading');
    expect(html).toContain('Improve the harness');
    expect(html).toContain('Harness API');
  });
});
