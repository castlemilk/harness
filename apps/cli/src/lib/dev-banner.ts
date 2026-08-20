/**
 * The lines `harness dev` prints once the stack is up.
 *
 * Pure on purpose. The Ready banner used to key its Objectives line off the
 * `--seed` FLAG, so it claimed "seeded — pick one from the switcher" on any run
 * that happened to pass `--seed` and "none seeded" on every run that did not —
 * including a run against a database that was already full. The flag describes
 * what this invocation *asked for*; only the database knows what is there. So
 * the count comes from the running API, and when the API will not answer the
 * banner says that rather than guessing.
 */

/** What the supervisor knows at the moment it would print the banner. */
export interface ReadyBannerState {
  /** A dev child process (server or web) has already exited. */
  childExited: boolean;
  /** Ctrl-C, or a shutdown already in flight. */
  shuttingDown: boolean;
  /** The web dev server answered before the wait timed out. */
  webReachable: boolean;
}

/**
 * "Ready" is a claim about a running stack. Announcing it after a child has
 * died is the banner telling a comfortable lie over the top of the error the
 * user actually needs to read.
 */
export function shouldPrintReadyBanner(state: ReadyBannerState): boolean {
  return state.webReachable && !state.childExited && !state.shuttingDown;
}

/**
 * The Objectives line, without the indent or the dim escape.
 *
 * `null` means the count could not be determined — never silently rendered as
 * zero, because "none yet, run the seed" and "I could not ask" send the user to
 * two completely different places.
 */
export function objectivesBannerLine(count: number | null): string {
  if (count === null) {
    return 'Objectives   count unavailable (API did not answer)';
  }
  if (count === 0) {
    return 'Objectives   none yet — run `task db:seed:e2e`, or `task dev:seed`';
  }
  const pick = count === 1 ? 'pick it' : 'pick one';
  return `Objectives   ${String(count)} seeded — ${pick} from the switcher in the top bar`;
}

/**
 * Count objectives from the API the user is about to open — the same list the
 * switcher renders, so the banner cannot disagree with the screen.
 *
 * Any failure (server down, non-200, unparseable body) returns `null`, which
 * the line above reports honestly.
 */
export async function fetchObjectiveCount(
  apiUrl: string,
  timeoutMs = 3_000,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(`${apiUrl}/foreman/objectives`, { signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
