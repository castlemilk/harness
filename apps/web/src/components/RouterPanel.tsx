import { useState } from 'react';
import { api } from '../lib/api.js';

export function RouterPanel() {
  const [form, setForm] = useState({ title: '', complexity: 'simple', tags: '' });
  const [result, setResult] = useState<{ provider: string; model: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await api.selectProvider({
        title: form.title,
        complexity: form.complexity,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold text-sm mb-3">Route preview</h3>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-2">
        <input
          className="w-full border rounded px-2 py-1 text-xs"
          placeholder="Task title"
          value={form.title}
          onChange={(e) => { setForm({ ...form, title: e.target.value }); }}
          required
        />
        <select
          className="w-full border rounded px-2 py-1 text-xs"
          value={form.complexity}
          onChange={(e) => { setForm({ ...form, complexity: e.target.value }); }}
        >
          <option value="simple">Simple</option>
          <option value="medium">Medium</option>
          <option value="complex">Complex</option>
        </select>
        <input
          className="w-full border rounded px-2 py-1 text-xs"
          placeholder="Tags (comma separated)"
          value={form.tags}
          onChange={(e) => { setForm({ ...form, tags: e.target.value }); }}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Routing…' : 'Select provider'}
        </button>
      </form>

      {result && (
        <div className="mt-3 p-2 bg-purple-50 rounded text-xs">
          <div className="font-medium text-purple-800">Selected</div>
          <div>
            {result.provider} / {result.model}
          </div>
        </div>
      )}
      {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
    </div>
  );
}
