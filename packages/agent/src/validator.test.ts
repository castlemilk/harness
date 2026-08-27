import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeadlineGuard } from './project-utils.js';
import { validateProject } from './validator.js';

const roots: string[] = [];

async function makeNodeProject(testScript: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-validator-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    private: true,
    scripts: { test: testScript },
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('validateProject deadline handling', () => {
  it('lets an in-flight validation use its minimum budget after the agent deadline', async () => {
    const root = await makeNodeProject(
      `${JSON.stringify(process.execPath)} -e "setTimeout(() => process.stdout.write('validated'), 100)"`,
    );
    const deadlineMs = Date.now() + 25;
    const guard = createDeadlineGuard(deadlineMs);

    try {
      const summary = await validateProject(root, { deadlineMs, signal: guard.signal });

      expect(guard.signal.aborted).toBe(true);
      expect(summary.test).toEqual({ passed: true, output: expect.stringContaining('validated') });
      expect(summary.allPassed).toBe(true);
    } finally {
      guard.dispose();
    }
  });

  it('still rejects explicit caller cancellation', async () => {
    const root = await makeNodeProject(
      `${JSON.stringify(process.execPath)} -e "setTimeout(() => undefined, 100)"`,
    );
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled by caller', 'AbortError'));

    await expect(validateProject(root, {
      deadlineMs: Date.now() + 60_000,
      signal: controller.signal,
    })).rejects.toThrow('cancelled by caller');
  });
});
