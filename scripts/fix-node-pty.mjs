#!/usr/bin/env node
/**
 * Restore the executable bit on node-pty's `spawn-helper`.
 *
 * node-pty ships prebuilt binaries, and on macOS the extracted `spawn-helper`
 * loses its executable bit. Every PTY spawn then fails with the unhelpful
 * `posix_spawnp failed`, which takes down every external agent CLI that needs a
 * TTY — agy, opencode, cursor-cli — while the binaries themselves are fine and
 * run correctly by hand.
 *
 * Runs on postinstall so a fresh `pnpm install` cannot silently reintroduce it.
 * Idempotent, and quiet unless it actually changes something.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmDir = path.join(root, 'node_modules', '.pnpm');

function findSpawnHelpers(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Only descend where node-pty could plausibly live.
      if (depth === 0 && !entry.name.startsWith('node-pty@')) continue;
      found.push(...findSpawnHelpers(full, depth + 1));
    } else if (entry.name === 'spawn-helper') {
      found.push(full);
    }
  }
  return found;
}

const helpers = existsSync(pnpmDir)
  ? findSpawnHelpers(pnpmDir)
  : findSpawnHelpers(path.join(root, 'node_modules', 'node-pty'), 1);

let fixed = 0;
for (const helper of helpers) {
  try {
    const mode = statSync(helper).mode;
    if ((mode & 0o111) === 0) {
      chmodSync(helper, mode | 0o755);
      fixed++;
    }
  } catch {
    /* best effort — a missing helper is not fatal on platforms that don't use it */
  }
}

if (fixed > 0) {
  console.log(`fix-node-pty: restored the executable bit on ${String(fixed)} spawn-helper binary(ies)`);
}
