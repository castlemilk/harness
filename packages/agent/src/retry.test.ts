import { describe, expect, it } from 'vitest';
import { abortableOperation } from './retry.js';

describe('abortableOperation', () => {
  it('rejects an in-flight operation as soon as its signal aborts', async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    const result = abortableOperation(never, controller.signal);

    controller.abort(new DOMException('deadline reached', 'TimeoutError'));

    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
