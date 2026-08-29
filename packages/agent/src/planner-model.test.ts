import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '@omega/core';
import { createPlan } from './planner.js';

describe('planner model selection', () => {
  it('passes the selected model to plain JSON planning calls', async () => {
    const send = vi.fn().mockResolvedValue(JSON.stringify({ reasoning: 'plan', plan: [] }));
    const sendWithTools = vi.fn().mockResolvedValue(JSON.stringify({ reasoning: 'plan', plan: [] }));
    const provider = { send, sendWithTools } as unknown as Provider;

    await createPlan(
      provider,
      'Plan the task',
      'Implement the change',
      undefined,
      undefined,
      undefined,
      { model: 'qwen3:8b' },
    );

    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: 'qwen3:8b' }),
    );
    expect(sendWithTools).not.toHaveBeenCalled();
  });
});
