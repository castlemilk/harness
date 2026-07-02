import { useState } from 'react';
import { api } from '../lib/api.js';

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  _count?: { tasks: number };
}

interface Props {
  projects: Project[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onChange: () => void;
}

export function ProjectSidebar({ projects, selectedId, onSelect, onChange }: Props) {
  const [form, setForm] = useState({ name: '', path: '', repoUrl: '', description: '' });
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await api.createProject(form);
    setForm({ name: '', path: '', repoUrl: '', description: '' });
    setOpen(false);
    onChange();
  }

  return (
    <aside className="w-72 bg-white border-r border-gray-200 h-screen flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold">Omega Harness</h1>
        <p className="text-xs text-gray-500">Projects</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => { onSelect(p.id); }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              selectedId === p.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-100'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-gray-400">{p._count?.tasks ?? 0}</span>
            </div>
            <div className="text-xs text-gray-400 truncate">{p.path}</div>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-200">
        {!open ? (
          <button
            onClick={() => { setOpen(true); }}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            + Add project
          </button>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-2">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Name"
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); }}
              required
            />
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Path"
              value={form.path}
              onChange={(e) => { setForm({ ...form, path: e.target.value }); }}
              required
            />
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Repo URL (optional)"
              value={form.repoUrl}
              onChange={(e) => { setForm({ ...form, repoUrl: e.target.value }); }}
            />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-3 py-1 bg-blue-600 text-white rounded text-sm">
                Save
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); }}
                className="flex-1 px-3 py-1 bg-gray-200 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}
