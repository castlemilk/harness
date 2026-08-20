import { useState } from 'react';
import { Panel, Pill, SectionLabel } from '@omega-harness/usecase-kit/ui';
import {
  resolveBaseUrl,
  type UseCaseDataSourceConfig,
  type UseCaseShell,
} from '@omega-harness/usecase-kit';
import { healthColor, healthTooltip, useSourceHealth, type SourceHealth } from './health.js';

/**
 * The Plugins surface — what is installed, where it came from, and who uses it.
 *
 * A use-case shell is otherwise only visible *through an objective that already
 * carries it*: you learn Victoria exists by finding an objective whose
 * `useCase` says so. That is backwards for every question an operator actually
 * asks on arrival — what did this build ship, is its backend up, which
 * objectives run it, and how do I start one. So this is chrome, not a domain
 * tab: it is registered in `CORE_VIEWS` and appears for every objective,
 * including objectives with no use case at all.
 *
 * Three sources of truth meet here and none of them is invented:
 *
 *   - the **registry** (`getUseCases()`) — what is actually registered, which
 *     is the only thing that decides whether a tab can appear;
 *   - the **generated roster's `pluginSources`** — the configured path each
 *     shell came from, so provenance is the config's answer rather than a guess;
 *   - the **objective list** the chrome already holds — so "3 objectives use
 *     this" is the real fleet, not a count of anything derived.
 *
 * A shell the registry holds but the roster does not name is host-owned dev
 * tooling (the demo shell), and says so rather than being hidden: hiding it
 * would make the surface disagree with the tab bar, which is the one thing it
 * exists to explain.
 */

/** An objective, reduced to what a card needs. */
export interface PluginObjectiveRef {
  id: string;
  name: string;
}

/** Where a registered shell's code lives, as far as the configuration knows. */
export type PluginProvenance = 'in-repo' | 'out-of-tree' | 'host';

export interface PluginCardModel {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  accent: string;
  /** The configured path, verbatim. Null for a host-owned shell. */
  source: string | null;
  provenance: PluginProvenance;
  /** Host-owned and registered only outside production builds. */
  devOnly: boolean;
  views: { id: string; label: string }[];
  dataSources: UseCaseDataSourceConfig[];
  /** Objectives whose `useCase` is this shell, in the order the chrome lists them. */
  objectives: PluginObjectiveRef[];
  /** The tab a jump lands on — the shell's first view, or null if it has none. */
  firstViewId: string | null;
}

/** Foreman's stock accent, for a shell that declares none. Matches ForemanApp. */
const STOCK_ACCENT = '#e8963c';

/**
 * In-repo or not, decided **lexically** on the configured path.
 *
 * The browser has no repo root and no filesystem, so this is the same
 * string-only judgement `plugin-discovery.mjs` makes when it words an error: a
 * relative path that does not climb out of the root is in-repo, anything else
 * is not. It is a label on a card, so being wrong about a symlink is cosmetic —
 * and the verbatim path is rendered next to it either way.
 */
export function pluginProvenance(source: string | null | undefined): PluginProvenance {
  if (source == null) return 'host';
  if (source.startsWith('/')) return 'out-of-tree';
  const climbs = source.split('/').some((segment) => segment === '..');
  return climbs ? 'out-of-tree' : 'in-repo';
}

