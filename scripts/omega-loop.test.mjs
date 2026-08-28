import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoopConfig, runTask, submitSelfImproveTask } from './omega-loop.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('omega self-improve loop configuration', () => {
  it('maps provider, model, budget, and orchestration controls from the environment', () => {
    const config = createLoopConfig({
      OMEGA_STORAGE_ROOT: '/tmp/omega-test',
      OMEGA_LOOP_API_URL: 'http://localhost:4400',
      OMEGA_LOOP_PROVIDER: 'ollama-local',
      OMEGA_LOOP_MODEL: 'qwen3:8b',
      OMEGA_LOOP_TOKEN_BUDGET: '30000',
    }, '/home/test', '/repo');

    expect(config).toEqual(expect.objectContaining({
      apiUrl: 'http://localhost:4400',
      projectPath: '/repo',
      storageRoot: '/tmp/omega-test',
      provider: 'ollama-local',
      model: 'qwen3:8b',
      tokenBudget: 30000,
    }));
    expect(config.iterationsDir).toBe('/tmp/omega-test/iterations');
  });

  it('pins configured tasks and forwards bounded run options', async () => {
    const config = createLoopConfig({
      OMEGA_LOOP_API_URL: 'http://localhost:4400',
      OMEGA_LOOP_PROVIDER: 'ollama-local',
      OMEGA_LOOP_MODEL: 'qwen3:8b',
      OMEGA_LOOP_TOKEN_BUDGET: '30000',
      OMEGA_LOOP_PROMPT: 'Improve one thing.',
    }, '/home/test', '/repo');
    const task = { id: 'task-1', status: 'todo' };
    const pinnedTask = { ...task, provider: 'ollama-local', model: 'qwen3:8b' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(task), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pinnedTask), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'in_progress' }), { status: 202 }));

    await expect(submitSelfImproveTask('project-1', config)).resolves.toEqual(pinnedTask);
    await expect(runTask(task.id, config)).resolves.toEqual({ status: 'in_progress' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:4400/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          title: 'Improve one thing.',
          description: 'Improve one thing.',
          complexity: 'complex',
          tags: ['self-improve'],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4400/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ provider: 'ollama-local', model: 'qwen3:8b' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4400/tasks/task-1/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tokenBudget: 30000 }),
      }),
    );
  });

  it('preserves unconfigured loop behavior', async () => {
    const config = createLoopConfig({}, '/home/test', '/repo');
    const task = { id: 'task-1', status: 'todo' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(task), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'in_progress' }), { status: 202 }));

    await submitSelfImproveTask('project-1', config);
    await runTask(task.id, config);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4000/tasks/task-1/run',
      expect.objectContaining({ body: '{}' }),
    );
  });
});
