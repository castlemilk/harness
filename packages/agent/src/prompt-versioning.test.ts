import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { envForPrompts, hashPrompts, loadCurrentPrompts, saveCurrentPrompts } from './prompt-versioning.js';
import { AGENT_SYSTEM_PROMPT, TEXT_TOOLS_SYSTEM_PROMPT } from './prompts.js';
import { PLAN_PROMPT } from './planner.js';

/**
 * The self-improvement ledger's identity function.
 *
 * Everything above this test — benchmark scoring per hash, "did the optimise
 * edit help" — assumes one thing: that a prompt change changes the hash and
 * nothing else does. These assertions pin that.
 */
describe('hashPrompts', () => {
  const base = {
    systemPrompt: 'system',
    textToolsPrompt: 'tools',
    planningPrompt: 'plan',
    skillContext: 'skill',
  };

  it('is deterministic for identical inputs', () => {
    expect(hashPrompts(base)).toBe(hashPrompts({ ...base }));
  });

  it('changes when any prompt component changes', () => {
    const hashes = [
      hashPrompts({ ...base, systemPrompt: 'system2' }),
      hashPrompts({ ...base, textToolsPrompt: 'tools2' }),
      hashPrompts({ ...base, planningPrompt: 'plan2' }),
      hashPrompts({ ...base, skillContext: 'skill2' }),
    ];
    for (const hash of hashes) {
      expect(hash).not.toBe(hashPrompts(base));
    }
    // …and each component matters independently.
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('treats absent optional fields as empty, not as their neighbours would', () => {
    expect(hashPrompts({ systemPrompt: 'a', textToolsPrompt: 'b' })).toBe(
      hashPrompts({ systemPrompt: 'a', textToolsPrompt: 'b', planningPrompt: '', skillContext: '' })
    );
  });

  it('is the documented 16-hex-char digest', () => {
    expect(hashPrompts(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('loadCurrentPrompts', () => {
  it('reads the live prompt sources and hashes what it read', async () => {
    const input = await loadCurrentPrompts('ctx');
    // The regex extraction should agree with the exported constants for the
    // checked-in sources — if they drift, the ledger records prompts the
    // agent is not actually running.
    expect(input.systemPrompt).toBe(AGENT_SYSTEM_PROMPT);
    expect(input.textToolsPrompt).toBe(TEXT_TOOLS_SYSTEM_PROMPT);
    expect(input.planningPrompt).toBe(PLAN_PROMPT);
    expect(input.skillContext).toBe('ctx');
    expect(input.hash).toBe(
      hashPrompts({
        systemPrompt: input.systemPrompt,
        textToolsPrompt: input.textToolsPrompt,
        planningPrompt: input.planningPrompt,
        skillContext: 'ctx',
      })
    );
    // Auto-generated names sort chronologically, which is how unlabelled
    // versions stay distinguishable in the ledger.
    expect(input.name).toMatch(/^auto-\d{4}-\d{2}-\d{2}T/);
    expect(input.sourcePath).toContain('prompts.ts');
  });

  it('produces the same hash twice in a row when sources are unchanged', async () => {
    const [first, second] = await Promise.all([loadCurrentPrompts(), loadCurrentPrompts()]);
    expect(first.hash).toBe(second.hash);
    // Equal prompts are ONE version — names may even collide within a
    // millisecond, which is fine: dedupe is by hash, never by name.
  });
});

describe('saveCurrentPrompts', () => {
  // A copy of the real prompts.ts: the writer's whole job is rewriting THIS
  // shape, so the test must run against the shape, not a lookalike.
  const readSource = async (): Promise<string> => {
    const fs = await import('node:fs/promises');
    return fs.readFile(new URL('./prompts.ts', import.meta.url), 'utf-8');
  };

  it('rewrites both statements on a copy of the real prompt file', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const tmp = path.join(os.tmpdir(), `prompt-versioning-${String(Date.now())}.ts`);
    await fs.writeFile(tmp, await readSource(), 'utf-8');

    try {
      await saveCurrentPrompts(
        { systemPrompt: 'NEW SYSTEM', textToolsPrompt: 'NEW TOOLS `with` ${tricky}' },
        tmp
      );
      const written = await fs.readFile(tmp, 'utf-8');
      expect(written).toContain('`NEW SYSTEM`');
      expect(written).toContain('`NEW TOOLS \\`with\\` \\${tricky}`');
      // The untouched neighbours survive the statement surgery: the section
      // constants above, the FORCE_ACTION statement between the two targets,
      // and — the regression that matters — the non-exported helper AFTER the
      // last target, which a "next export" boundary scan would swallow.
      expect(written).toContain('export const PROMPT_IMPLEMENTATION');
      expect(written).toContain('export const FORCE_ACTION_PROMPT');
      expect(written).toContain('function extractRequiredApiSurface');
      expect(written).toContain('export function buildSystemPrompt');
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });

  it('throws when a statement is missing instead of silently writing nothing', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const tmp = path.join(os.tmpdir(), `prompt-versioning-missing-${String(Date.now())}.ts`);
    await fs.writeFile(tmp, 'export const SOMETHING_ELSE = 1;\n', 'utf-8');
    try {
      await expect(saveCurrentPrompts({ systemPrompt: 'a', textToolsPrompt: 'b' }, tmp)).rejects.toThrow(
        /not found in .*prompt file's shape has changed/
      );
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });

  it('is idempotent — saving twice lands the same text', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const tmp = path.join(os.tmpdir(), `prompt-versioning-idem-${String(Date.now())}.ts`);
    await fs.writeFile(tmp, await readSource(), 'utf-8');
    try {
      await saveCurrentPrompts({ systemPrompt: 'S2', textToolsPrompt: 'T2' }, tmp);
      const once = await fs.readFile(tmp, 'utf-8');
      await saveCurrentPrompts({ systemPrompt: 'S2', textToolsPrompt: 'T2' }, tmp);
      expect(await fs.readFile(tmp, 'utf-8')).toBe(once);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });
});

describe('envForPrompts', () => {
  it('maps prompts onto the env overrides the executor honours', () => {
    const env = envForPrompts({ systemPrompt: 's', textToolsPrompt: 't' });
    expect(env).toEqual({
      OMEGA_SYSTEM_PROMPT: 's',
      OMEGA_TEXT_TOOLS_PROMPT: 't',
    });
    // Round trip: hashing the env-carried prompts equals hashing the originals.
    expect(hashPrompts({ systemPrompt: env.OMEGA_SYSTEM_PROMPT ?? '', textToolsPrompt: env.OMEGA_TEXT_TOOLS_PROMPT ?? '' })).toBe(
      hashPrompts({ systemPrompt: 's', textToolsPrompt: 't' })
    );
  });
});
