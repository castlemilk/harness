import type { UseCaseShell } from '@omega-harness/usecase-kit';

/**
 * A plugin entry module → the shell it provides.
 *
 * The generated roster (`virtual:foreman-plugins`, built in `vite.config.ts`)
 * imports each configured plugin as a namespace, because it cannot know the
 * export's *name*: `victoria/index.ts` exports `victoriaUseCase`, an
 * out-of-tree plugin will export something else, and forcing every plugin to
 * rename its export to a fixed identifier would be a contract change bought for
 * nothing. So the contract is on the *count* instead — **an entry module
 * exports exactly one `UseCaseShell`** (as `default`, or under any name) — and
 * this function is where that is enforced, with the plugin's path in the
 * message.
 *
 * It is a build-time check in every sense that matters: the generated roster
 * runs it at module load, before the app renders, so a plugin with two shells
 * or none stops the app at import with a stack trace rather than yielding a tab
 * that silently is not there.
 */
export function shellFromModule(module: unknown, source: string): UseCaseShell {
  if (typeof module !== 'object' || module === null) {
    throw new Error(`Foreman plugin ${source} did not evaluate to a module.`);
  }

  const record = module as Record<string, unknown>;
  const matches = Object.entries(record).filter(([, value]) => isShell(value));

  if (matches.length === 1) return matches[0][1] as UseCaseShell;

  if (matches.length === 0) {
    throw new Error(
      `Foreman plugin ${source} exports no UseCaseShell. ` +
        `An entry module must export exactly one shell object — ` +
        `\`export const myUseCase: UseCaseShell = { id, name, views: [...] }\`. ` +
        `Exports seen: ${Object.keys(record).join(', ') || '(none)'}.`
    );
  }

  // `default` wins over the named exports when both are present, which is the
  // one ambiguity worth resolving rather than rejecting: re-exporting the shell
  // as default alongside its named export is a normal thing to do.
  const byDefault = matches.find(([name]) => name === 'default');
  if (byDefault !== undefined) return byDefault[1] as UseCaseShell;

  throw new Error(
    `Foreman plugin ${source} exports ${String(matches.length)} UseCaseShells ` +
      `(${matches.map(([name]) => name).join(', ')}); it must export exactly one, ` +
      `or mark the one it provides as the default export.`
  );
}

/**
 * Structural, not nominal — the plugin may be compiled against its own copy of
 * the kit's types, and at runtime there is nothing but the object. `id` and
 * `views` are the two fields the registry cannot work without, so they are what
 * identifies a shell here; the registry itself does the real validation
 * (slug shape, duplicate view and source ids) when the roster is registered.
 */
function isShell(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; views?: unknown };
  return typeof candidate.id === 'string' && Array.isArray(candidate.views);
}
