import { useEffect, useState } from 'react';
import {
  createDataSource,
  type UseCaseShell,
  type UseCaseViewProps,
} from '@omega-harness/usecase-kit';

/**
 * The proof shell.
 *
 * It exists to keep the whole path honest end to end — server column, wire
 * serialisation, registry lookup, tab derivation, accent variable, and now the
 * data-source seam — without waiting on a real domain. It is registered only
 * outside production builds (see `./index.ts`), so shipping it costs nothing
 * and no operator can land on a tab that does nothing.
 *
 * Its data source points at the Foreman server itself. That is the point: it
 * exercises config → env resolution → typed fetch → render → health dot with a
 * backend that is guaranteed to be running whenever the demo shell can be seen,
 * so the seam is provable without standing up an external service.
 */
const FOREMAN_SOURCE = {
  id: 'foreman',
  label: 'Foreman API',
  baseUrl: 'http://localhost:4000',
  // Same override Foreman's own client honours, so pointing the app at another
  // API moves the demo source with it.
  envVar: 'VITE_API_URL',
  probePath: '/foreman/objectives',
};

// The typed client lives in the shell's own module, NOT on `UseCaseViewProps`:
// a domain view brings its own data, and the guest contract stays six fields.
const foreman = createDataSource(FOREMAN_SOURCE);

interface ObjectiveRow {
  id: string;
  name: string;
}

function DemoView({ objectiveId, state, focusId }: UseCaseViewProps) {
  const [objectives, setObjectives] = useState<ObjectiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    foreman
      .getJson<ObjectiveRow[]>('/foreman/objectives')
      .then((rows) => {
        if (!cancelled) setObjectives(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas px-8 text-center text-ink">
      <div
        className="h-2 w-16 rounded-full"
        style={{ backgroundColor: 'var(--uc-accent)' }}
        aria-hidden="true"
      />
      <p className="text-[13px] font-semibold">
        This objective is running the demo use-case shell.
      </p>
      <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-muted">
        This tab is contributed by a registered use case, not by the core Foreman
        chrome. It renders alongside Console, Board and the rest for
        <span className="font-mono"> {state.objective.name} </span>
        because that objective carries <span className="font-mono">useCase: &quot;demo&quot;</span>.
      </p>
      <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-muted">
        Its own data source (<span className="font-mono">{foreman.config.label}</span> at{' '}
        <span className="font-mono">{foreman.config.baseUrl}</span>) answered:{' '}
        {error !== null ? (
          <span className="text-danger">{error}</span>
        ) : objectives === null ? (
          <span className="text-faint">loading…</span>
        ) : (
          <span className="font-mono text-ink">
            {objectives.length} objective{objectives.length === 1 ? '' : 's'}
          </span>
        )}
        . The dot in the chrome is that same source, probed on a timer.
      </p>
      <p className="font-mono text-[10.5px] text-muted">
        objective {objectiveId} · {state.harnesses.length} harnesses · focus{' '}
        {focusId ?? '—'}
      </p>
    </div>
  );
}

export const demoUseCase: UseCaseShell = {
  id: 'demo',
  name: 'Demo — use-case shell proof',
  accent: '#7c8cf8',
  vocabulary: { harness: 'agent' },
  views: [{ id: 'demo-overview', label: 'Demo', order: 10, component: DemoView }],
  dataSources: [FOREMAN_SOURCE],
};
