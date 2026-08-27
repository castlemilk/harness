/**
 * The harness API source declaration.
 *
 * Its own module rather than living in `index.ts`: both the manifest
 * (`dataSources`) and the shared client (`client.ts`) need it, and a view
 * importing the manifest would drag every view into every other view's module
 * graph. Declared once, imported flatly, no cycles.
 */

/** The harness API the lab reads.
 *
 * Same override convention as the demo shell (`VITE_API_URL`) so pointing the
 * app at another API moves this source with it; `/projects` is a cheap 2xx the
 * server answers whenever it is up.
 */
export const HARNESS_API_SOURCE = {
  id: 'harness-api',
  label: 'Harness API',
  baseUrl: 'http://localhost:4000',
  envVar: 'VITE_API_URL',
  probePath: '/projects',
};
