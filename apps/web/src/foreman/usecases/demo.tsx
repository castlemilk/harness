import type { UseCaseShell, UseCaseViewProps } from './registry.js';

/**
 * The proof shell.
 *
 * It exists to keep the whole path honest end to end — server column, wire
 * serialisation, registry lookup, tab derivation, accent variable — without
 * waiting on a real domain. It is registered only outside production builds
 * (see `./index.ts`), so shipping it costs nothing and no operator can land on
 * a tab that does nothing.
 */
function DemoView({ objectiveId, state, focusId }: UseCaseViewProps) {
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
};
