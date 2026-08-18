/**
 * The use-case roster.
 *
 * Registration happens here, once, at module load — importing this module is
 * what makes a shell exist. `ForemanApp` imports it for that side effect, so
 * every shell in the app is visible in this one file rather than scattered
 * across self-registering modules.
 */
import { registerUseCase } from './registry.js';
import { demoUseCase } from './demo.js';
import { victoriaUseCase } from './victoria/index.js';

// Dev and test only: the demo shell proves the path without shipping an empty
// tab to an operator. `import.meta.env.DEV` is false in `vite build`, so the
// registration — and, via tree-shaking, the view itself — never reaches prod.
if (import.meta.env.DEV) {
  registerUseCase(demoUseCase);
}

// Victoria ships in every build: it is a real domain shell with a real backend,
// and an operator whose objective carries `useCase: 'victoria'` must find its
// tabs in production. Registering it costs one map insert — the shell issues no
// requests until one of its views mounts.
registerUseCase(victoriaUseCase);

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
