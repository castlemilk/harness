import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

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

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const data = await api.getTasks(projectId);
    setTasks(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
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

  function tagsList(t: Task): string[] {
    if (!t.tags) return [];
    try {
      return JSON.parse(t.tags);
    } catch {
      return [];
    }
  }

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
        <form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-end">
          <input
            className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Task title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <input
            className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <select
            className="border rounded px-3 py-1.5 text-sm"
            value={form.complexity}
            onChange={(e) => setForm({ ...form, complexity: e.target.value })}
          >
            <option value="simple">Simple</option>
            <option value="medium">Medium</option>
            <option value="complex">Complex</option>
          </select>
          <input
            className="border rounded px-3 py-1.5 text-sm w-32"
            placeholder="Tags"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
            Add task
          </button>
        </form>
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
                  {tasks
                    .filter((t) => t.status === status)
                    .map((t) => (
                      <div key={t.id} className="bg-white rounded-md p-3 shadow-sm text-sm">
                        <div className="font-medium mb-1">{t.title}</div>
                        {t.description && (
                          <div className="text-gray-500 text-xs mb-2 line-clamp-2">{t.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1 mb-2">
                          <span className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">{t.complexity}</span>
                          {tagsList(t).map((tag) => (
                            <span key={tag} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                              {tag}
                            </span>
                          ))}
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
                        {status !== 'in_progress' && (
                          <button
                            onClick={() => handleRun(t.id)}
                            className="w-full px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                          >
                            Run
                          </button>
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
