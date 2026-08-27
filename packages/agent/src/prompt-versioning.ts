import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AGENT_SYSTEM_PROMPT, TEXT_TOOLS_SYSTEM_PROMPT } from './prompts.js';
import { PLAN_PROMPT } from './planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = path.resolve(__dirname, '..', 'src', 'prompts.ts');

export interface PromptVersionInput {
  name: string;
  sourcePath: string;
  systemPrompt: string;
  textToolsPrompt: string;
  planningPrompt?: string;
  skillContext?: string;
  hash: string;
  metadata?: Record<string, unknown>;
}

function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function hashPrompts(input: {
  systemPrompt: string;
  textToolsPrompt: string;
  planningPrompt?: string;
  skillContext?: string;
}): string {
  return hashString(
    [
      input.systemPrompt,
      input.textToolsPrompt,
      input.planningPrompt ?? '',
      input.skillContext ?? '',
    ].join('\n---\n')
  );
}

/**
 * The prompts the agent actually runs.
 *
 * Read from the imported constants rather than by scanning `prompts.ts` for
 * template literals. The scan was the original implementation and it rotted:
 * once the prompts stopped being plain backtick literals (they are now built
 * from joined section constants, one interpolating the other), the regexes
 * either missed — silently falling back — or matched and returned the RAW
 * source (`'${AGENT_SYSTEM_PROMPT}\n\n…'`) instead of its evaluated value, so
 * the ledger recorded prompt text that was never sent to a model while the
 * hash stayed stable enough to hide the lie.
 *
 * The constants ARE the truth: they already apply their `OMEGA_*_PROMPT` env
 * overrides at import time, which the source scan never saw either.
 */
export function readPromptsSource(): { systemPrompt: string; textToolsPrompt: string } {
  return { systemPrompt: AGENT_SYSTEM_PROMPT, textToolsPrompt: TEXT_TOOLS_SYSTEM_PROMPT };
}

export function loadCurrentPrompts(skillContext?: string): PromptVersionInput {
  const { systemPrompt, textToolsPrompt } = readPromptsSource();
  return {
    name: `auto-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    sourcePath: PROMPTS_PATH,
    systemPrompt,
    textToolsPrompt,
    planningPrompt: PLAN_PROMPT,
    skillContext,
    hash: hashPrompts({ systemPrompt, textToolsPrompt, planningPrompt: PLAN_PROMPT, skillContext }),
  };
}

/**
 * Embed a prompt string inside a template literal in source code.
 *
 * Prompt text comes out of models and must be treated as adversarial to the
 * file format: a backtick or `${` in an unescaped position would terminate or
 * reinterpret the literal, corrupting everything after it in `prompts.ts`.
 */
function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function envVarFor(name: string): string {
  return `OMEGA_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_PROMPT`;
}

/**
 * Write new prompt text back into `prompts.ts`.
 *
 * Replaces each whole `export const <NAME> = …;` statement — from its
 * declaration up to the next top-level `export` — with the env-override form:
 *
 *   export const AGENT_SYSTEM_PROMPT =
 *     loadPromptFromEnv('OMEGA_SYSTEM_PROMPT') ??
 *     `<new text>`;
 *
 * The previous implementation patched with a regex that assumed the statement
 * was a single backtick literal. When the prompts grew into multi-line
 * expressions over several constants, that regex simply stopped matching, and
 * `String.replace` turned every "successful" save into a silent no-op — the
 * self-improvement loop reporting edits it never made. Two guards keep that
 * class of failure loud instead: a statement that cannot be found throws, and
 * the file is re-read after writing to confirm the new text actually landed.
 */
export async function saveCurrentPrompts(
  input: Pick<PromptVersionInput, 'systemPrompt' | 'textToolsPrompt'>,
  targetPath: string = PROMPTS_PATH
): Promise<void> {
  let updated = await fs.readFile(targetPath, 'utf-8');

  const replaceStatement = (source: string, name: string, value: string): string => {
    const start = source.indexOf(`export const ${name} =`);
    if (start === -1) {
      throw new Error(
        `saveCurrentPrompts: \`export const ${name}\` not found in ${targetPath} — ` +
          `the prompt file's shape has changed; update this writer.`
      );
    }
    // Statement end: the next top-level declaration (`export`, `function`,
    // `const`, …) or end of file. Checking several leading keywords matters:
    // the prompt file interleaves exported statements with plain functions
    // (e.g. helpers between TEXT_TOOLS_SYSTEM_PROMPT and the builders), and a
    // single-keyword scan would swallow them into the replacement.
    let end = source.length;
    for (const kw of ['\nexport ', '\nfunction ', '\nconst ', '\nlet ', '\nclass ', '\ntype ', '\ninterface ']) {
      const idx = source.indexOf(kw, start + 1);
      if (idx !== -1 && idx < end) end = idx + 1;
    }
    const statement =
      `export const ${name} =\n` +
      `  loadPromptFromEnv('${envVarFor(name)}') ??\n` +
      `  \`${escapeTemplateLiteral(value)}\`;\n`;
    return source.slice(0, start) + statement + source.slice(end);
  };

  updated = replaceStatement(updated, 'AGENT_SYSTEM_PROMPT', input.systemPrompt);
  updated = replaceStatement(updated, 'TEXT_TOOLS_SYSTEM_PROMPT', input.textToolsPrompt);

  await fs.writeFile(targetPath, updated, 'utf-8');

  // Confirm the write landed — the guard the silent no-op made necessary.
  const verified = await fs.readFile(targetPath, 'utf-8');
  for (const [name, value] of [
    ['AGENT_SYSTEM_PROMPT', input.systemPrompt],
    ['TEXT_TOOLS_SYSTEM_PROMPT', input.textToolsPrompt],
  ] as const) {
    if (!verified.includes(`loadPromptFromEnv('${envVarFor(name)}') ??\n  \`${escapeTemplateLiteral(value)}\``)) {
      throw new Error(`saveCurrentPrompts: wrote ${name} but the file does not carry the new text`);
    }
  }
}

export function envForPrompts(input: Pick<PromptVersionInput, 'systemPrompt' | 'textToolsPrompt'>): Record<string, string> {
  return {
    OMEGA_SYSTEM_PROMPT: input.systemPrompt,
    OMEGA_TEXT_TOOLS_PROMPT: input.textToolsPrompt,
  };
}
