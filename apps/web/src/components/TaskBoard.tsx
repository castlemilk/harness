import { useEffect, useState } from 'react';
import { api, streamUrls } from '../lib/api.js';
import { TaskDetail } from './TaskDetail.js';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  complexity: string;
  tags?: string;
  provider?: string | null;
  model?: string | null;
  result?: string | null;
  error?: string | null;
  retryCount: number;
  retryHistory: string | null;
  lastRetryAt: string | null;
  createdAt: string;
}

interface Props {
  projectId?: string;
}

const statuses = ['todo', 'in_progress', 'done', 'failed'];

export function TaskBoard({ projectId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    complexity: 'simple',
    tags: '',
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<'all' | 'agent' | 'orchestrate' | 'external'>('all');

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { tasks } = await api.getTasks(projectId);
    setTasks(tasks);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  // Live updates: patch task status/result/error in place from the SSE stream.
  useEffect(() => {
    if (!projectId) return;
    let es: EventSource | null = null;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function connect() {
      if (stopped) return;
      es = new EventSource(streamUrls.tasks());
      es.addEventListener('task', (ev) => {
        retryMs = 1000;
        const data = JSON.parse((ev).data as string) as {
          id: string;
          status: string;
          result?: string | null;
          error?: string | null;
          provider?: string | null;
          model?: string | null;
        };
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === data.id);
          if (idx === -1) return prev;
          const next = [...prev];
          const existing = next[idx];
          next[idx] = {
            ...existing,
            status: data.status,
            result: data.result !== undefined ? data.result : existing.result,
            error: data.error !== undefined ? data.error : existing.error,
            provider: data.provider !== undefined ? data.provider : existing.provider,
            model: data.model !== undefined ? data.model : existing.model,
          };
          return next;
        });
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (stopped) return;
        retryTimer = setTimeout(() => {
          retryMs = Math.min(retryMs * 2, 30000);
          connect();
        }, retryMs);
      };
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [projectId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    await api.createTask({
      projectId,
      title: form.title,
      description: form.description,
      complexity: form.complexity,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setForm({ title: '', description: '', complexity: 'simple', tags: '' });
    await load();
  }

  async function handleRun(id: string) {
    await api.runTask(id);
    await load();
  }

  async function handleRetry(taskId: string, strategy?: string) {
    setRetryingIds((s) => {
      const n = new Set(s);
      n.add(taskId);
      return n;
    });
    try {
      await api.retryTask(taskId, strategy);
      await load();
    } catch (err) {
      console.error('retry failed', taskId, err);
    } finally {
      setRetryingIds((s) => {
        const n = new Set(s);
        n.delete(taskId);
        return n;
      });
    }
  }

  function tagsList(t: Task): string[] {
    if (!t.tags) return [];
    try {
      return JSON.parse(t.tags) as string[];
    } catch {
      return [];
    }
  }

  function externalCli(t: Task): string | null {
    const tag = tagsList(t).find((tag) => tag.startsWith('external:'));
    return tag ? tag.split(':')[1] : null;
  }

  function taskKind(t: Task): 'orchestrate' | 'external' | 'agent' | 'other' {
    const tags = tagsList(t);
    if (tags.includes('orchestrate')) return 'orchestrate';
    if (tags.some((tag) => tag.startsWith('external:'))) return 'external';
    if (tags.includes('agent')) return 'agent';
    return 'other';
  }

  const filteredTasks = tasks.filter((t) => {
    if (kindFilter === 'all') return true;
    return taskKind(t) === kindFilter;
  });

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Select a project to view tasks
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-screen overflow-hidden">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-xl font-semibold">Tasks</h2>
      </header>

      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <form onSubmit={(e) => { void handleCreate(e); }} className="flex flex-wrap gap-2 items-end">
          <input
            className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Task title"
            value={form.title}
            onChange={(e) => { setForm({ ...form, title: e.target.value }); }}
            required
          />
          <input
            className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Description"
            value={form.description}
            onChange={(e) => { setForm({ ...form, description: e.target.value }); }}
          />
          <select
            className="border rounded px-3 py-1.5 text-sm"
            value={form.complexity}
            onChange={(e) => { setForm({ ...form, complexity: e.target.value }); }}
          >
            <option value="simple">Simple</option>
            <option value="medium">Medium</option>
            <option value="complex">Complex</option>
          </select>
          <input
            className="border rounded px-3 py-1.5 text-sm w-32"
            placeholder="Tags"
            value={form.tags}
            onChange={(e) => { setForm({ ...form, tags: e.target.value }); }}
          />
          <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
            Add task
          </button>
        </form>
        <div className="mt-2 flex gap-1 text-xs">
          {(['all', 'agent', 'orchestrate', 'external'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => { setKindFilter(kind); }}
              className={`px-2 py-1 rounded ${kindFilter === kind ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        {loading ? (
          <div className="text-sm text-gray-500">Loading tasks…</div>
        ) : (
          <div className="grid grid-cols-4 gap-4 min-w-[800px]">
            {statuses.map((status) => (
              <div key={status} className="bg-gray-100 rounded-lg p-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
                  {status.replace('_', ' ')}
                </h3>
                <div className="space-y-2">
                  {filteredTasks
                    .filter((t) => t.status === status)
                    .map((t) => (
                      <div key={t.id} className="bg-white rounded-md p-3 shadow-sm text-sm">
                        <div className="font-medium mb-1">{t.title}</div>
                        {t.description && (
                          <div className="text-gray-500 text-xs mb-2 line-clamp-2">{t.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1 mb-2">
                          <span className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">{t.complexity}</span>
                          {externalCli(t) && (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                              external:{externalCli(t)}
                            </span>
                          )}
                          {tagsList(t)
                            .filter((tag) => !tag.startsWith('external:'))
                            .map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                                {tag}
                              </span>
                            ))}
                          {t.retryCount > 0 && (
                            <RetryBadge task={t} />
                          )}
                        </div>
                        {t.provider && (
                          <div className="text-xs text-gray-400 mb-2">
                            {t.provider}/{t.model}
                          </div>
                        )}
                        {t.error && <div className="text-xs text-red-600 mb-2">{t.error}</div>}
                        {t.result && (
                          <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded mb-2 max-h-32 overflow-auto">
                            {t.result}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setExpandedTaskId(expandedTaskId === t.id ? null : t.id); }}
                            className="flex-1 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
                          >
                            {expandedTaskId === t.id ? 'Hide details' : 'Details'}
                          </button>
                          {status !== 'in_progress' && (
                            <button
                              onClick={() => { void handleRun(t.id); }}
                              className="flex-1 px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                            >
                              Run
                            </button>
                          )}
                          {status === 'failed' && (
                            <div className="flex gap-1">
                              <select
                                value=""
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v) void handleRetry(t.id, v);
                                  e.currentTarget.value = '';
                                }}
                                className="text-[10px] border rounded px-1"
                                disabled={retryingIds.has(t.id)}
                              >
                                <option value="" disabled>↻ strategy…</option>
                                <option value="clean-retry">clean-retry</option>
                                <option value="tier-escalation">tier-escalation</option>
                                <option value="different-provider">different-provider</option>
                                <option value="orchestrated-fallback">orchestrated-fallback</option>
                                <option value="different-cli">different-cli</option>
                              </select>
                              <button
                                onClick={() => { void handleRetry(t.id); }}
                                disabled={retryingIds.has(t.id)}
                                className="px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700 disabled:opacity-50"
                              >
                                {retryingIds.has(t.id) ? '↻…' : '↻ Retry'}
                              </button>
                            </div>
                          )}
                        </div>
                        {expandedTaskId === t.id && (
                          <TaskDetail taskId={t.id} taskStatus={t.status} taskError={t.error} projectId={t.projectId} tags={tagsList(t)} />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function RetryBadge({ task }: { task: Task }) {
  let lastStrategy = '';
  let lastModel = '';
  if (task.retryHistory) {
    try {
      const arr = JSON.parse(task.retryHistory) as { strategy: string; model?: string | null }[];
      const last = arr.at(-1);
      if (last) {
        lastStrategy = last.strategy;
        lastModel = typeof last.model === 'string' ? last.model : '';
      }
    } catch { /* ignore malformed history */ }
  }
  const modelPart = lastModel ? ` (${lastModel})` : '';
  return (
    <span
      className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs"
      title={`Retried ${String(task.retryCount)}× — last: ${lastStrategy}${modelPart}`}
    >
      ↻ {task.retryCount}×
    </span>
  );
}
