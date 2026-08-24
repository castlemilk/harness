import { describe, expect, it } from 'vitest';
import { runCommand } from './run-utils.js';

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
});
