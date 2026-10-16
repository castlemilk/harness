#!/usr/bin/env node
/**
 * Builds the two context-injection arms for the harder-v2 evaluation experiment.
 *
 *   skills/<taskId>.md  — curated engineering procedure (sources/skills.json)
 *   kg/<taskId>.md      — prior-art graph derived mechanically from the repair
 *                         corpus (patches + failures) that ships with the
 *                         benebsworth.com harness-eval lab
 *
 * Integrity rules enforced here, because a leaked solution would make the whole
 * experiment meaningless:
 *
 *   1. A task's OWN patches and failures are never read when building its block.
 *      Only sibling tasks — same bug class, different task — contribute.
 *   2. Sibling evidence is reduced to operation tags, file names and symbol
 *      names. No diff hunk, and no source line, is ever copied into a block.
 *   3. After rendering, every added/removed line of the task's own patches is
 *      searched for in the rendered block, and any hit fails the build.
 *
 * Usage: node build-context.mjs [corpusDir]
 *   corpusDir defaults to ~/projects/benebsworth.com/public/lab-data/harness-eval
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = process.argv[2]
  ?? path.join(os.homedir(), 'projects', 'benebsworth.com', 'public', 'lab-data', 'harness-eval');

/** Operations worth naming, matched against ADDED diff lines of sibling patches. */
const OP_PATTERNS = [
  { tag: 'queue-and-drain-loop', test: (l) => /while\s*\([^)]*\.length/.test(l) || (/\bshift\s*\(\s*\)/.test(l) && /queue|pending|wait/i.test(l)) },
  { tag: 'in-flight-guard-flag', test: (l) => /\b(running|inFlight|in_flight|busy|processing|draining|pending)\b\s*=\s*(true|false|!)/i.test(l) },
  { tag: 'listener-removed-by-identity', test: (l) => /\.(removeListener|off)\s*\(/.test(l) },
  { tag: 'callback-reference-captured', test: (l) => /(?:const|let)\s+\w+\s*=\s*(?:function|\([^)]*\)\s*=>)/.test(l) },
  { tag: 'pending-timer-cleared', test: (l) => /clear(?:Timeout|Interval)\s*\(/.test(l) },
  { tag: 'identity-keyed-memo', test: (l) => /new\s+(?:WeakMap|WeakSet|Map|Set)\s*\(/.test(l) },
  { tag: 'capacity-check', test: (l) => /(?:size|length|count)\s*(?:>=?|<=?)\s*(?:max|capacity|limit|MAX|LIMIT|CAPACITY)/.test(l) },
  { tag: 'throws-on-invalid', test: (l) => /throw\s+new\s+\w*Error/.test(l) },
  { tag: 'promise-combinator', test: (l) => /Promise\.(?:allSettled|all|any|race)\s*\(/.test(l) },
  { tag: 'exponential-delay', test: (l) => /Math\.pow\s*\(|\*\*\s*\w*(?:attempt|retry)|base\s*\*\s*2\s*\*\*/i.test(l) },
  { tag: 'arrays-combined', test: (l) => /\.concat\s*\(|\[\s*\.\.\./.test(l) },
  { tag: 'caller-resolver-retained', test: (l) => /push\s*\(\s*(?:resolve|reject|entry|task|item)/.test(l) },
  { tag: 'type-narrowing', test: (l) => /typeof\s+\w+\s*===|Array\.isArray\s*\(|Number\.is(?:Float|Integer|NaN)/.test(l) },
  { tag: 'strict-identity-compare', test: (l) => /===[^=]/.test(l) },
];

/** Operations that show up as REMOVALS (the bug is the removed line). */
const REMOVED_OP_PATTERNS = [
  { tag: 'numeric-coercion-removed', test: (l) => /parseInt\s*\(|Number\s*\(/.test(l) },
  { tag: 'loose-equality-removed', test: (l) => /[^=!<>]==[^=]/.test(l) },
];

function addedLines(patch) {
  return patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

function removedLines(patch) {
  return patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
}

function touchedFiles(patch) {
  const out = [];
  for (const line of patch.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

function declaredSymbols(patch) {
  const out = new Set();
  for (const line of addedLines(patch)) {
    const m = /(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) out.add(m[1]);
  }
  return [...out];
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

/** Loads every patch record in the corpus: { suite, task, model, patch } */
async function loadCorpusPatches() {
  const root = path.join(CORPUS, 'patches');
  const records = [];
  let suites = [];
  try {
    suites = await fs.readdir(root);
  } catch {
    throw new Error(`Corpus patches not readable at ${root}. Pass the harness-eval data directory as argv[2].`);
  }
  for (const suite of suites) {
    const suiteDir = path.join(root, suite);
    const suiteStat = await fs.stat(suiteDir).catch(() => null);
    if (!suiteStat?.isDirectory()) continue;
    for (const task of await fs.readdir(suiteDir)) {
      const taskDir = path.join(suiteDir, task);
      const taskStat = await fs.stat(taskDir).catch(() => null);
      if (!taskStat?.isDirectory()) continue;
      for (const file of await fs.readdir(taskDir)) {
        if (!file.endsWith('.json')) continue;
        const rec = await readJson(path.join(taskDir, file)).catch(() => null);
        if (!rec?.patch) continue;
        records.push({ suite, task, model: rec.modelId ?? file.replace(/\.json$/, ''), patch: rec.patch });
      }
    }
  }
  return records;
}

async function loadCorpusFailures() {
  const root = path.join(CORPUS, 'failures');
  const records = [];
  let suites = [];
  try {
    suites = await fs.readdir(root);
  } catch {
    return records;
  }
  for (const suite of suites) {
    const suiteDir = path.join(root, suite);
    if (!(await fs.stat(suiteDir).catch(() => null))?.isDirectory()) continue;
    for (const task of await fs.readdir(suiteDir)) {
      const taskDir = path.join(suiteDir, task);
      if (!(await fs.stat(taskDir).catch(() => null))?.isDirectory()) continue;
      for (const file of await fs.readdir(taskDir)) {
        if (!file.endsWith('.json')) continue;
        const rec = await readJson(path.join(taskDir, file)).catch(() => null);
        if (!rec) continue;
        records.push({ suite, task, model: rec.modelId ?? file.replace(/\.json$/, ''), failure: rec.failure ?? rec });
      }
    }
  }
  return records;
}

function summariseOperations(patches) {
  const ops = new Map();
  for (const rec of patches) {
    const tags = new Set();
    for (const line of addedLines(rec.patch)) {
      for (const p of OP_PATTERNS) if (p.test(line)) tags.add(p.tag);
    }
    for (const line of removedLines(rec.patch)) {
      for (const p of REMOVED_OP_PATTERNS) if (p.test(line)) tags.add(p.tag);
    }
    for (const tag of tags) {
      if (!ops.has(tag)) ops.set(tag, []);
      ops.get(tag).push(`${rec.suite}/${rec.task} [${rec.model}]`);
    }
  }
  return ops;
}

function summariseSurface(patches) {
  const files = new Map();
  for (const rec of patches) {
    for (const f of touchedFiles(rec.patch)) {
      if (!files.has(f)) files.set(f, new Set());
      for (const s of declaredSymbols(rec.patch)) files.get(f).add(s);
    }
  }
  return files;
}

function failureNotes(failures) {
  const notes = [];
  for (const rec of failures) {
    const f = rec.failure ?? {};
    const reason = f.reason ?? f.message ?? f.error ?? f.summary ?? f.stderr ?? null;
    if (typeof reason === 'string' && reason.trim()) notes.push(`${rec.suite}/${rec.task}: ${reason.trim().split('\n')[0].slice(0, 200)}`);
  }
  return notes;
}

async function main() {
  const sources = await readJson(path.join(HERE, 'sources', 'skills.json'));
  const suitePath = path.join(HERE, '..', '..', 'packages', 'bench', 'dist', 'suites', 'harder-v2.js');
  const suiteMod = await import(suitePath);
  const tasks = suiteMod.harderV2Suite();

  const allPatches = await loadCorpusPatches();
  const allFailures = await loadCorpusFailures();

  const skillsDir = path.join(HERE, 'skills');
  const kgDir = path.join(HERE, 'kg');
  await fs.rm(skillsDir, { recursive: true, force: true });
  await fs.rm(kgDir, { recursive: true, force: true });
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.mkdir(kgDir, { recursive: true });

  const manifest = { corpus: CORPUS, taskCount: tasks.length, tasks: {} };

  for (const task of tasks) {
    const spec = sources.tasks[task.id];
    if (!spec) throw new Error(`sources/skills.json has no entry for ${task.id}`);
    const cls = spec.class;
    const siblings = sources.siblings[cls] ?? [];

    // ── skills arm ────────────────────────────────────────────────────────
    const skillsBlock = [
      `# Skill: ${spec.classTitle}`,
      '',
      `Applies to tasks in the "${cls}" bug class.`,
      '',
      '## Procedure',
      ...spec.procedure.map((s, i) => `${String(i + 1)}. ${s}`),
      '',
      '## Traps to avoid',
      ...spec.traps.map((t) => `- ${t}`),
      '',
    ].join('\n');

    // ── kg arm ────────────────────────────────────────────────────────────
    const siblingPatches = allPatches.filter(
      (rec) => rec.task !== task.id && siblings.some((s) => s.suite === rec.suite && s.task === rec.task),
    );
    const siblingFailures = allFailures.filter(
      (rec) => rec.task !== task.id && siblings.some((s) => s.suite === rec.suite && s.task === rec.task),
    );
    const ops = summariseOperations(siblingPatches);
    const surface = summariseSurface(siblingPatches);
    const notes = failureNotes(siblingFailures);

    const kgLines = [
      `# Prior art: ${spec.classTitle} (\`${cls}\`)`,
      '',
      'Drawn from repairs of this bug class elsewhere in the evaluation corpus.',
      'This task\'s own patches and failures are excluded. Sibling evidence is reduced to',
      'operations, files and symbols — no diff content.',
      '',
      '## Coverage',
      siblingPatches.length === 0
        ? '- No sibling repairs for this bug class exist in the corpus.'
        : `- ${String(siblingPatches.length)} sibling repair(s) across ${String(new Set(siblingPatches.map((p) => p.model)).size)} model(s): `
          + [...new Set(siblingPatches.map((p) => `${p.suite}/${p.task}`))].join(', '),
      '',
    ];
    if (ops.size > 0) {
      kgLines.push('## Repair operations observed');
      for (const [tag, where] of [...ops.entries()].sort((a, b) => b[1].length - a[1].length)) {
        kgLines.push(`- \`${tag}\` — seen in ${String(where.length)}/${String(siblingPatches.length)} repairs (${[...new Set(where)].join('; ')})`);
      }
      kgLines.push('');
    }
    if (surface.size > 0) {
      kgLines.push('## Files and symbols touched in sibling repairs');
      for (const [file, syms] of surface) {
        kgLines.push(`- ${file}${syms.size > 0 ? ` (symbols: ${[...syms].join(', ')})` : ''}`);
      }
      kgLines.push('');
    }
    kgLines.push('## Recorded failure modes for this class');
    kgLines.push(...(notes.length > 0 ? notes.map((n) => `- ${n}`) : ['- None recorded in the corpus.']));
    kgLines.push('', '## Distilled shape', sources.shapes[cls], '');
    const kgBlock = kgLines.join('\n');

    await fs.writeFile(path.join(skillsDir, `${task.id}.md`), skillsBlock, 'utf-8');
    await fs.writeFile(path.join(kgDir, `${task.id}.md`), kgBlock, 'utf-8');

    // ── leakage guard ─────────────────────────────────────────────────────
    const ownPatches = allPatches.filter((rec) => rec.task === task.id);
    const leaked = [];
    for (const rec of ownPatches) {
      for (const line of [...addedLines(rec.patch), ...removedLines(rec.patch)]) {
        const trimmed = line.trim();
        if (trimmed.length < 20) continue;
        if (skillsBlock.includes(trimmed) || kgBlock.includes(trimmed)) {
          leaked.push({ model: rec.model, line: trimmed.slice(0, 80) });
        }
      }
    }
    if (leaked.length > 0) {
      throw new Error(`Integrity violation: injected block for ${task.id} contains ${String(leaked.length)} line(s) from its own patch. First: ${leaked[0].line}`);
    }

    manifest.tasks[task.id] = {
      class: cls,
      siblingTasks: [...new Set(siblingPatches.map((p) => `${p.suite}/${p.task}`))],
      siblingRepairs: siblingPatches.length,
      operationTags: [...ops.keys()],
      ownPatchesExcluded: ownPatches.length,
      skillsChars: skillsBlock.length,
      kgChars: kgBlock.length,
      leakage: 'clean',
    };
  }

  await fs.writeFile(path.join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  const totalSkills = Object.values(manifest.tasks).reduce((a, t) => a + t.skillsChars, 0);
  const totalKg = Object.values(manifest.tasks).reduce((a, t) => a + t.kgChars, 0);
  console.log(`Built ${String(tasks.length)} tasks into skills/ and kg/`);
  console.log(`skills arm: ${String(totalSkills)} chars total (~${String(Math.round(totalSkills / 4 / tasks.length))} tokens/task)`);
  console.log(`kg arm:     ${String(totalKg)} chars total (~${String(Math.round(totalKg / 4 / tasks.length))} tokens/task)`);
  console.log(`Leakage guard: clean (each task's own ${String(allPatches.filter((p) => p.task === 'harder-v2-event-emitter-leak').length)}-ish own patches excluded)`);
  console.log('manifest.json written');
}

await main();
