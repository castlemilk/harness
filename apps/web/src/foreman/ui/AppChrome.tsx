import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Objective } from '../types.js';
import type { ViewTab } from '../usecases/registry.js';

/**
 * The 44px bar that persists across every shell: identity, the objective in
 * scope, the shell switcher, and the two always-reachable affordances —
 * command palette and the interventions queue.
 *
 * The tab strip is the only thing here that grows without bound: a use case
 * contributes its own tabs on top of the core ones, and ten domain tabs used to
 * push the header past the viewport — at 1366px the ⌘K button and the
 * "Needs you" rail were simply off-screen, and the whole page scrolled
 * sideways to reach them. So the strip scrolls inside itself and everything
 * else in the header is `flex-none`: the chrome controls are always reachable,
 * whatever the active shell adds.
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
  const strip = useRef<HTMLElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  // Which edges have tabs hidden past them. Drives the fade, so the fade is a
  // truthful affordance: it appears only where there is something to scroll to.
  const [clipped, setClipped] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setClipped({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
  }, []);

  // Layout effect so the fade is correct on the first paint after the tab set
  // changes (switching use case swaps every domain tab at once).
  useLayoutEffect(measure, [measure, tabs]);

  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [measure]);

  // A tab selected from the command palette can be one that is scrolled out of
  // sight; bring it back rather than leaving the active underline invisible.
  useEffect(() => {
    activeTab.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view, tabs]);

  return (
    <header className="flex h-11 flex-none items-center gap-3 border-b border-line bg-rail px-4">
      <div className="flex flex-none items-center gap-2">
        <div className="h-[18px] w-[18px] rounded-[5px] bg-accent" aria-hidden="true" />
        <span className="text-[12.5px] font-semibold">Foreman</span>
      </div>

      {objectives.length > 0 && (
        <label className="relative flex flex-none items-center">
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

      {/* `min-w-0` is what lets the strip actually clip: without it a flex item
          floors at its content width and the header grows instead. */}
      <div className="relative ml-2 flex min-w-0 flex-1 self-stretch">
        <nav
          ref={strip}
          onScroll={measure}
          className="no-scrollbar flex items-stretch gap-4 self-stretch overflow-x-auto text-[11.5px] font-medium"
        >
          {tabs.map((t, i) => {
            const active = view === t.id;
            // A hairline where the core chrome ends and the use case begins, so
            // the domain tabs read as an addition rather than more chrome.
            const opensUseCase = t.source === 'usecase' && tabs[i - 1]?.source === 'core';
            return (
              <div
                key={t.id}
                className={`flex flex-none self-stretch ${opensUseCase ? 'gap-4' : ''}`}
              >
                {opensUseCase && (
                  // `line` is a borderColor token, so this draws as a border
                  // rather than a background — `bg-line` is not a class.
                  <span className="my-2.5 flex-none border-l border-line" aria-hidden="true" />
                )}
                <button
                  ref={active ? activeTab : undefined}
                  type="button"
                  onClick={() => { onViewChange(t.id); }}
                  // The only place the use-case accent touches core chrome: an
                  // active domain tab underlines in the shell's colour.
                  style={
                    active && t.source === 'usecase'
                      ? { borderBottomColor: 'var(--uc-accent)' }
                      : undefined
                  }
                  className={`whitespace-nowrap self-stretch border-b-2 transition-colors ${
                    active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink2'
                  }`}
                >
                  {t.label}
                </button>
              </div>
            );
          })}
        </nav>

        {/* The clipped edge fades into the rail so the strip reads as scrollable
            rather than as a tab that happens to be cut in half. */}
        {clipped.start && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-rail to-transparent"
          />
        )}
        {clipped.end && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-rail to-transparent"
          />
        )}
      </div>

      <button
        type="button"
        onClick={onOpenInterventions}
        className="flex flex-none items-center gap-2 whitespace-nowrap rounded-md border border-line bg-control px-2.5 py-1 text-[11px] text-ink2 transition-colors hover:border-edge"
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
        className="flex-none whitespace-nowrap font-mono text-[10.5px] text-muted transition-colors hover:text-ink2"
      >
        ⌘K search
      </button>

      {right !== undefined && (
        <div className="flex flex-none items-center gap-3">{right}</div>
      )}

      <button
        type="button"
        onClick={onOpenLegacy}
        title="Benchmarks, providers and traces"
        className="h-[22px] w-[22px] flex-none rounded-full bg-track transition-colors hover:bg-raised"
      >
        <span className="sr-only">Open the benchmark and provider panels</span>
      </button>
    </header>
  );
}
