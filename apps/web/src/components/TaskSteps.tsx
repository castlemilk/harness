import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface TaskStep {
  id: string;
  taskId: string;
  idx: number;
  name: string;
  status: string;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  taskId: string;
}

function statusColor(status: string): string {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  return 'text-gray-500';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function StepCard({ step }: { step: TaskStep }) {
  const [expanded, setExpanded] = useState(false);
  const output = step.output ?? '';
  const truncated = output.length > 600;
  const displayOutput = expanded || !truncated ? output : `${output.slice(0, 600)}…`;
  const input = step.input ?? '';

  return (
    <div className={`border rounded text-xs ${step.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <button
        onClick={() => { setExpanded((e) => !e); }}
        className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 rounded-t"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${step.status === 'done' ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-medium">{step.name}</span>
          <span className={`text-[10px] ${statusColor(step.status)}`}>{step.status}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-400 text-[10px]">
          <span>{formatTime(step.createdAt)}</span>
          <span>{expanded ? '−' : '+'}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1 border-t border-gray-100">
          {input && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Input</div>
              <pre className="bg-gray-50 p-1.5 rounded text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">{input}</pre>
            </div>
          )}
          {output && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Output</div>
              <pre className="bg-gray-50 p-1.5 rounded text-[10px] overflow-auto max-h-48 whitespace-pre-wrap">{displayOutput}</pre>
            </div>
          )}
          {step.error && (
            <div>
              <div className="text-[10px] text-red-600 uppercase tracking-wide mb-0.5">Error</div>
              <pre className="bg-red-50 text-red-700 p-1.5 rounded text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">{step.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskSteps({ taskId }: Props) {
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'edit' | 'test' | 'error'>('all');

  async function load() {
    setLoading(true);
    try {
      const data = (await api.getTaskSteps(taskId)) as TaskStep[];
      setSteps(data);
    } catch {
      setSteps([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  if (loading) return <div className="text-xs text-gray-400">Loading task steps…</div>;
  if (steps.length === 0) return <div className="text-xs text-gray-400">No task steps recorded.</div>;

  const filtered = steps.filter((s) => {
    switch (filter) {
      case 'all':
        return true;
      case 'error':
        return s.status === 'failed' || Boolean(s.error);
      case 'edit':
        return ['edit_file', 'edit_lines', 'apply_patch', 'write_file'].includes(s.name);
      case 'test':
        return ['run_command', 'validate_patch', 'publish'].includes(s.name);
      default:
        return true;
    }
  });

  const counts = {
    all: steps.length,
    edit: steps.filter((s) => ['edit_file', 'edit_lines', 'apply_patch', 'write_file'].includes(s.name)).length,
    test: steps.filter((s) => ['run_command', 'validate_patch', 'publish'].includes(s.name)).length,
    error: steps.filter((s) => s.status === 'failed' || Boolean(s.error)).length,
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['all', 'edit', 'test', 'error'] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); }}
            className={`px-2 py-0.5 rounded text-[10px] ${
              filter === f ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f} ({String(counts[f])})
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-96 overflow-auto">
        {filtered.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
