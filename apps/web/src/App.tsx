import { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { ProjectSidebar, type Project, type View } from './components/ProjectSidebar.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ProviderSettings, type Provider } from './components/ProviderSettings.js';
import { RouterPanel } from './components/RouterPanel.js';
import { MetricsPanel } from './components/MetricsPanel.js';
import { BenchmarkPanel } from './components/BenchmarkPanel.js';
import { CostDashboard } from './components/CostDashboard.js';
import StrategyLearningPanel from './components/StrategyLearningPanel.js';
import ProviderHealthPanel from './components/ProviderHealthPanel.js';
import ErrorAnalysisPanel from './components/ErrorAnalysisPanel.js';
import ProviderComparePanel from './components/ProviderComparePanel.js';
import TraceTimelinePanel from './components/TraceTimelinePanel.js';
import { ForemanApp } from './foreman/ForemanApp.js';

/**
 * Foreman is the application shell. The pre-Foreman panels (benchmarks,
 * providers, router, traces) remain reachable as a secondary mode — they are
 * operator tooling for the layer underneath the fleet, not part of it.
 */
function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [view, setView] = useState<View>('tasks');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'foreman' | 'legacy'>('foreman');

  async function loadProjects() {
    try {
      const data = await api.getProjects();
      setProjects(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadProviders() {
    try {
      const data = await api.getProviders();
      setProviders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void (async () => {
      await loadProjects();
      await loadProviders();
    })();
  }, []);

  const activeProjectId = selectedProjectId ?? projects[0]?.id;
  const activeProjectName = projects.find((p) => p.id === activeProjectId)?.name ?? null;

  if (mode === 'foreman') {
    return (
      <ForemanApp
        projectId={activeProjectId}
        projectName={activeProjectName}
        onOpenLegacy={() => { setMode('legacy'); }}
      />
    );
  }

  return (
    <div className="legacy-surface flex h-screen w-screen overflow-hidden">
      <ProjectSidebar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onChange={() => {
          void loadProjects();
        }}
        view={view}
        onViewChange={setView}
      />

      {view === 'benchmarks' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50">
          <BenchmarkPanel />
        </main>
      ) : view === 'costs' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50">
          <CostDashboard />
        </main>
      ) : view === 'router' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-5xl space-y-6 p-6">
            <h2 className="text-lg font-semibold">Intelligent Router</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded border bg-white">
                <ProviderHealthPanel />
              </div>
              <div className="rounded border bg-white">
                <StrategyLearningPanel />
              </div>
            </div>
          </div>
        </main>
      ) : view === 'errors' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50 p-6">
          <ErrorAnalysisPanel />
        </main>
      ) : view === 'traces' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50 p-6">
          <TraceTimelinePanel />
        </main>
      ) : view === 'compare' ? (
        <main className="h-screen flex-1 overflow-y-auto bg-gray-50 p-6">
          <ProviderComparePanel />
        </main>
      ) : (
        <TaskBoard projectId={selectedProjectId} />
      )}

      {view === 'tasks' && (
        <aside className="h-screen w-80 overflow-y-auto border-l border-gray-200 bg-white">
          {error && (
            <div className="border-b border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>
          )}
          <ProviderSettings
            providers={providers}
            onChange={() => {
              void loadProviders();
            }}
          />
          <RouterPanel />
          <MetricsPanel />
        </aside>
      )}

      <button
        type="button"
        onClick={() => { setMode('foreman'); }}
        className="fixed bottom-4 right-4 rounded-md bg-[#16161a] px-3 py-2 text-xs font-semibold text-white shadow-lg"
      >
        ← Back to Foreman
      </button>
    </div>
  );
}

export default App;
