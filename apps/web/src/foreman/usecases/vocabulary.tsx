import { createContext, useContext, type ReactNode } from 'react';
import type { Vocabulary } from './registry.js';

/**
 * The vocabulary seam.
 *
 * A shell may rename three display terms — `harness`, `pulse`, `objective` —
 * because in some domains Foreman's word is the wrong one out loud: a Victoria
 * harness really is a *desk agent*, and an operator saying "spawn a desk agent"
 * should see that phrase in the chrome.
 *
 * It is deliberately NARROW, and this is the whole of it: the renaming reaches
 * the **chrome-level labels** listed in `docs/USE-CASE-SHELLS.md` — the roster
 * filter, the empty focus panel, the command palette's harness section and the
 * graph inspector's cost heading. It does not reach body copy, tooltips,
 * mission text or a shell's own views. Threading a rename through every
 * sentence in six core views would mean every future label in those views
 * silently opting out of a promise the manifest makes, which is worse than a
 * small promise kept exactly.
 *
 * Delivery is a context rather than props because the labels sit four and five
 * components deep in shells that are otherwise presentational, and widening
 * their prop signatures for a word would be a worse trade than one provider at
 * the root of `ForemanApp`.
 */

/** Foreman's own words, used whenever a shell doesn't rename one. */
export const FOREMAN_WORDS = {
  harness: 'harness',
  pulse: 'pulse',
  objective: 'objective',
} as const;

/** The resolved words, singular and plural, ready to drop into a label. */
export interface Terms {
  harness: string;
  harnesses: string;
  pulse: string;
  pulses: string;
  objective: string;
  objectives: string;
}

/**
 * English plural, for the three words this can be handed plus whatever a shell
 * renames them to. 'harness' → 'harnesses', 'desk agent' → 'desk agents'. A
 * shell whose word pluralises irregularly is out of scope on purpose: the
 * alternative is a plural field per term on the manifest, which is a lot of
 * contract for a case no shell has.
 */
export function pluralise(word: string): string {
  return /(?:s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

/** Capitalise a term for a heading: `caps('desk agents')` → 'Desk agents'. */
export function caps(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

/** Resolve a shell's vocabulary (or none) into the words the chrome renders. */
export function vocabularyTerms(vocabulary?: Vocabulary): Terms {
  const word = (key: keyof typeof FOREMAN_WORDS): string => {
    const renamed = vocabulary?.[key];
    // An empty string is a manifest mistake, not a rename to nothing.
    return renamed !== undefined && renamed !== '' ? renamed : FOREMAN_WORDS[key];
  };
  const harness = word('harness');
  const pulse = word('pulse');
  const objective = word('objective');
  return {
    harness,
    harnesses: pluralise(harness),
    pulse,
    pulses: pluralise(pulse),
    objective,
    objectives: pluralise(objective),
  };
}

const VocabularyContext = createContext<Terms>(vocabularyTerms());

/** Wraps the app in the active shell's words. No shell ⇒ Foreman's own. */
export function VocabularyProvider({
  vocabulary,
  children,
}: {
  vocabulary?: Vocabulary;
  children: ReactNode;
}) {
  return (
    <VocabularyContext.Provider value={vocabularyTerms(vocabulary)}>
      {children}
    </VocabularyContext.Provider>
  );
}

/** The words for the active shell. Outside a provider these are Foreman's. */
export function useVocabulary(): Terms {
  return useContext(VocabularyContext);
}
