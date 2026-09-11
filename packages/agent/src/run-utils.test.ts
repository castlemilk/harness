import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from './run-utils.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('runCommand deadline cancellation', () => {
  it('terminates an in-flight child process when the agent deadline aborts', async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runCommand(
      process.cwd(),
      "node -e 'setInterval(function(){},1000)'",
      { timeoutMs: 5_000, signal: controller.signal },
    );

    setTimeout(() => {
      controller.abort(new DOMException('deadline reached', 'TimeoutError'));
    }, 20);

    const result = await running;

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/abort|deadline/i);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('resolves a bare nested Go filename before running go fmt', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-run-utils-'));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, 'go.mod'), 'module example.com/project\n', 'utf-8');
    await fs.mkdir(path.join(directory, 'parser'), { recursive: true });
    await fs.writeFile(path.join(directory, 'parser', 'parser.go'), 'package parser\n\nfunc New( ) {}\n', 'utf-8');

    const result = await runCommand(directory, 'go fmt parser.go');

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(directory, 'parser', 'parser.go'), 'utf-8')).resolves.toContain('func New() {}');
  });
});
