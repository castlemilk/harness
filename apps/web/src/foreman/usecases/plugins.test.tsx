import { describe, expect, it } from 'vitest';
// `renderToStaticMarkup` rather than a DOM, matching `vocabulary.test.tsx`: the
// repo carries no jsdom, and what is asserted here is the text on a card.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import type { UseCaseShell, UseCaseViewProps } from '@omega-harness/usecase-kit';
import { pluginSources, shells as configuredShells } from 'virtual:foreman-plugins';
import { getUseCases } from './index.js';
import {
  pluginCards,
  pluginProvenance,
  PluginsView,
  sourceMap,
  suggestedObjectiveName,
} from './plugins.js';

/**
 * The Plugins surface: the roster made legible.
 *
 * The logic half is pure and tested as such — a card is derived from three
 * inputs (registry, roster provenance, objective list) and nothing else. The
 * render half is a smoke test with the real shells: the surface exists to make
 * a claim about *what this build shipped*, so a test that mocked the roster
 * would assert only that React works.
 */

const noopView = (() => null) as unknown as ComponentType<UseCaseViewProps>;

function shell(id: string, extra: Partial<UseCaseShell> = {}): UseCaseShell {
  return {
    id,
    name: `${id} — a domain`,
    views: [{ id: `${id}-one`, label: 'One', order: 20, component: noopView }],
    ...extra,
  };
}

describe('pluginProvenance', () => {
  it('reads a configured path lexically, the way discovery words its errors', () => {
    expect(pluginProvenance('packages/shells/victoria')).toBe('in-repo');
    expect(pluginProvenance('./local/thing')).toBe('in-repo');
    expect(pluginProvenance('../foreman-plugins/victoria')).toBe('out-of-tree');
    expect(pluginProvenance('/abs/foreman-plugins/victoria')).toBe('out-of-tree');
  });

  it('calls a shell with no configured path host-owned', () => {
    // The demo shell is registered by the roster module itself, not by
    // `foreman-plugins.json` — deliberately, so nobody can ship it.
    expect(pluginProvenance(null)).toBe('host');
    expect(pluginProvenance(undefined)).toBe('host');
  });
});

describe('sourceMap', () => {
  it('zips `pluginSources` onto the shells it generated, by position', () => {
    expect(sourceMap([shell('a'), shell('b')], ['../x/a', '../x/b'])).toEqual({
      a: '../x/a',
      b: '../x/b',
    });
  });

  it('leaves a shell out rather than guessing when the roster is shorter', () => {
    expect(sourceMap([shell('a'), shell('b')], ['../x/a'])).toEqual({ a: '../x/a' });
  });
});

describe('pluginCards', () => {
  const shells = [
    shell('victoria', {
      name: 'Victoria — market trading',
      version: '0.1.0',
      description: 'Trading over the omega engine.',
      accent: '#3fd97d',
      views: [
        { id: 'victoria-two', label: 'Two', order: 20, component: noopView },
        { id: 'victoria-one', label: 'One', order: 10, component: noopView },
      ],
      dataSources: [{ id: 'omega', label: 'Omega API', baseUrl: 'http://localhost:8080' }],
    }),
    shell('polymarket'),
    shell('demo'),
  ];
  const sources = { victoria: '../foreman-plugins/victoria', polymarket: '../foreman-plugins/polymarket' };
  const objectives = [
    { id: 'o1', name: 'Run the desk', useCase: 'victoria' },
    { id: 'o2', name: 'Support queue', useCase: null },
    { id: 'o3', name: 'Second desk', useCase: 'victoria' },
    { id: 'o4', name: 'Predictions', useCase: 'polymarket' },
  ];

  it('derives the card from the manifest, verbatim', () => {
    const [victoria] = pluginCards(shells, sources, objectives);
    expect(victoria.version).toBe('0.1.0');
    expect(victoria.description).toBe('Trading over the omega engine.');
    expect(victoria.accent).toBe('#3fd97d');
    expect(victoria.source).toBe('../foreman-plugins/victoria');
    expect(victoria.provenance).toBe('out-of-tree');
    expect(victoria.devOnly).toBe(false);
  });

  it('lists views in tab order, not manifest order, and names the jump target', () => {
    const [victoria] = pluginCards(shells, sources, objectives);
    expect(victoria.views.map((v) => v.label)).toEqual(['One', 'Two']);
    expect(victoria.firstViewId).toBe('victoria-one');
  });

  it('finds the objectives that carry the shell, and only those', () => {
    const [victoria, polymarket] = pluginCards(shells, sources, objectives);
    expect(victoria.objectives).toEqual([
      { id: 'o1', name: 'Run the desk' },
      { id: 'o3', name: 'Second desk' },
    ]);
    expect(polymarket.objectives.map((o) => o.id)).toEqual(['o4']);
  });

  it('marks a shell nothing configured as dev-only, and shows no path for it', () => {
    const demo = pluginCards(shells, sources, objectives)[2];
    expect(demo.devOnly).toBe(true);
    expect(demo.source).toBeNull();
    expect(demo.provenance).toBe('host');
    // No objective carries it in this fixture, which is the state the card
    // turns into the "start an objective" action.
    expect(demo.objectives).toEqual([]);
  });

  it('reports no version, description or sources as absent rather than empty-ish', () => {
    const polymarket = pluginCards(shells, sources, objectives)[1];
    expect(polymarket.version).toBeNull();
    expect(polymarket.description).toBeNull();
    expect(polymarket.dataSources).toEqual([]);
  });
});

