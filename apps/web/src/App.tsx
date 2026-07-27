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

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [view, setView] = useState<View>('tasks');
  const [error, setError] = useState('');

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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ProjectSidebar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onChange={() => { void loadProjects(); }}
        view={view}
        onViewChange={setView}
      />

      {view === 'benchmarks' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50">
          <BenchmarkPanel />
        </main>
      ) : view === 'costs' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50">
          <CostDashboard />
        </main>
      ) : view === 'router' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50">
          <div className="max-w-5xl p-6 space-y-6">
            <h2 className="text-lg font-semibold">Intelligent Router</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border rounded">
                <ProviderHealthPanel />
              </div>
              <div className="bg-white border rounded">
                <StrategyLearningPanel />
              </div>
            </div>
          </div>
        </main>
      ) : view === 'errors' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50 p-6">
          <ErrorAnalysisPanel />
        </main>
      ) : view === 'traces' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50 p-6">
          <TraceTimelinePanel />
        </main>
      ) : view === 'compare' ? (
        <main className="flex-1 h-screen overflow-y-auto bg-gray-50 p-6">
          <ProviderComparePanel />
        </main>
      ) : (
        <TaskBoard projectId={selectedProjectId} />
      )}

      {view === 'tasks' && (
        <aside className="w-80 bg-white border-l border-gray-200 h-screen overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-xs border-b border-red-100">
              {error}
            </div>
          )}
          <ProviderSettings providers={providers} onChange={() => { void loadProviders(); }} />
          <RouterPanel />
          <MetricsPanel />
        </aside>
      )}
    </div>
  );
}

export default App;
