import { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { ProjectSidebar, type Project } from './components/ProjectSidebar.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ProviderSettings, type Provider } from './components/ProviderSettings.js';
import { RouterPanel } from './components/RouterPanel.js';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
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
    loadProjects();
    loadProviders();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ProjectSidebar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onChange={loadProjects}
      />

      <TaskBoard projectId={selectedProjectId} />

      <aside className="w-80 bg-white border-l border-gray-200 h-screen overflow-y-auto">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-xs border-b border-red-100">
            {error}
          </div>
        )}
        <ProviderSettings providers={providers} onChange={loadProviders} />
        <RouterPanel />
      </aside>
    </div>
  );
}

export default App;
