import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { TraceFlow } from './TraceFlow.js';
import { TraceAnalysisPanel } from './TraceAnalysisPanel.js';

interface Step {
  id: string;
  idx: number;
  name: string;
  status: string;
  input?: string;
  output?: string;
  error?: string | null;
}

interface Trace {
  id: string;
  role: string;
  content: string;
  toolCalls?: string | null;
  createdAt: string;
}

interface Diff {
  id: string;
  branch: string;
  patch: string;
}

interface AgentRun {
  id: string;
  branch: string;
  baseCommit: string;
  resultStatus: string;
  validationSummary?: string | null;
  publishedVersion?: string | null;
}

interface Props {
  taskId: string;
}

function statusColor(status: string) {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'in_progress') return 'text-yellow-600';
  return 'text-gray-500';
}

export function TaskDetail({ taskId }: Props) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'steps' | 'traces' | 'diff' | 'trace' | 'analysis'>('steps');

  async function load() {
    setLoading(true);
    const [s, t, d, a] = await Promise.all([
      api.getTaskSteps(taskId).catch(() => []),
      api.getTaskTraces(taskId).catch(() => []),
      api.getTaskDiffs(taskId).catch(() => []),
      api.getTaskAgentRun(taskId).catch(() => null),
    ]);
    setSteps((s as Step[]).sort((a, b) => a.idx - b.idx));
    setTraces(t as Trace[]);
    setDiffs(d as Diff[]);
    setAgentRun(a as AgentRun | null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  return (
    <div className="mt-3 border-t border-gray-200 pt-3 text-xs">
      {agentRun && (
        <div className="mb-3 bg-gray-50 p-2 rounded space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Agent run</span>
            <span className={statusColor(agentRun.resultStatus)}>{agentRun.resultStatus}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Branch</span>
            <span className="font-mono truncate max-w-[180px]" title={agentRun.branch}>{agentRun.branch}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Base commit</span>
            <span className="font-mono truncate max-w-[180px]" title={agentRun.baseCommit}>{agentRun.baseCommit.slice(0, 8)}</span>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <button
          onClick={() => { setTab('steps'); }}
          className={`px-2 py-1 rounded ${tab === 'steps' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
        >
          Steps ({steps.length})
        </button>
        <button
          onClick={() => { setTab('traces'); }}
          className={`px-2 py-1 rounded ${tab === 'traces' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
        >
          Traces ({traces.length})
        </button>
        <button
          onClick={() => { setTab('diff'); }}
          className={`px-2 py-1 rounded ${tab === 'diff' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
        >
          Diff
        </button>
        <button
          onClick={() => { setTab('trace'); }}
          className={`px-2 py-1 rounded ${tab === 'trace' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
        >
          Trace flow
        </button>
        <button
          onClick={() => { setTab('analysis'); }}
          className={`px-2 py-1 rounded ${tab === 'analysis' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
        >
          Analysis
        </button>
        <button onClick={() => { void load(); }} className="ml-auto px-2 py-1 bg-gray-100 rounded">
          Refresh
        </button>
      </div>

      {loading && <div className="text-gray-400">Loading…</div>}

      {tab === 'steps' && (
        <div className="space-y-2 max-h-64 overflow-auto">
          {steps.map((step) => (
            <div key={step.id} className="bg-gray-50 p-2 rounded">
              <div className="flex justify-between">
                <span className="font-medium">{step.idx}. {step.name}</span>
                <span className={statusColor(step.status)}>{step.status}</span>
              </div>
              {step.input && (
                <pre className="mt-1 text-[10px] bg-white p-1 rounded overflow-auto max-h-20">{step.input}</pre>
              )}
              {step.output && (
                <pre className="mt-1 text-[10px] bg-white p-1 rounded overflow-auto max-h-32">{step.output}</pre>
              )}
              {step.error && <div className="mt-1 text-red-600">{step.error}</div>}
            </div>
          ))}
          {steps.length === 0 && <div className="text-gray-400">No steps recorded.</div>}
        </div>
      )}

      {tab === 'traces' && (
        <div className="space-y-2 max-h-64 overflow-auto">
          {traces.map((trace) => (
            <div key={trace.id} className="bg-gray-50 p-2 rounded">
              <div className="flex justify-between text-gray-500 mb-1">
                <span className="font-medium capitalize">{trace.role}</span>
                <span>{new Date(trace.createdAt).toLocaleTimeString()}</span>
              </div>
              {trace.content && (
                <pre className="text-[10px] bg-white p-1 rounded overflow-auto max-h-32">{trace.content}</pre>
              )}
              {trace.toolCalls && (
                <pre className="text-[10px] bg-white p-1 rounded overflow-auto max-h-32 mt-1">{trace.toolCalls}</pre>
              )}
            </div>
          ))}
          {traces.length === 0 && <div className="text-gray-400">No traces recorded.</div>}
        </div>
      )}

      {tab === 'diff' && (
        <div className="max-h-64 overflow-auto">
          {diffs.length > 0 ? (
            <pre className="text-[10px] bg-gray-900 text-green-400 p-2 rounded overflow-auto">{diffs[0]?.patch}</pre>
          ) : (
            <div className="text-gray-400">No diff recorded.</div>
          )}
        </div>
      )}

      {tab === 'trace' && <TraceFlow taskId={taskId} />}
      {tab === 'analysis' && <TraceAnalysisPanel taskId={taskId} />}
    </div>
  );
}
