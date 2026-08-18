/**
 * The shared primitives, asserted on what they actually emit.
 *
 * `renderToStaticMarkup` rather than a DOM: these are static presentational
 * components with nothing to click, and the package deliberately carries no
 * test environment. The assertions are on *values* — the exact class names and
 * the exact colours — because that is what a plugin in another repository is
 * depending on. "It rendered a span" would pass while `bg-panel` became
 * `bg-card` and every out-of-tree shell quietly stopped matching the app.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ago,
  clock,
  duration,
  elapsed,
  Panel,
  Pill,
  SectionLabel,
  statusColor,
  StatusDot,
  statusTextClass,
} from './index.js';

describe('Panel', () => {
  it('is a bordered panel surface that keeps the caller’s classes', () => {
    const html = renderToStaticMarkup(<Panel className="p-3">contents</Panel>);
    expect(html).toBe(
      '<div class="overflow-hidden rounded-[9px] border border-line bg-panel p-3">contents</div>',
    );
  });
});

describe('SectionLabel', () => {
  it('is the mono micro-heading, uppercase and faint', () => {
    const html = renderToStaticMarkup(<SectionLabel>Positions</SectionLabel>);
    expect(html).toContain('font-mono');
    expect(html).toContain('uppercase');
    expect(html).toContain('text-faint');
    expect(html).toContain('>Positions</div>');
  });
});

describe('Pill', () => {
  it('falls back to the neutral chip when no colour is given', () => {
    const html = renderToStaticMarkup(<Pill>LONG</Pill>);
    expect(html).toContain('border-line bg-control text-muted');
    expect(html).not.toContain('style=');
  });

  it('tints itself from a colour, deriving the background and border from it', () => {
    // The alpha suffixes are the contract: `1a` background, `4d` border, full
    // colour text. A shell passes its accent and gets a chip that belongs.
    const html = renderToStaticMarkup(<Pill color="#3fd97d">crisis</Pill>);
    expect(html).toContain('color:#3fd97d');
    expect(html).toContain('background:#3fd97d1a');
    expect(html).toContain('border-color:#3fd97d4d');
    expect(html).not.toContain('bg-control');
  });
});

describe('StatusDot', () => {
  it('draws the status colour and labels itself with the status', () => {
    const html = renderToStaticMarkup(<StatusDot status="working" />);
    expect(html).toContain('aria-label="working"');
    expect(html).toContain('background:#4ec97a');
    expect(html).toContain('width:6px');
  });

  it('breathes on live states and holds still on settled ones', () => {
    // watching/waiting are the states an operator is waiting *on*; a paused or
    // failed harness animating would read as activity that isn't happening.
    expect(renderToStaticMarkup(<StatusDot status="watching" />)).toContain('animate-bp');
    expect(renderToStaticMarkup(<StatusDot status="waiting" />)).toContain('animate-bp');
    expect(renderToStaticMarkup(<StatusDot status="failed" />)).not.toContain('animate-bp');
    // …unless the caller overrides it, which is what a "this one is live" list does.
    expect(renderToStaticMarkup(<StatusDot status="failed" pulse />)).toContain('animate-bp');
  });
});

describe('status colours', () => {
  it('answers one colour and one text class per harness state', () => {
    expect(statusColor('failed')).toBe('#e5675b');
    expect(statusColor('retired')).toBe('#2b2b33');
    expect(statusTextClass('working')).toBe('text-ok');
    expect(statusTextClass('waiting')).toBe('text-warn');
  });
});

describe('time formatting', () => {
  it('reads an instant as wall-clock, zero-padded', () => {
    const d = new Date(2026, 7, 18, 9, 4);
    expect(clock(d.toISOString())).toBe('09:04');
  });

  it('renders an absent or unparseable time as an em dash, never as a zero', () => {
    expect(clock(null)).toBe('—');
    expect(clock('not a date')).toBe('—');
    expect(duration(null)).toBe('—');
    expect(elapsed(undefined)).toBe('—');
    expect(ago(undefined)).toBe('—');
  });

  it('scales a span through minutes, hours and days', () => {
    expect(duration(4)).toBe('4m');
    expect(duration(66)).toBe('1.1h');
    expect(duration(13 * 60)).toBe('13h');
    expect(duration(48 * 60)).toBe('2d');
  });

  it('scales a measurement through seconds and minutes', () => {
    expect(elapsed(400)).toBe('0.4s');
    expect(elapsed(371_000)).toBe('6m 11s');
  });

  it('reads a timestamp as a distance from a given now', () => {
    const now = Date.parse('2026-08-18T12:00:00Z');
    expect(ago('2026-08-18T11:56:00Z', now)).toBe('4m ago');
  });
});
