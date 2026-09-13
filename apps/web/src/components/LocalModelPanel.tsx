import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export interface LocalModel {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  cacheMode: 'cold' | 'warm-prefix' | 'warm-ngram';
  warmupRuns: number;
  contextTokens?: number;
  keepAlive: string;
  proxyEnabled: boolean;
  tokenHorizonUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredModel {
  name: string;
  size?: number;
  digest?: string;
  modified_at?: string;
  details?: Record<string, unknown>;
}

interface Props {
  onModelSelect?: (model: LocalModel) => void;
}

export function LocalModelPanel({ onModelSelect }: Props) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    baseUrl: 'http://127.0.0.1:11435',
    model: '',
    cacheMode: 'cold' as const,
    warmupRuns: 0,
    contextTokens: 4096,
    keepAlive: '30m',
    proxyEnabled: true,
  });
  const [showForm, setShowForm] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});

  async function loadModels() {
    try {
      const data = await api.getLocalModels();
      setModels(data as unknown as LocalModel[]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadDiscovered() {
    setLoading(true);
    try {
      const data = await api.discoverLocalModels();
      setDiscovered(data.models as unknown as DiscoveredModel[]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createLocalModel(form);
      setShowForm(false);
      setForm({
        name: '',
        baseUrl: 'http://127.0.0.1:11435',
        model: '',
        cacheMode: 'cold',
        warmupRuns: 0,
        contextTokens: 4096,
        keepAlive: '30m',
        proxyEnabled: true,
      });
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteLocalModel(id);
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLaunch(model: LocalModel) {
    try {
      const result = await api.launchLocalModel(model.id);
      setMetrics((prev) => ({ ...prev, [model.id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoadMetrics(model: LocalModel) {
    try {
      const data = await api.getLocalModelMetrics(model.id);
      setMetrics((prev) => ({ ...prev, [model.id]: data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadModels();
    void loadDiscovered();
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Local Models</h2>
        <div className="space-x-2">
          <button
            onClick={() => { void loadDiscovered(); }}
            disabled={loading}
            className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            {loading ? 'Scanning…' : 'Discover Models'}
          </button>
          <button
            onClick={() => { setShowForm(!showForm); }}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Add Model'}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      {showForm && (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="bg-gray-50 p-4 rounded space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Config name"
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); }}
              required
            />
            <select
              className="border rounded px-2 py-1 text-sm"
              value={form.model}
              onChange={(e) => { setForm({ ...form, model: e.target.value }); }}
              required
            >
              <option value="">Select model</option>
              {discovered.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Base URL"
              value={form.baseUrl}
              onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); }}
            />
            <select
              className="border rounded px-2 py-1 text-sm"
              value={form.cacheMode}
              onChange={(e) => { setForm({ ...form, cacheMode: e.target.value as typeof form.cacheMode }); }}
            >
              <option value="cold">Cold (no cache)</option>
              <option value="warm-prefix">Warm prefix</option>
              <option value="warm-ngram">Warm n-gram</option>
            </select>
            <input
              className="border rounded px-2 py-1 text-sm"
              type="number"
              placeholder="Warmup runs"
              value={form.warmupRuns}
              onChange={(e) => { setForm({ ...form, warmupRuns: parseInt(e.target.value, 10) || 0 }); }}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              type="number"
              placeholder="Context tokens"
              value={form.contextTokens}
              onChange={(e) => { setForm({ ...form, contextTokens: parseInt(e.target.value, 10) || 4096 }); }}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Keep alive (e.g. 30m)"
              value={form.keepAlive}
              onChange={(e) => { setForm({ ...form, keepAlive: e.target.value }); }}
            />
            <label className="flex items-center space-x-2 text-sm">
              <input
                type="checkbox"
                checked={form.proxyEnabled}
                onChange={(e) => { setForm({ ...form, proxyEnabled: e.target.checked }); }}
              />
              <span>Use Token Horizon proxy</span>
            </label>
          </div>
          <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
            Save Configuration
          </button>
        </form>
      )}

      <div className="grid gap-3">
        {models.map((model) => (
          <div key={model.id} className="border rounded-lg p-4 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-medium">{model.name}</h3>
                <p className="text-sm text-gray-500">{model.model}</p>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-1 text-xs rounded ${model.proxyEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {model.proxyEnabled ? 'Proxy' : 'Direct'}
                </span>
                <span className={`px-2 py-1 text-xs rounded ${model.cacheMode === 'cold' ? 'bg-gray-100' : model.cacheMode === 'warm-prefix' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                  {model.cacheMode}
                </span>
              </div>
            </div>

            <div className="text-xs text-gray-500 space-y-1 mb-3">
              <div>Base URL: {model.baseUrl}</div>
              <div>Warmup: {model.warmupRuns} runs | Context: {model.contextTokens ?? 'default'} | Keep: {model.keepAlive}</div>
            </div>

            <div className="flex space-x-2">
              <button
                onClick={() => { void handleLaunch(model); }}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Launch Test
              </button>
              <button
                onClick={() => { void handleLoadMetrics(model); }}
                className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
              >
                Metrics
              </button>
              <button
                onClick={() => { onModelSelect?.(model); }}
                className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
              >
                Use in Bench
              </button>
              <button
                onClick={() => { void handleDelete(model.id); }}
                className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Delete
              </button>
            </div>

            {metrics[model.id] != null && (
              <div className="mt-3 p-2 bg-gray-50 rounded text-xs">
                <pre>{JSON.stringify(metrics[model.id], null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {models.length === 0 && !showForm && (
        <div className="text-center py-8 text-gray-500">
          <p>No local models configured.</p>
          <p className="text-sm">Click "Discover Models" to scan for Ollama models, then "+ Add Model" to configure one.</p>
        </div>
      )}
    </div>
  );
}
