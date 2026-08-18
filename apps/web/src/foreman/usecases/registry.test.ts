import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import {
  findUseCaseView,
  getUseCase,
  getUseCases,
  registerUseCase,
  resolveViewId,
  unregisterUseCase,
  viewTabs,
  type UseCaseShell,
  type UseCaseViewProps,
} from './registry.js';
import { CORE_VIEWS, DEFAULT_VIEW } from './core.js';
// Importing the roster is what registers the demo shell, exactly as the app
// does. Nothing here registers 'demo' itself, so the two cannot collide.
import './index.js';

/**
 * The use-case shell seam: what a shell may add, what it may not shadow, and
 * what the tab bar becomes for an objective with and without one.
 */

const noopView = (() => null) as unknown as ComponentType<UseCaseViewProps>;

function shell(id: string, viewIds: string[], extra: Partial<UseCaseShell> = {}): UseCaseShell {
  return {
    id,
    name: `${id} shell`,
    views: viewIds.map((viewId, i) => ({
      id: viewId,
      label: viewId.toUpperCase(),
      order: (i + 1) * 10,
      component: noopView,
    })),
    ...extra,
  };
}

const registered: string[] = [];
function register(s: UseCaseShell): UseCaseShell {
  registerUseCase(s);
  registered.push(s.id);
  return s;
}

afterEach(() => {
  while (registered.length > 0) unregisterUseCase(registered.pop() as string);
});

describe('registerUseCase', () => {
  it('makes a shell resolvable by the id an objective carries', () => {
    register(shell('trading-desk', ['positions'], { accent: '#3ad1a0' }));
    expect(getUseCase('trading-desk')?.name).toBe('trading-desk shell');
    expect(getUseCase('trading-desk')?.accent).toBe('#3ad1a0');
    expect(getUseCase('nope')).toBeNull();
    expect(getUseCase(null)).toBeNull();
    expect(getUseCase(undefined)).toBeNull();
  });

  it('rejects a duplicate shell id instead of shadowing the first', () => {
    // Silently overwriting means one registration never renders, and there is
    // nothing at runtime to point at.
    register(shell('trading-desk', ['positions']));
    expect(() => { registerUseCase(shell('trading-desk', ['other'])); }).toThrow(
      'Use case "trading-desk" is already registered',
    );
    expect(getUseCases().filter((s) => s.id === 'trading-desk')).toHaveLength(1);
  });

  it('rejects a view id repeated inside one shell', () => {
    expect(() => { registerUseCase(shell('dupe', ['a', 'a'])); }).toThrow(
      'Use case "dupe" registers view "a" twice',
    );
    expect(getUseCase('dupe')).toBeNull();
  });

  it('rejects a data source id repeated inside one shell', () => {
    // Two sources under one id means one health dot silently replaces the
    // other, and the operator watches a backend they aren't looking at.
    const source = { id: 'omega-api', label: 'Omega API', baseUrl: 'http://localhost:8080' };
    expect(() => {
      registerUseCase(
        shell('dupe-source', ['a'], { dataSources: [source, { ...source, label: 'Other' }] }),
      );
    }).toThrow('Use case "dupe-source" declares data source "omega-api" twice');
    expect(getUseCase('dupe-source')).toBeNull();
  });

  it('keeps the declared sources on the shell for the chrome to probe', () => {
    const source = {
      id: 'omega-api',
      label: 'Omega API',
      baseUrl: 'http://localhost:8080',
      envVar: 'VITE_UC_VICTORIA_URL',
      probePath: '/api/v1/dashboard/status',
    };
    register(shell('trading-desk', ['positions'], { dataSources: [source] }));
    expect(getUseCase('trading-desk')?.dataSources).toEqual([source]);
    // A shell that declares none is the normal case and must stay undefined,
    // so the chrome renders nothing rather than an empty indicator.
    register(shell('plain', ['a']));
    expect(getUseCase('plain')?.dataSources).toBeUndefined();
  });

  it('rejects an id that is not a lowercase slug, matching the server rule', () => {
    expect(() => { registerUseCase(shell('Victoria Trading', ['a'])); }).toThrow(
      'Use-case id must be a lowercase slug: "Victoria Trading"',
    );
  });

  it('unwinds a registration completely', () => {
    register(shell('temp', ['a']));
    expect(unregisterUseCase('temp')).toBe(true);
    registered.pop();
    expect(getUseCase('temp')).toBeNull();
    expect(unregisterUseCase('temp')).toBe(false);
  });
});

