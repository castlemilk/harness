/**
 * The use-case roster.
 *
 * Registration happens here, once, at module load — importing this module is
 * what makes a shell exist. `ForemanApp` imports it for that side effect, so
 * every shell in the app is visible in this one file.
 *
 * Shells themselves are **pure exports**: each module exports a `UseCaseShell`
 * object and registers nothing, so a shell can be moved to another repository
 * without moving a side effect with it.
 *
 * *Which* shells those are is configuration, not code. `foreman-plugins.json`
 * at the repo root lists the plugin directories; `vite.config.ts` resolves that
 * list at config load and generates `virtual:foreman-plugins` — static imports,
 * one per configured plugin. The imports below are therefore still eager and
 * static, and a configured plugin that is not on disk still fails the *build*,
 * with its path in the message, rather than becoming a blank tab. The list just
 * lives somewhere a plugin outside this repository can appear in. See
 * `apps/web/plugin-discovery.mjs` and docs/USE-CASE-SHELLS.md.
 *
 * It goes through `registerRoster` rather than calling `registerUseCase` per
 * shell, because Vite re-executes this module on every HMR update that reaches
 * it. `registerRoster` replaces the previous roster instead of colliding with
 * it; see its comment in `./registry.ts` for why that beats a dispose hook or a
 * fingerprint check. Duplicate ids still throw.
 */
import type { UseCaseShell } from '@omega-harness/usecase-kit';
import { shells as configuredShells } from 'virtual:foreman-plugins';
import { registerRoster } from './registry.js';
import { demoUseCase } from './demo.js';

// Every configured plugin ships in every build: each is a real domain an
// objective can carry, and an operator whose objective says `useCase:
// 'victoria'` must find its tabs in production. Registering one costs a map
// insert — a shell issues no requests until one of its views mounts. That
// includes backend-less shells like Polymarket (UC-4): the objective exists, so
// the tab must, and the view says out loud that there is no backend yet.
const roster: UseCaseShell[] = [...configuredShells];

// The demo shell is deliberately NOT in `foreman-plugins.json`: it is host-owned
// dev tooling that exists to prove the seam, not a domain anybody deploys, and
// putting it in the config would invite someone to ship it. Dev and test only —
// `import.meta.env.DEV` is false in `vite build`, so the registration and, via
// tree-shaking, the view itself never reach production.
if (import.meta.env.DEV) {
  roster.push(demoUseCase);
}

registerRoster(roster);

// The host half of the seam. The *contract* — `UseCaseShell`,
// `UseCaseViewProps`, `createDataSource` — is imported from
// `@omega-harness/usecase-kit` directly, by the app and by shells alike, so
// there is exactly one path to it and no barrel that could drift from it.
export * from './registry.js';
export {
  healthTooltip,
  PROBE_INTERVAL_MS,
  shellSources,
  SourceHealthDots,
  startHealthProbes,
  useSourceHealth,
  type HealthMap,
  type SourceHealth,
} from './health.js';
export { CORE_VIEWS, DEFAULT_VIEW, findCoreView, type CoreView, type CoreViewContext } from './core.js';