describe('suggestedObjectiveName', () => {
  it('turns the manifest’s two halves into a sentence', () => {
    expect(suggestedObjectiveName({ id: 'victoria', name: 'Victoria — market trading' })).toBe(
      'Victoria market trading',
    );
  });

  it('uses a dash-less name as it stands', () => {
    expect(suggestedObjectiveName({ id: 'x', name: 'Support triage' })).toBe('Support triage');
  });
});

/**
 * The render smoke tests run against the **real** roster — the same generated
 * module `vite build` uses — so they are also the harness's account of what an
 * operator sees on this tab today.
 */
describe('PluginsView', () => {
  const registered = getUseCases();
  const sources = sourceMap(configuredShells, pluginSources);
  const objectives = [
    { id: 'o1', name: 'Run the Victoria trading desk', useCase: 'victoria' },
    { id: 'o2', name: 'Keep the support queue at zero', useCase: null },
  ];

  function render(objectiveList: typeof objectives) {
    return renderToStaticMarkup(
      <PluginsView
        shells={registered}
        sourceById={sources}
        objectives={objectiveList}
        onOpenObjective={() => undefined}
        onStartObjective={() => Promise.resolve()}
        canCreate
      />,
    );
  }

  it('shows Victoria with its name, version, source and every view label', () => {
    const html = render(objectives);
    expect(html).toContain('Victoria — market trading');
    expect(html).toContain('v0.1.0');
    expect(html).toContain('../foreman-plugins/victoria');
    expect(html).toContain('out-of-tree');
    expect(html).toContain('10 views');
    for (const label of ['Overview', 'Runs', 'Live', 'Trades', 'Equity', 'Signals', 'Gates', 'Conviction', 'Forensics', 'Journal']) {
      expect(html).toContain(`>${label}</span>`);
    }
    // Its one declared backend, with the URL the operator would curl.
    expect(html).toContain('Omega API');
    expect(html).toContain('http://localhost:8080');
  });

  it('pills the dev-only shell rather than hiding it', () => {
    // Hiding it would make this surface disagree with the tab bar, which is the
    // one thing it exists to explain.
    expect(render(objectives)).toContain('dev only');
  });

  it('offers to start an objective for a shell no objective uses', () => {
    const html = render(objectives);
    expect(html).toContain('No objective uses it');
    expect(html).toContain('Start an objective with this use-case');
  });

  it('jumps instead, once an objective carries the shell', () => {
    const html = render(objectives);
    expect(html).toContain('1 objective using it');
    expect(html).toContain('Run the Victoria trading desk');
  });

  it('explains the config file when nothing is registered', () => {
    const html = renderToStaticMarkup(
      <PluginsView
        shells={[]}
        sourceById={{}}
        objectives={[]}
        onOpenObjective={() => undefined}
        onStartObjective={() => Promise.resolve()}
        canCreate={false}
      />,
    );
    expect(html).toContain('No shells registered');
    expect(html).toContain('foreman-plugins.json');
    expect(html).toContain('docs/USE-CASE-SHELLS.md');
  });
});
