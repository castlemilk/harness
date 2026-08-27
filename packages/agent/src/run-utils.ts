import path from 'node:path';
import { execFileAsync } from './project-utils.js';
import type { ToolResult } from './tool-types.js';

const COREPACK_ENV: NodeJS.ProcessEnv = {
  COREPACK_INTEGRITY_KEYS: '0',
  COREPACK_ENABLE_AUTO_PIN: '0',
};

export function pnpmArgs(args: string[]): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  return { cmd: 'corepack', args: ['pnpm@10.18.0', ...args], env: { ...process.env, ...COREPACK_ENV } };
}

const FORBIDDEN_PATTERNS = [
  'rm -rf',
  'rm -fr',
  'rm -r -f',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git push -f',
  '> /',
];

const FORBIDDEN_COMMANDS = new Set(['sh', 'bash', 'zsh', 'fish', 'env', 'xargs', 'find']);

const SHELL_METACHARACTERS = /[|&;<>$`*?]/;

function hasUnquotedShellMetacharacter(command: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote === null) {
      i++;
      continue;
    }
    if (quote === null && (char === "'" || char === '"')) {
      quote = char;
      continue;
    }
    if (quote !== null && char === quote) {
      quote = null;
      continue;
    }
    if (quote === null && SHELL_METACHARACTERS.test(char)) {
      return true;
    }
  }
  return false;
}

function sanitizeCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Empty command' };
  }
  const normalized = trimmed.replace(/\s+/g, ' ');
  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (normalized.toLowerCase().includes(forbidden.toLowerCase())) {
      return { ok: false, reason: `Forbidden command pattern detected: ${forbidden}` };
    }
  }
  const firstToken = normalized.split(' ')[0]?.toLowerCase() ?? '';
  if (FORBIDDEN_COMMANDS.has(firstToken)) {
    return { ok: false, reason: `Forbidden command: ${firstToken}` };
  }
  if (/(^|&&|\|\||[;|])\s*sleep\s/.test(normalized)) {
    return {
      ok: false,
      reason:
        'Rejected: `sleep` wastes a step. Commands run in the foreground and return their output directly.',
    };
  }
  return { ok: true };
}

function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function isFullSuiteTestCommand(cmd: string, args: string[]): boolean {
  const joined = [cmd, ...args].join(' ');
  if (/^(npm|pnpm|yarn) test$/.test(joined)) return true;
  if (cmd === 'npx' && (args[0] === 'vitest' || args[0] === 'jest')) {
    const hasPathArg = args.some((a) => !a.startsWith('-') && /\.[cm]?[jt]sx?$/.test(a));
    return !hasPathArg;
  }
  return (
    /^(python3? -m )?pytest( -q)?$/.test(joined) ||
    joined === 'go test ./...' ||
    joined === 'cargo test'
  );
}

const FULL_SUITE_HINT =
  '\n[hint] Full-suite test run detected. During iteration, run only the test files affected by your change (e.g. `npx vitest run <file>`, `python3 -m pytest <file> -q`) to save steps; the full suite is required once as final verification before finish.';

async function exists(filePath: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((fs) => fs.access(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(
  projectPath: string,
  command: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ToolResult> {
  const check = sanitizeCommand(command);
  if (!check.ok) {
    return { success: false, output: check.reason };
  }

  const useShell = hasUnquotedShellMetacharacter(command);
  const args = useShell ? ['-c', command] : splitCommand(command.trim());
  if (args.length === 0) {
    return { success: false, output: 'Empty command' };
  }
  const cmd = useShell ? 'sh' : args[0];
  const cmdArgs = useShell ? args : args.slice(1);

  const advisory = !useShell && isFullSuiteTestCommand(cmd, cmdArgs) ? FULL_SUITE_HINT : '';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COREPACK_INTEGRITY_KEYS: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
  };
  const venvBin = path.join(projectPath, '.venv', 'bin');
  if (await exists(venvBin)) {
    env.PATH = `${venvBin}${path.delimiter}${env.PATH ?? ''}`;
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      cwd: projectPath,
      timeout: Math.max(1, Math.min(300_000, options.timeoutMs ?? 300_000)),
      signal: options.signal,
      shell: false,
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { success: true, output: stdout + stderr + advisory };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    if (!useShell && (cmd === 'grep' || cmd === 'rg') && execErr.code === 1 && !execErr.stderr) {
      return { success: true, output: (execErr.stdout ?? '') || 'No matches.' };
    }
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    const exitCode = execErr.code !== undefined ? ` (exit code ${String(execErr.code)})` : '';
    return { success: false, output: `Command failed${exitCode}: ${cmd} ${cmdArgs.join(' ')}\n${output}${advisory}` };
  }
}
