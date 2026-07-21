import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { TraceFlow } from './TraceFlow.js';

interface Subtask {
  id: string;
  title: string;
  status: string;
  model?: string | null;
  provider?: string | null;
  error?: string | null;
  result?: string | null;
  tags?: string | null;
}

interface Props {
  taskId: string;
  projectId: string;
}

function statusColor(status: string) {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'in_progress') return 'text-yellow-600';
  return 'text-gray-500';
}

function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function OrchestrationView({ taskId, projectId }: Props) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  async function load() {
    setLoading(true);
    const tasks = await api.getTasks(projectId).catch(() => [] as Subtask[]);
    const parentTag = `parent:${taskId}`;
    const children = (tasks as Subtask[]).filter((t) => parseTags(t.tags).includes(parentTag));
    children.sort((a, b) => a.title.localeCompare(b.title));
    setSubtasks(children);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId, projectId]);

  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-gray-600">
          Sub-agents: {doneCount}/{subtasks.length} done
        </div>
        <button
          onClick={() => { void load(); }}
          className="px-2 py-1 bg-gray-100 rounded text-xs"
        >
          Refresh
        </button>
      </div>

      {loading && <div className="text-gray-400">Loading…</div>}

      <div className="space-y-2 max-h-64 overflow-auto">
        {subtasks.map((subtask) => (
          <div key={subtask.id} className="bg-gray-50 p-2 rounded">
            <div className="flex justify-between gap-2">
              <span className="font-medium truncate">{subtask.title}</span>
              <span className={statusColor(subtask.status)}>{subtask.status}</span>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-gray-500">
              <span className="font-mono">{subtask.provider ?? 'auto'}</span>
              <span className="font-mono">{subtask.model ?? 'auto'}</span>
            </div>
            {subtask.error && <div className="mt-1 text-red-600 text-[10px]">{subtask.error}</div>}
            {subtask.result && !subtask.error && (
              <div className="mt-1 text-gray-600 text-[10px] truncate" title={subtask.result}>{subtask.result}</div>
            )}
          </div>
        ))}
        {subtasks.length === 0 && !loading && (
          <div className="text-gray-400">No sub-agents recorded yet.</div>
        )}
      </div>

      <div>
        <button
          onClick={() => { setShowTrace((v) => !v); }}
          className="px-2 py-1 bg-gray-100 rounded text-xs"
        >
          {showTrace ? 'Hide' : 'Show'} orchestrator trace
        </button>
        {showTrace && (
          <div className="mt-2">
            <TraceFlow taskId={taskId} />
          </div>
        )}
      </div>
    </div>
  );
}