describe('viewTabs', () => {
  it('gives an objective with no use case exactly the six core tabs', () => {
    expect(viewTabs(CORE_VIEWS, null).map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
    ]);
    expect(viewTabs(CORE_VIEWS, null).map((t) => t.label)).toEqual([
      'Console',
      'Board',
      'Graph',
      'Work',
      'Usage',
      'Playbooks',
    ]);
    expect(viewTabs(CORE_VIEWS, null).every((t) => t.source === 'core')).toBe(true);
    expect(DEFAULT_VIEW).toBe('console');
  });

  it('appends the demo shell tab after the core six for a demo objective', () => {
    // The roster registers 'demo' outside production; this is the end-to-end
    // proof that a server-side `useCase` becomes a tab.
    const tabs = viewTabs(CORE_VIEWS, 'demo');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'demo-overview',
    ]);
    expect(tabs[6]).toEqual({ id: 'demo-overview', label: 'Demo', source: 'usecase' });
    expect(tabs.filter((t) => t.source === 'core')).toHaveLength(6);
  });

  it('leaves the tab bar untouched for a useCase nothing registered', () => {
    expect(viewTabs(CORE_VIEWS, 'never-registered').map((t) => t.id))
      .toEqual(viewTabs(CORE_VIEWS, null).map((t) => t.id));
  });

  it('orders use-case views by order, and refuses to shadow a core tab', () => {
    // A throwaway id, deliberately not 'victoria': the roster imported above
    // registers the real Victoria shell, and reusing its id would collide.
    register({
      id: 'shadow-probe',
      name: 'Shadow probe',
      views: [
        { id: 'positions', label: 'Positions', order: 20, component: noopView },
        { id: 'console', label: 'Hijacked', order: 5, component: noopView },
        { id: 'signals', label: 'Signals', order: 10, component: noopView },
      ],
    });
    const tabs = viewTabs(CORE_VIEWS, 'shadow-probe');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'signals',
      'positions',
    ]);
    // The core Console survives; the shell's 'console' view is dropped.
    expect(tabs[0].label).toBe('Console');
  });
});

describe('resolveViewId', () => {
  const coreTabs = viewTabs(CORE_VIEWS, null);

  it('keeps a view that exists on this objective', () => {
    expect(resolveViewId(coreTabs, 'usage')).toBe('usage');
    expect(resolveViewId(viewTabs(CORE_VIEWS, 'demo'), 'demo-overview')).toBe('demo-overview');
  });

  it('falls back to the first core view for an unknown id', () => {
    // Switching away from a demo objective with its own tab open used to leave
    // a blank pane; the operator must land on a real surface.
    expect(resolveViewId(coreTabs, 'demo-overview')).toBe('console');
    expect(resolveViewId(coreTabs, 'legacy')).toBe('console');
    expect(resolveViewId(coreTabs, '')).toBe('console');
  });
});

describe('findUseCaseView', () => {
  it('resolves a registered shell view and nothing else', () => {
    expect(findUseCaseView('demo', 'demo-overview')?.label).toBe('Demo');
    expect(findUseCaseView('demo', 'console')).toBeNull();
    expect(findUseCaseView(null, 'demo-overview')).toBeNull();
    expect(findUseCaseView('demo', 'missing')).toBeNull();
  });
});
