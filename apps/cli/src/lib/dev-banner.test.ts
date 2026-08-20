import { describe, expect, it } from 'vitest';
import {
  fetchObjectiveCount,
  objectivesBannerLine,
  shouldPrintReadyBanner,
} from './dev-banner.js';

/**
 * What `harness dev` is allowed to claim once it prints "Ready".
 *
 * The regression these cover is a banner that told the truth about the *flag*
 * and nothing about the database: `--seed` printed "seeded" even when the seed
 * failed, and its absence printed "none seeded" over a database full of
 * objectives.
 */

describe('objectivesBannerLine', () => {
  it('sends an empty database to the seed command, and names both of them', () => {
    expect(objectivesBannerLine(0)).toBe(
      'Objectives   none yet — run `task db:seed:e2e`, or `task dev:seed`',
    );
  });

  it('says "pick it" for a single objective', () => {
    expect(objectivesBannerLine(1)).toBe(
      'Objectives   1 seeded — pick it from the switcher in the top bar',
    );
  });

  it('reports the real count for a seeded database', () => {
    expect(objectivesBannerLine(5)).toBe(
      'Objectives   5 seeded — pick one from the switcher in the top bar',
    );
  });

  it('admits it could not ask rather than rendering null as zero', () => {
    expect(objectivesBannerLine(null)).toBe(
      'Objectives   count unavailable (API did not answer)',
    );
    // The distinction is the whole point: an unavailable count must not send
    // the user to run a seed they may not need.
    expect(objectivesBannerLine(null)).not.toContain('db:seed:e2e');
  });
});

describe('shouldPrintReadyBanner', () => {
  it('prints when the web server answered and both children are alive', () => {
    expect(
      shouldPrintReadyBanner({ childExited: false, shuttingDown: false, webReachable: true }),
    ).toBe(true);
  });

  it('stays silent when a dev child has already exited', () => {
    expect(
      shouldPrintReadyBanner({ childExited: true, shuttingDown: false, webReachable: true }),
    ).toBe(false);
  });

  it('stays silent during shutdown', () => {
    expect(
      shouldPrintReadyBanner({ childExited: false, shuttingDown: true, webReachable: true }),
    ).toBe(false);
  });

  it('stays silent when the web server never answered', () => {
    expect(
      shouldPrintReadyBanner({ childExited: false, shuttingDown: false, webReachable: false }),
    ).toBe(false);
  });
});

describe('fetchObjectiveCount', () => {
  const okResponse = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

  it('counts the objectives the switcher would list', async () => {
    const seen: string[] = [];
    const count = await fetchObjectiveCount('http://localhost:4000', 3_000, ((
      url: string,
    ) => {
      seen.push(url);
      return Promise.resolve(okResponse([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    }) as unknown as typeof fetch);
    expect(count).toBe(3);
    expect(seen).toEqual(['http://localhost:4000/foreman/objectives']);
  });

  it('returns 0 for an empty database, which is a real answer', async () => {
    const count = await fetchObjectiveCount(
      'http://localhost:4000',
      3_000,
      (() => Promise.resolve(okResponse([]))) as unknown as typeof fetch,
    );
    expect(count).toBe(0);
  });

  it('returns null when the API refuses', async () => {
    const count = await fetchObjectiveCount(
      'http://localhost:4000',
      3_000,
      (() => Promise.resolve({ ok: false, status: 500 } as unknown as Response)) as unknown as typeof fetch,
    );
    expect(count).toBeNull();
  });

  it('returns null when the request throws', async () => {
    const count = await fetchObjectiveCount(
      'http://localhost:4000',
      3_000,
      (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    );
    expect(count).toBeNull();
  });

  it('returns null when the body is not a list', async () => {
    const count = await fetchObjectiveCount(
      'http://localhost:4000',
      3_000,
      (() => Promise.resolve(okResponse({ error: 'nope' }))) as unknown as typeof fetch,
    );
    expect(count).toBeNull();
  });
});
