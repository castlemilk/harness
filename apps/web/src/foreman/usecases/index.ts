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

// Dev and test only: the demo shell proves the path without shipping an empty
// tab to an operator. `import.meta.env.DEV` is false in `vite build`, so the
// registration — and, via tree-shaking, the view itself — never reaches prod.
if (import.meta.env.DEV) {
  registerUseCase(demoUseCase);
}

export * from './registry.js';
export { CORE_VIEWS, DEFAULT_VIEW, findCoreView, type CoreView, type CoreViewContext } from './core.js';
