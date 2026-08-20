import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import {
  createDataSource,
  type UseCaseDataSourceConfig,
  type UseCaseShell,
  type UseCaseViewProps,
} from './index.js';

/**
 * An example plugin, written the way an out-of-tree one is: it imports the kit
 * and NOTHING else, exports a shell object, and registers nothing.
 *
 * This file is the kit's type-level test. It is compiled by `tsc` on every
 * build and typechecked in CI, so a change that breaks a conforming plugin —
 * a required field added to `UseCaseShell`, a prop dropped from
 * `UseCaseViewProps`, a data-source type narrowed — fails here rather than in
 * a repository the harness cannot see. The runtime assertions are thin on
 * purpose; the compiler is the assertion that matters.
 */

const SOURCE: UseCaseDataSourceConfig = {
  id: 'example-api',
  label: 'Example API',
  baseUrl: 'http://localhost:9999',
  envVar: 'VITE_UC_EXAMPLE_URL',
  probePath: '/healthz',
};

// A shell's typed client lives in the shell's own module, never on the props.
const example = createDataSource(SOURCE);

/**
 * A view, as a plugin writes one: `UseCaseViewProps` in, an element out. It is
 * declared as `ComponentType` rather than written in JSX so the kit stays free
 * of a React *runtime* dependency — React is a peer, and types-only here.
 */
const ExampleView: ComponentType<UseCaseViewProps> = (props) => {
  // Every field of the guest contract, read exactly as a plugin would. If one
  // of these disappears, this stops compiling.
  const harnesses: number = props.state.harnesses.length;
  const name: string = props.state.objective.name;
  const objectiveId: string = props.objectiveId;
  const focus: string | null = props.focusId;
  void [harnesses, name, objectiveId, focus];
  void (() => {
    props.onFocus(null);
    props.onOpenView('example-view');
    void props.mutate(() => example.getJson('/things'));
  });
  return null;
};

export const exampleUseCase: UseCaseShell = {
  id: 'example',
  name: 'Example — the smallest conforming shell',
  // Self-description. Optional, and pure data: the harness's Plugins surface
  // renders both, and nothing else in the contract reads either.
  version: '0.1.0',
  description: 'The smallest conforming shell, for the kit’s own type test.',
  accent: '#7c8cf8',
  vocabulary: { harness: 'worker' },
  views: [{ id: 'example-view', label: 'Example', order: 10, component: ExampleView }],
  dataSources: [SOURCE],
};

describe('an out-of-tree plugin', () => {
  it('is a plain exported object — importing it registers nothing', () => {
    expect(exampleUseCase.id).toBe('example');
    expect(exampleUseCase.views.map((v) => v.id)).toEqual(['example-view']);
  });

  it('may describe itself, and may equally decline to', () => {
    expect(exampleUseCase.version).toBe('0.1.0');
    expect(exampleUseCase.description).toContain('smallest conforming shell');
    // Both optional: a shell that omits them still typechecks, which is what
    // makes the addition non-breaking for a plugin in another repository.
    const terse: UseCaseShell = { id: 'terse', name: 'Terse', views: [] };
    expect(terse.version).toBeUndefined();
    expect(terse.description).toBeUndefined();
  });

  it('declares its own data source and builds its own client from it', () => {
    expect(exampleUseCase.dataSources).toEqual([SOURCE]);
    expect(example.config.baseUrl).toBe('http://localhost:9999');
  });

  it('needs nothing from the kit beyond the contract', async () => {
    // The whole runtime surface, named. Adding to this list is an API decision.
    // `setUseCaseEnv` is on it but is the HOST's to call, never a plugin's.
    const kit = await import('./index.js');
    expect(Object.keys(kit).sort()).toEqual(
      ['DataSourceError', 'createDataSource', 'resolveBaseUrl', 'setUseCaseEnv'].sort(),
    );
  });
});
