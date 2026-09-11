import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDeadlineGuard,
  deadlineAtForTask,
  isReliableTestCommand,
  looksLikeTestCommand,
  boundedProviderRequestTimeoutMs,
  resolveExistingProjectPath,
  taskLikelyRequiresChanges,
  verificationCommandFromDescription,
} from './project-utils.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('deadlineAtForTask', () => {
  it('uses the run timeout when supplied', () => {
    expect(deadlineAtForTask('medium', 1_200_000, 100)).toBe(1_200_100);
  });

  it('falls back to the complexity deadline when no valid run timeout exists', () => {
    expect(deadlineAtForTask('medium', undefined, 100)).toBe(15 * 60_000 + 100);
    expect(deadlineAtForTask('simple', Number.NaN, 100)).toBe(5 * 60_000 + 100);
  });
});

describe('boundedProviderRequestTimeoutMs', () => {
  it('allows slow local-model requests up to three minutes without exceeding the deadline', () => {
    expect(boundedProviderRequestTimeoutMs(1_000_000, 0)).toBe(180_000);
    expect(boundedProviderRequestTimeoutMs(100_000, 0)).toBe(100_000);
    expect(boundedProviderRequestTimeoutMs(2_000, 0)).toBe(5_000);
  });

  it('honors a configured provider request ceiling', () => {
    const environment = { OMEGA_PROVIDER_REQUEST_TIMEOUT_MS: '600000' };
    expect(boundedProviderRequestTimeoutMs(1_000_000, 0, environment)).toBe(600_000);
    expect(boundedProviderRequestTimeoutMs(100_000, 0, environment)).toBe(100_000);
  });
});

describe('createDeadlineGuard', () => {
  it('aborts in-flight work when the absolute deadline arrives', async () => {
    vi.useFakeTimers();
    try {
      const guard = createDeadlineGuard(Date.now() + 1_000);
      expect(guard.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(guard.signal.aborted).toBe(true);
      expect(guard.signal.reason).toBeInstanceOf(DOMException);
      guard.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards an external cancellation and removes its listener on dispose', () => {
    const external = new AbortController();
    const guard = createDeadlineGuard(Date.now() + 60_000, external.signal);

    external.abort(new DOMException('cancelled', 'AbortError'));

    expect(guard.signal.aborted).toBe(true);
    expect((guard.signal.reason as DOMException).name).toBe('AbortError');
    guard.dispose();
  });
});

describe('test command classification', () => {
  it('does not treat output pipelines or masked failures as reliable verification', () => {
    expect(looksLikeTestCommand('go test ./... 2>&1 | head -40')).toBe(true);
    expect(isReliableTestCommand('go test ./... 2>&1 | head -40')).toBe(false);
    expect(isReliableTestCommand('go test ./... || true')).toBe(false);
    expect(isReliableTestCommand('go test ./...; echo complete')).toBe(false);
  });

  it('keeps command substitutions and successful command chaining reliable', () => {
    expect(isReliableTestCommand("cd repo && go test $(go list -e -f '{{.ImportPath}}' ./... | grep -v '/js$')")).toBe(true);
    expect(isReliableTestCommand('go test ./... 2>&1')).toBe(true);
  });
});

describe('verification command guidance', () => {
  it('prefers explicit task build and test commands over a generic Go suite', () => {
    expect(verificationCommandFromDescription(`Language: Go.
 - Build/compile check (run first, must exit 0): go build $(go list -e -f '{{.ImportPath}}' ./... | grep -v '/js$')
 - Run existing tests: go test $(go list -e -f '{{.ImportPath}}' ./... | grep -v '/js$')`)).toBe(
      "go build $(go list -e -f '{{.ImportPath}}' ./... | grep -v '/js$') && go test $(go list -e -f '{{.ImportPath}}' ./... | grep -v '/js$')",
    );
  });

  it('returns no guidance when the description has no executable verification lines', () => {
    expect(verificationCommandFromDescription('Implement the requested change.')).toBeUndefined();
  });
});

describe('task change classification', () => {
  const baseTask = {
    id: 'task-1',
    projectId: 'project-1',
    status: 'todo' as const,
    complexity: 'simple' as const,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('requires a patch for implementation and benchmark tasks', () => {
    expect(taskLikelyRequiresChanges({ ...baseTask, title: 'Add stepped slices' })).toBe(true);
    expect(taskLikelyRequiresChanges({ ...baseTask, title: 'Run benchmark', tags: ['benchmark'] })).toBe(true);
  });

  it('allows read-only diagnostic tasks to finish without a patch', () => {
    expect(taskLikelyRequiresChanges({ ...baseTask, title: 'Smoke-test command dispatch' })).toBe(false);
    expect(taskLikelyRequiresChanges({ ...baseTask, title: 'Explain the failing test' })).toBe(false);
  });
});

describe('project path resolution', () => {
  it('resolves Go module import paths and unique bare filenames', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-project-utils-'));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, 'go.mod'), 'module github.com/example/abs\n', 'utf-8');
    await fs.mkdir(path.join(directory, 'parser'), { recursive: true });
    await fs.mkdir(path.join(directory, 'evaluator'), { recursive: true });
    await fs.writeFile(path.join(directory, 'parser', 'parser.go'), 'package parser\n', 'utf-8');
    await fs.writeFile(path.join(directory, 'evaluator', 'evaluator_test.go'), 'package evaluator\n', 'utf-8');

    await expect(
      resolveExistingProjectPath(directory, 'github.com/example/abs/parser', 'directory'),
    ).resolves.toMatchObject({ relativePath: 'parser' });
    await expect(
      resolveExistingProjectPath(directory, 'github.com/example/abs/parser/parser.go', 'file'),
    ).resolves.toMatchObject({ relativePath: path.join('parser', 'parser.go') });
    await expect(
      resolveExistingProjectPath(directory, 'evaluator_test.go', 'file'),
    ).resolves.toMatchObject({ relativePath: path.join('evaluator', 'evaluator_test.go') });
  });

  it('does not guess when a bare filename is ambiguous', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-project-utils-'));
    temporaryDirectories.push(directory);
    await fs.mkdir(path.join(directory, 'one'), { recursive: true });
    await fs.mkdir(path.join(directory, 'two'), { recursive: true });
    await fs.writeFile(path.join(directory, 'one', 'shared.go'), 'package one\n', 'utf-8');
    await fs.writeFile(path.join(directory, 'two', 'shared.go'), 'package two\n', 'utf-8');

    await expect(resolveExistingProjectPath(directory, 'shared.go', 'file')).resolves.toBeUndefined();
  });
});
