import type { Objective } from '../types.js';
import type { ViewTab } from '../usecases/registry.js';

/**
 * The 44px bar that persists across every shell: identity, the objective in
 * scope, the shell switcher, and the two always-reachable affordances —
 * command palette and the interventions queue.
 */
export function AppChrome({
  view,
  tabs,
  onViewChange,
  objective,
  objectives,
  onObjectiveChange,
  pendingInterventions,
  onOpenPalette,
  onOpenInterventions,
  onOpenLegacy,
  right,
}: {
  view: string;
  /** Core tabs plus the active use case's, already derived and ordered. */
  tabs: ViewTab[];
  onViewChange: (v: string) => void;
  objective: Objective | null;
  objectives: Objective[];
  onObjectiveChange: (id: string) => void;
  pendingInterventions: number;
  onOpenPalette: () => void;
  onOpenInterventions: () => void;
  onOpenLegacy: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex h-11 flex-none items-center gap-3 border-b border-line bg-rail px-4">
      <div className="flex items-center gap-2">
        <div className="h-[18px] w-[18px] rounded-[5px] bg-accent" aria-hidden="true" />
        <span className="text-[12.5px] font-semibold">Foreman</span>
      </div>

      {objectives.length > 0 && (
        <label className="relative flex items-center">
          <span className="sr-only">Objective</span>
          <select
            value={objective?.id ?? ''}
            onChange={(e) => { onObjectiveChange(e.target.value); }}
            className="cursor-pointer appearance-none rounded-md border border-line bg-control py-1 pl-2.5 pr-6 text-[11px] font-medium text-ink outline-none"
          >
            {objectives.map((o) => (
              <option key={o.id} value={o.id} className="bg-control">
                {o.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 text-muted" aria-hidden="true">
            ⌄
          </span>
        </label>
      )}

      <nav className="ml-2 flex items-stretch gap-4 self-stretch text-[11.5px] font-medium">
        {tabs.map((t, i) => {
          const active = view === t.id;
          // A hairline where the core chrome ends and the use case begins, so
          // the domain tabs read as an addition rather than more chrome.
          const opensUseCase = t.source === 'usecase' && tabs[i - 1]?.source === 'core';
          return (
            <div key={t.id} className={`flex self-stretch ${opensUseCase ? 'gap-4' : ''}`}>
              {opensUseCase && (
                // `line` is a borderColor token, so this draws as a border
                // rather than a background — `bg-line` is not a class.
                <span className="my-2.5 flex-none border-l border-line" aria-hidden="true" />
              )}
              <button
                type="button"
                onClick={() => { onViewChange(t.id); }}
                // The only place the use-case accent touches core chrome: an
                // active domain tab underlines in the shell's colour.
                style={
                  active && t.source === 'usecase'
                    ? { borderBottomColor: 'var(--uc-accent)' }
                    : undefined
                }
                className={`self-stretch border-b-2 transition-colors ${
                  active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink2'
                }`}
              >
                {t.label}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenInterventions}
        className="flex items-center gap-2 rounded-md border border-line bg-control px-2.5 py-1 text-[11px] text-ink2 transition-colors hover:border-edge"
      >
        Needs you
        {pendingInterventions > 0 && (
          <span className="rounded-full bg-warn px-1.5 font-mono text-[10px] font-semibold text-[#16161a]">
            {pendingInterventions}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="font-mono text-[10.5px] text-muted transition-colors hover:text-ink2"
      >
        ⌘K search
      </button>

      {right}

      <button
        type="button"
        onClick={onOpenLegacy}
        title="Benchmarks, providers and traces"
        className="h-[22px] w-[22px] rounded-full bg-track transition-colors hover:bg-raised"
      >
        <span className="sr-only">Open the benchmark and provider panels</span>
      </button>
    </header>
  );
}