function byOrder(views: readonly { order?: number }[]): number[] {
  return views
    .map((v, i) => i)
    .sort((a, b) => {
      const oa = views[a].order ?? Number.MAX_SAFE_INTEGER;
      const ob = views[b].order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
}

/**
 * The card model for every registered shell.
 *
 * `sourceById` is the roster's `pluginSources` zipped onto the shells it
 * generated, so a shell missing from it is one nothing configured — host-owned.
 * Objectives are matched on `useCase` exactly, because that string is a
 * registry key on both sides of the wire.
 */
export function pluginCards(
  shells: readonly UseCaseShell[],
  // `string | undefined` values on purpose: a shell the roster never named has
  // no entry, and that absence is what makes it host-owned.
  sourceById: Readonly<Record<string, string | undefined>>,
  objectives: readonly { id: string; name: string; useCase?: string | null }[],
): PluginCardModel[] {
  return shells.map((shell) => {
    const source = sourceById[shell.id] ?? null;
    const order = byOrder(shell.views);
    return {
      id: shell.id,
      name: shell.name,
      version: shell.version ?? null,
      description: shell.description ?? null,
      accent: shell.accent ?? STOCK_ACCENT,
      source,
      provenance: pluginProvenance(source),
      devOnly: source === null,
      views: order.map((i) => ({ id: shell.views[i].id, label: shell.views[i].label })),
      dataSources: shell.dataSources ?? [],
      objectives: objectives
        .filter((o) => o.useCase === shell.id)
        .map((o) => ({ id: o.id, name: o.name })),
      firstViewId: order.length > 0 ? shell.views[order[0]].id : null,
    };
  });
}

/** `pluginSources` is index-aligned with the roster's shells; this zips them. */
export function sourceMap(
  shells: readonly UseCaseShell[],
  sources: readonly string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  shells.forEach((shell, i) => {
    const source = sources.at(i);
    if (source !== undefined) map[shell.id] = source;
  });
  return map;
}

/**
 * A name to prefill the start form with, e.g. "Victoria market trading".
 *
 * Shell names follow `<Project> — <what it is>`, which is already the two halves
 * an objective wants; dropping the em dash turns the manifest's own words into a
 * sentence instead of inventing one. A name without a dash is used as-is.
 */
export function suggestedObjectiveName(shell: { id: string; name: string }): string {
  const parts = shell.name
    .split('—')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return shell.id;
  return parts.join(' ');
}

export interface PluginsViewProps {
  /** Every registered shell, registry order. */
  shells: readonly UseCaseShell[];
  /** Shell id → the configured path it came from. */
  sourceById: Readonly<Record<string, string | undefined>>;
  objectives: readonly { id: string; name: string; useCase?: string | null }[];
  /** Select an objective and open a view on it. */
  onOpenObjective: (objectiveId: string, viewId: string | null) => void;
  /** Create an objective carrying a use case. Rejects surface in the error rail. */
  onStartObjective: (input: { name: string; useCase: string }) => Promise<void>;
  /** False without a connected project — `POST /objectives` needs one. */
  canCreate: boolean;
}

export function PluginsView({
  shells,
  sourceById,
  objectives,
  onOpenObjective,
  onStartObjective,
  canCreate,
}: PluginsViewProps) {
  const cards = pluginCards(shells, sourceById, objectives);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-5 text-ink">
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-[14px] font-semibold">Installed use-case shells</h1>
          <p className="max-w-[70ch] text-[11.5px] leading-relaxed text-muted">
            Every plugin this build registered. A shell adds domain tabs to an
            objective that carries its id — the core chrome (Console, Board,
            Graph, Work, Usage, Playbooks, Plugins) is always there regardless.
          </p>
        </header>

        {cards.length === 0 ? (
          <EmptyRoster />
        ) : (
          cards.map((card) => (
            <PluginCard
              key={card.id}
              card={card}
              shell={shells.find((s) => s.id === card.id) ?? null}
              onOpenObjective={onOpenObjective}
              onStartObjective={onStartObjective}
              canCreate={canCreate}
            />
          ))
        )}

        <Footer />
      </div>
    </div>
  );
}

function EmptyRoster() {
  return (
    <Panel className="px-4 py-5">
      <SectionLabel>No shells registered</SectionLabel>
      <p className="mt-2 max-w-[70ch] text-[11.5px] leading-relaxed text-muted">
        This build shipped no use-case plugins, so every objective renders the
        core chrome only. Which plugins ship is build-time configuration, not a
        runtime lookup: <span className="font-mono text-ink2">foreman-plugins.json</span> at
        the repo root lists the plugin directories, and{' '}
        <span className="font-mono text-ink2">FOREMAN_PLUGINS</span> (comma-separated)
        replaces that list for one run.
      </p>
      <p className="mt-2 max-w-[70ch] text-[11.5px] leading-relaxed text-muted">
        Authoring guide: <span className="font-mono text-ink2">docs/USE-CASE-SHELLS.md</span>.
      </p>
    </Panel>
  );
}

function Footer() {
  return (
    <p className="max-w-[80ch] pb-2 text-[11px] leading-relaxed text-faint">
      To install another shell, add its directory to{' '}
      <span className="font-mono text-muted">foreman-plugins.json</span> and restart the
      dev server — the roster is generated at config load, so a configured plugin
      that is not on disk fails the build with its path rather than becoming a
      blank tab. To write one, see{' '}
      <span className="font-mono text-muted">docs/USE-CASE-SHELLS.md</span>.
    </p>
  );
}

function PluginCard({
  card,
  shell,
  onOpenObjective,
  onStartObjective,
  canCreate,
}: {
  card: PluginCardModel;
  shell: UseCaseShell | null;
  onOpenObjective: PluginsViewProps['onOpenObjective'];
  onStartObjective: PluginsViewProps['onStartObjective'];
  canCreate: boolean;
}) {
  return (
    <Panel className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span
          className="mt-[3px] h-[26px] w-[6px] flex-none rounded-full"
          style={{ background: card.accent }}
          role="img"
          aria-label={`${card.name} accent ${card.accent}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold">{card.name}</span>
            <Pill color={card.accent}>{card.id}</Pill>
            {card.version !== null && <Pill>v{card.version}</Pill>}
            {card.devOnly && <Pill color="#e8963c">dev only</Pill>}
          </div>
          {card.description !== null && (
            <p className="max-w-[76ch] text-[11.5px] leading-relaxed text-muted">
              {card.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-faint">
            {card.source === null ? (
              <span>host-owned · registered in dev builds only, never shipped</span>
            ) : (
              <>
                <span className="text-muted">{card.source}</span>
                <span>·</span>
                <span>
                  {card.provenance === 'out-of-tree'
                    ? 'out-of-tree (another checkout)'
                    : 'in-repo'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <SectionLabel>
            {card.views.length} view{card.views.length === 1 ? '' : 's'}
          </SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {card.views.map((v) => (
              <span
                key={v.id}
                title={v.id}
                className="rounded-[5px] border border-line bg-control px-2 py-[3px] text-[10.5px] text-ink2"
              >
                {v.label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>
            {card.dataSources.length === 0
              ? 'No data sources'
              : `${String(card.dataSources.length)} data source${card.dataSources.length === 1 ? '' : 's'}`}
          </SectionLabel>
          {card.dataSources.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-faint">
              This shell declares no backend, so there is no health to report.
            </p>
          ) : (
            <SourceRows shell={shell} />
          )}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <UsedBy
          card={card}
          onOpenObjective={onOpenObjective}
          onStartObjective={onStartObjective}
          canCreate={canCreate}
        />
      </div>
    </Panel>
  );
}

/**
 * One row per declared source, with the live dot.
 *
 * This reuses the chrome's own probing rather than a second mechanism, which is
 * what makes the dot here and the dot in the header mean the same thing. It is
 * a child component on purpose: the hook mounts with the card, so opening this
 * view probes **every** shell's sources — the point of the surface — and
 * leaving it stops all of them. Nothing about the existing gating changes: a
 * shell that is not active and not on a card here still issues no requests.
 */
function SourceRows({ shell }: { shell: UseCaseShell | null }) {
  const entries = useSourceHealth(shell);
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(({ source, health }) => (
        <li key={source.config.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <HealthDot config={source.config} health={health} />
            <span className="text-[11.5px] text-ink2">{source.config.label}</span>
            <span className="font-mono text-[10px] text-faint">{health.status}</span>
          </div>
          <div className="pl-[14px] font-mono text-[10px] text-muted">
            {resolveBaseUrl(source.config)}
          </div>
          <div className="pl-[14px] font-mono text-[10px] text-faint">
            {source.config.envVar === undefined
              ? 'no env override'
              : `override: ${source.config.envVar}`}
          </div>
        </li>
      ))}
    </ul>
  );
}

function HealthDot({
  config,
  health,
}: {
  config: UseCaseDataSourceConfig;
  health: SourceHealth;
}) {
  return (
    <span
      role="img"
      aria-label={`${config.label}: ${health.status}`}
      title={healthTooltip(config, health)}
      className={`h-[6px] w-[6px] flex-none rounded-full ${
        health.status === 'probing' ? 'animate-bp' : ''
      }`}
      style={{ background: healthColor(health.status) }}
    />
  );
}

function UsedBy({
  card,
  onOpenObjective,
  onStartObjective,
  canCreate,
}: {
  card: PluginCardModel;
  onOpenObjective: PluginsViewProps['onOpenObjective'];
  onStartObjective: PluginsViewProps['onStartObjective'];
  canCreate: boolean;
}) {
  if (card.objectives.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        <SectionLabel>
          {card.objectives.length} objective{card.objectives.length === 1 ? '' : 's'} using it
        </SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {card.objectives.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onOpenObjective(o.id, card.firstViewId); }}
              style={{ borderColor: `${card.accent}55` }}
              className="rounded-[6px] border bg-control px-2.5 py-1 text-[11px] text-ink2 transition-colors hover:text-ink"
            >
              {o.name} <span className="text-faint">→</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return <StartObjective card={card} onStartObjective={onStartObjective} canCreate={canCreate} />;
}

/**
 * The dead end this closes: a shell nobody uses is unreachable by clicking. You
 * cannot open its tabs without an objective carrying its id, and creating one
 * meant knowing that `useCase` is a field at all. So the card offers it.
 */
function StartObjective({
  card,
  onStartObjective,
  canCreate,
}: {
  card: PluginCardModel;
  onStartObjective: PluginsViewProps['onStartObjective'];
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => suggestedObjectiveName(card));
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>No objective uses it</SectionLabel>
      {!open ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => { setOpen(true); }}
            style={canCreate ? { borderColor: `${card.accent}66` } : undefined}
            className="rounded-[6px] border border-line bg-control px-2.5 py-1 text-[11px] text-ink2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start an objective with this use-case
          </button>
          {!canCreate && (
            <span className="text-[10.5px] text-faint">Connect a project first.</span>
          )}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || name.trim().length === 0) return;
            setBusy(true);
            void onStartObjective({ name: name.trim(), useCase: card.id }).finally(() => {
              setBusy(false);
              setOpen(false);
            });
          }}
        >
          <label className="flex items-center gap-2">
            <span className="sr-only">Objective name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="w-[280px] rounded-[6px] border border-line bg-control px-2.5 py-1 text-[11.5px] text-ink outline-none focus:border-edge"
            />
          </label>
          <span className="font-mono text-[10.5px] text-faint">useCase: {card.id}</span>
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="rounded-[6px] border border-line bg-control px-2.5 py-1 text-[11px] text-ink2 transition-colors hover:text-ink disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); }}
            className="text-[11px] text-faint transition-colors hover:text-muted"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
