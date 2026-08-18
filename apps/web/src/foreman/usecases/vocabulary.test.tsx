import { describe, expect, it } from 'vitest';
// `renderToStaticMarkup` rather than a DOM: the repo carries no jsdom and no
// testing-library, and the assertion here is about the *text* a label renders.
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandPalette } from '../surfaces/CommandPalette.js';
import type { Harness } from '../types.js';
import { getUseCase } from './index.js';
import { caps, pluralise, vocabularyTerms, VocabularyProvider } from './vocabulary.js';

/**
 * The vocabulary seam: a shell renames a display term, and the chrome-level
 * labels listed in `vocabulary.tsx` say the shell's word instead of Foreman's.
 *
 * Until UC-4's review `vocabulary` was declared, documented and read by nothing
 * — victoria's `{ harness: 'desk agent' }` reached no pixel. These tests are
 * the record that it now does, and of exactly how far it reaches.
 */

describe('vocabularyTerms', () => {
  it('keeps Foreman’s words when no shell is active', () => {
    expect(vocabularyTerms()).toEqual({
      harness: 'harness',
      harnesses: 'harnesses',
      pulse: 'pulse',
      pulses: 'pulses',
      objective: 'objective',
      objectives: 'objectives',
    });
  });

  it('applies the active shell’s renames and leaves the rest alone', () => {
    // Read off the registered Victoria manifest, not a hand-written copy.
    const terms = vocabularyTerms(getUseCase('victoria')?.vocabulary);
    expect(terms.harness).toBe('desk agent');
    expect(terms.harnesses).toBe('desk agents');
    expect(terms.pulse).toBe('pulse');
    expect(terms.objective).toBe('objective');
  });

  it('ignores a rename to the empty string, which is a manifest mistake', () => {
    expect(vocabularyTerms({ harness: '' }).harness).toBe('harness');
  });

  it('pluralises and capitalises the way the labels need', () => {
    expect(pluralise('harness')).toBe('harnesses');
    expect(pluralise('desk agent')).toBe('desk agents');
    expect(pluralise('box')).toBe('boxes');
    expect(pluralise('watch')).toBe('watches');
    expect(caps('desk agents')).toBe('Desk agents');
    expect(caps('')).toBe('');
  });
});

const harness = (id: string): Harness => ({
  id,
  name: id,
  parentId: null,
  objectiveId: 'obj',
  workstreamId: null,
  status: 'working',
  activity: '',
  mission: '',
  currentJob: '',
  model: 'gpt-5',
  contextUsed: 0.2,
  spend: 1,
  spendCap: 5,
  subtreeSpend: 1,
  heartbeatMinutes: 30,
  nextPulseInMinutes: 5,
  childCount: 0,
  maxChildren: 3,
  idleMinutes: null,
  latestPulseSeq: 1,
  recentPulses: [],
  routine: [],
  playbookId: null,
  branch: null,
  ticketId: null,
});

function palette(vocabulary?: Record<string, string>): string {
  return renderToStaticMarkup(
    <VocabularyProvider vocabulary={vocabulary}>
      <CommandPalette
        open
        onClose={() => undefined}
        harnesses={[harness('control-lead')]}
        tickets={[]}
        onOpenHarness={() => undefined}
        onOpenTicket={() => undefined}
        onRunVerb={() => undefined}
      />
    </VocabularyProvider>,
  );
}

describe('the chrome labels', () => {
  it('says the shell’s word with victoria active', () => {
    const markup = palette(getUseCase('victoria')?.vocabulary);
    expect(markup).toContain('Desk agents');
    expect(markup).toContain('Jump to a desk agent or ticket, or type a verb…');
    expect(markup).not.toContain('Harnesses');
  });

  it('says Foreman’s word with no shell active', () => {
    const markup = palette();
    expect(markup).toContain('Harnesses');
    expect(markup).toContain('Jump to a harness or ticket, or type a verb…');
    expect(markup).not.toContain('Desk agents');
  });
});
