/**
 * `@omega-harness/usecase-kit/ui` — the shared presentational layer.
 *
 * A separate entry point from the root, deliberately. The root export is types
 * and transport: it imports no React runtime, so anything that only needs the
 * contract (a test, a server-side tool, a lint rule) pays nothing. This one is
 * React components, and a consumer opts into that by importing `/ui`.
 *
 * ```ts
 * import { Panel, Pill, SectionLabel, StatusDot, clock } from '@omega-harness/usecase-kit/ui';
 * ```
 */

export {
  Panel,
  Pill,
  SectionLabel,
  StatusDot,
  statusColor,
  statusTextClass,
} from './primitives.js';

export { ago, clock, duration, elapsed } from './format.js';
