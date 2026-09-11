import { describe, expect, it, vi } from 'vitest';
import { abortableOperation, withProviderRetry } from './retry.js';

describe('abortableOperation', () => {
  it('rejects an in-flight operation as soon as its signal aborts', async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    const result = abortableOperation(never, controller.signal);

    controller.abort(new DOMException('deadline reached', 'TimeoutError'));

    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('withProviderRetry', () => {
  it('does not retry a request that already exhausted its transport timeout', async () => {
    const operation = vi.fn().mockRejectedValue(new DOMException('request timed out', 'TimeoutError'));

    await expect(withProviderRetry('provider', operation)).rejects.toThrow(/timed out/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
