/**
 * The use-case roster.
 *
 * Registration happens here, once, at module load — importing this module is
 * what makes a shell exist. `ForemanApp` imports it for that side effect, so
 * every shell in the app is visible in this one file rather than scattered
 * across self-registering modules.
 *
 * It goes through `registerRoster` rather than calling `registerUseCase` per
 * shell, because Vite re-executes this module on every HMR update that reaches
 * it. `registerRoster` replaces the previous roster instead of colliding with
 * it; see its comment in `./registry.ts` for why that beats a dispose hook or a
 * fingerprint check. Duplicate ids still throw.
 */
import { registerRoster, type UseCaseShell } from './registry.js';
import { demoUseCase } from './demo.js';
import { victoriaUseCase } from './victoria/index.js';
import { polymarketUseCase } from './polymarket/index.js';

const roster: UseCaseShell[] = [
  // Victoria ships in every build: it is a real domain shell with a real
  // backend, and an operator whose objective carries `useCase: 'victoria'` must
  // find its tabs in production. Registering it costs one map insert — the
  // shell issues no requests until one of its views mounts.
  victoriaUseCase,
  // Polymarket ships too, for the same reason: the objective exists, so the tab
  // must. It declares no data sources because it genuinely has no backend yet
  // (UC-4), which is a thing its one view says out loud rather than hides.
  polymarketUseCase,
];

// Dev and test only: the demo shell proves the path without shipping an empty
// tab to an operator. `import.meta.env.DEV` is false in `vite build`, so the
// registration — and, via tree-shaking, the view itself — never reaches prod.
if (import.meta.env.DEV) {
  roster.push(demoUseCase);
}

registerRoster(roster);

export * from './registry.js';
export * from './data-source.js';
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
