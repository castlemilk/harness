# Expand Eval Framework: agy + opencode Agents

**Date:** 2026-07-21
**Status:** Approved
**Scope:** Harness external CLI agent system + eval framework

## Goal

Expand the Omega harness eval framework to support **agy** (Google's Antigravity CLI, successor to gemini-cli) and **opencode** (with Big Pickle model) as first-class eval agents, alongside the existing codex, claude-code, cursor-cli, and aider entries.

## Problem

1. `gemini-cli` entry in `ExternalCli` points to a retired binary (`gemini`) — dead code
2. agy (the successor) has a critical `isatty()` bug — produces no stdout from subprocesses, so the current `execFile` approach returns empty output
3. opencode exists in the CLI list but doesn't use structured output (`--format json`), making results hard to parse
4. No model configuration for opencode — defaults vary per invocation

## Approach: Config-driven CliSpec + PTY helper

Extend the existing `CliSpec` interface with optional PTY and output-transform fields. Extract PTY spawning into a shared helper. Minimal structural change to `runExternalAgentTask`.

## Changes

### 1. `packages/agent/src/external.ts` — CliSpec expansion

```typescript
interface CliSpec {
  command: string;
  args: (prompt: string) => string[];
  env?: NodeJS.ProcessEnv;
  /** Spawn via PTY instead of execFile. Required for CLIs that gate stdout on isatty(). */
  pty?: boolean;
  /** Post-process captured stdout before storing. */
  outputTransform?: (raw: string) => string;
}
```

Update `ExternalCli` union:
```typescript
// Before:
'codex' | 'claude-code' | 'gemini-cli' | 'opencode' | 'cursor-cli' | 'aider'
// After (gemini-cli kept as deprecated for backward compat):
'codex' | 'claude-code' | 'agy' | 'opencode' | 'cursor-cli' | 'aider' | 'gemini-cli'
```

Backward compatibility: `gemini-cli` remains in the `ExternalCli` union type (deprecated). In `cliSpec()`, the `gemini-cli` case logs a deprecation warning (`logger.warn('gemini-cli is deprecated, use agy instead')`) and returns the agy spec. This keeps the type system happy while allowing existing `--harnesses gemini-cli` invocations to work.

Update dispatch in `runExternalAgentTask`:
- If `spec.pty` → call `spawnWithPty()`
- Else → existing `execFileAsync()`
- Then apply `spec.outputTransform()` if present

### 2. `packages/agent/src/pty-spawn.ts` — new file

PTY helper using `node-pty`:

```typescript
import stripAnsi from 'strip-ansi';

export interface PtyResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function spawnWithPty(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<PtyResult>
```

**Implementation details:**
- Allocates a PTY via `node-pty.spawn()`
- Spawns the command in the PTY with the given args and env
- Captures all output into a buffer
- **Timeout:** After `timeoutMs`, sends `SIGTERM` to the process group (`process.kill(-pid, 'SIGTERM')`). If the process doesn't exit within 5s after SIGTERM, sends `SIGKILL` (`process.kill(-pid, 'SIGKILL')`).
- **Cleanup:** PTY fd is always closed in a `finally` block, regardless of timeout or error. If `spawnWithPty` throws (e.g. binary not found), the PTY is still cleaned up.
- **ANSI stripping:** All PTY output is passed through `strip-ansi` before returning, removing terminal control sequences (cursor movement, colors, clear-screen).
- **stderr semantics:** PTY merges stderr into stdout — this is acceptable because the existing `runExternalAgentTask` already concatenates stdout and stderr into a single `output` string (external.ts:148). The returned `stderr` field is always empty.
- Returns `{ stdout: <stripped>, stderr: '', exitCode }`

**Dependencies:** `strip-ansi` (must be added as a direct dependency — it exists only as a transitive dep, which pnpm's strict isolation blocks from direct import).

### 3. agy CLI spec (replaces gemini-cli)

```typescript
case 'agy':
  return {
    command: 'agy',
    args: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
    pty: true,
  };
```

- Binary: `agy` (installed to `~/.local/bin/agy`)
- Flags: `-p` (non-interactive print), `--dangerously-skip-permissions` (auto-approve)
- PTY: required — agy prints nothing from non-TTY subprocesses
- Auth: OS keyring / Google Sign-In (no env var)
- Model: uses agy's default (configurable later via `--model` flag)
- **Security:** `--dangerously-skip-permissions` disables all permission prompts, allowing arbitrary filesystem and command execution. This is safe for eval because benchmark tasks run in disposable git worktrees under `~/.omega/work/worktrees/` — no real project files are at risk.

### 4. opencode CLI spec (updated)

```typescript
case 'opencode':
  return {
    command: 'opencode',
    args: (prompt) => ['run', prompt, '--format', 'json', '--model', 'opencode/big-pickle'],
    outputTransform: extractOpencodeResult,
  };
```

- Flags: `run` (non-interactive), `--format json` (JSONL output), `--model opencode/big-pickle`
- `extractOpencodeResult`: parses JSONL events, extracts text, discards tool_use/step_start noise
- Auth: opencode's own provider config

### 5. `packages/agent/src/opencode-output.ts` — new file

JSONL parser for opencode output:

```typescript
import { logger } from './logger.js';

interface OpencodeEvent {
  type: string;
  part?: { text?: string };
  input?: number;
  output?: number;
  error?: string;
}

export function extractOpencodeResult(raw: string): string
```

**Event shape** (from opencode source / verified output):
```json
{"type":"text","part":{"text":"Here is the implementation..."}}
{"type":"step_finish","input":1234,"output":567}
{"type":"tool_use","tool":"edit_file","status":"success"}
{"type":"error","error":"something went wrong"}
```

- `text` events → `part.text` concatenated into result
- `step_finish` events → token usage logged via `logger.info`
- `error` events → `error` field logged as warning
- **Error handling:** Malformed JSONL lines are skipped with a `logger.warn('opencode: skipping malformed JSONL line', ...)`. If no `text` events are found, return the raw output as a fallback.
- `tool_use` and other events → discarded (noise)

### 6. CLI (`apps/cli/src/commands/bench.ts`)

Update `--harnesses` flag description to list `agy` instead of `gemini-cli`. No structural changes — `runHarnessEval` already iterates over arbitrary CLI names.

### 7. Dependencies

Add `node-pty` and `strip-ansi` to `packages/agent/package.json`:
```json
"node-pty": "^1.0.0",
"strip-ansi": "^7.0.0"
```

**Build requirements:** `node-pty` requires C++ build tools (`xcode-select --install` on macOS, `build-essential` on Linux). CI images must include these.

### 8. No website changes needed

The `gen-harness-eval.mjs` script reads agent names from benchmark reports dynamically. Once eval reports exist for `agy` and `opencode`, the website will automatically show them in model rankings.

## Files to modify

| File | Change |
|------|--------|
| `packages/agent/src/external.ts` | CliSpec expansion, ExternalCli union update, PTY dispatch, gemini-cli alias |
| `packages/agent/src/pty-spawn.ts` | **New** — PTY helper with ANSI strip, timeout, cleanup |
| `packages/agent/src/opencode-output.ts` | **New** — JSONL parser with error handling |
| `packages/agent/package.json` | Add `node-pty` and `strip-ansi` dependencies |
| `apps/cli/src/commands/bench.ts` | Update --harnesses flag description |

Internal-only modules: `pty-spawn.ts` and `opencode-output.ts` are only imported by `external.ts` and not exported from `packages/agent/src/index.ts`.

## Verification

1. `pnpm -r build` — all packages compile
2. `pnpm lint` — no lint errors
3. `omega bench eval --suite fast --harnesses agy` — single agent eval
4. `omega bench eval --suite fast --harnesses opencode` — single agent eval
5. `omega bench eval --suite deep --harnesses agy,opencode,codex` — multi-agent eval
6. `omega bench eval --suite fast --harnesses gemini-cli` — verify backward compat alias works (deprecation warning)
7. Verify reports in `~/.omega/reports/` contain correct agent names and diffs
