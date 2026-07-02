import { useState } from 'react';
import { api } from '../lib/api.js';

export interface Provider {
  id: string;
  name: string;
  kind: string;
  baseUrl?: string;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}

interface Props {
  providers: Provider[];
  onChange: () => void;
}

export function ProviderSettings({ providers, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    kind: 'generic',
    baseUrl: '',
    apiKey: '',
    defaultModel: '',
    capabilities: '[{"name":"model","level":"capable"}]',
  });

  async function handleToggle(id: string) {
    await api.toggleProvider(id);
    onChange();
  }

  async function handleDelete(id: string) {
    await api.deleteProvider(id);
    onChange();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await api.createProvider({
      ...form,
      capabilities: form.capabilities,
    });
    setForm({
      name: '',
      kind: 'generic',
      baseUrl: '',
      apiKey: '',
      defaultModel: '',
      capabilities: '[{"name":"model","level":"capable"}]',
    });
    setOpen(false);
    onChange();
  }

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Providers</h3>
        <button
          onClick={() => { setOpen(!open); }}
          className="text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
        >
          {open ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {open && (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-2 mb-3">
          <input
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="Name"
            value={form.name}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); }}
            required
          />
          <select
            className="w-full border rounded px-2 py-1 text-xs"
            value={form.kind}
            onChange={(e) => { setForm({ ...form, kind: e.target.value }); }}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
            <option value="gemini">Gemini</option>
            <option value="generic">Generic</option>
          </select>
          <input
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="Base URL"
            value={form.baseUrl}
            onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); }}
          />
          <input
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="API key"
            value={form.apiKey}
            onChange={(e) => { setForm({ ...form, apiKey: e.target.value }); }}
          />
          <input
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="Default model"
            value={form.defaultModel}
            onChange={(e) => { setForm({ ...form, defaultModel: e.target.value }); }}
            required
          />
          <input
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="Capabilities JSON"
            value={form.capabilities}
            onChange={(e) => { setForm({ ...form, capabilities: e.target.value }); }}
          />
          <button type="submit" className="w-full px-2 py-1 bg-blue-600 text-white rounded text-xs">
            Save provider
          </button>
        </form>
      )}

      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-xs bg-gray-50 p-2 rounded">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-gray-400">
                {p.kind} • {p.defaultModel}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { void handleToggle(p.id); }}
                className={`px-2 py-1 rounded ${p.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {p.enabled ? 'On' : 'Off'}
              </button>
              <button onClick={() => { void handleDelete(p.id); }} className="text-red-500 hover:text-red-700">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
