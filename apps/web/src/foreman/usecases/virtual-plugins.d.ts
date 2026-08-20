/**
 * The generated roster's type.
 *
 * `virtual:foreman-plugins` has no file on disk — `vite.config.ts` emits it
 * from `foreman-plugins.json` — so `tsc` needs to be told what it is. The
 * declaration is deliberately narrow: whatever the configured plugins turn out
 * to be, the host only ever treats them as `UseCaseShell`s, and anything a
 * plugin exports beyond its shell is invisible from here.
 *
 * Named `virtual-plugins.d.ts` rather than `plugins.d.ts` because TypeScript
 * treats a `.d.ts` sitting beside a source file of the same stem as that file's
 * *emitted* declarations and drops it from the program. `plugins.tsx` (the
 * Plugins surface) is now that neighbour, and the symptom was three "Cannot
 * find module 'virtual:foreman-plugins'" errors in files nobody had touched.
 */
declare module 'virtual:foreman-plugins' {
  import type { UseCaseShell } from '@omega-harness/usecase-kit';

  /** One shell per entry in `foreman-plugins.json`, in configured order. */
  export const shells: UseCaseShell[];

  /** The configured paths those shells came from, for diagnostics. */
  export const pluginSources: string[];
}
