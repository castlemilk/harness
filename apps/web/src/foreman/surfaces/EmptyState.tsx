import { useState } from 'react';
import { Button } from '../ui/primitives.js';
import { Field, Modal, TextArea, TextInput } from '../ui/Modal.js';

/**
 * Surface 1l — Empty state.
 *
 * Nothing runs until an objective exists, so the first screen asks for one
 * rather than showing an empty dashboard.
 */

const TEMPLATES = [
  {
    name: 'Ship a release',
    flow: 'board → build → review → merge',
    staffing: '3 leads · 1 playbook',
  },
  {
    name: 'Keep a queue at zero',
    flow: 'watch → triage → staff → close',
    staffing: '1 lead · autoscales',
  },
  {
    name: 'Standing watch',
    flow: 'poll logs → file → escalate',
    staffing: '1 lead · hourly pulse',
  },
];

export function EmptyState({
  hasProject,
  projectName,
  onCreate,
  onConnectRepo,
}: {
  hasProject: boolean;
  projectName: string | null;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
  onConnectRepo: () => void;
}) {
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openWith = (template?: (typeof TEMPLATES)[number]) => {
    setName(template ? template.name : '');
    setDescription(template ? `${template.flow} · ${template.staffing}` : '');
    setError(null);
    setDialog(true);
  };

  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    void onCreate({ name: name.trim(), description: description.trim() })
      .then(() => { setDialog(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setBusy(false); });
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas p-10 text-ink">
      <div className="w-[620px] max-w-full rounded-[10px] border border-line bg-canvas px-[30px] py-[34px] text-center">
        <div className="mx-auto h-11 w-11 rounded-[10px] border border-hair bg-card" aria-hidden="true" />
        <h3 className="m-0 mt-4 text-[18px] font-semibold">No objective yet</h3>
        <p className="mx-auto mt-2 max-w-[400px] text-[12.5px] leading-relaxed text-ink3 [text-wrap:pretty]">
          A harness needs something to be responsible for. Name the outcome, and Foreman staffs it —
          one lead per workstream, children spawned as the work splits.
        </p>

        <div className="mt-[22px] flex gap-2.5 text-left">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              disabled={!hasProject}
              onClick={() => { openWith(t); }}
              className="flex-1 rounded-lg border border-line bg-panel p-3.5 transition-colors hover:border-edge disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="text-[11.5px] font-semibold">{t.name}</div>
              <div className="mt-1.5 font-mono text-[10.5px] leading-[1.5] text-muted">{t.flow}</div>
              <div className="mt-2 font-mono text-[9.5px] text-faint">{t.staffing}</div>
            </button>
          ))}
        </div>

        <div className="mt-[22px] flex items-center justify-center gap-2.5">
          <Button tone="accent" disabled={!hasProject} onClick={() => { openWith(); }}>
            New objective
          </Button>
          {!hasProject && (
            <Button onClick={onConnectRepo}>Connect a repo first</Button>
          )}
        </div>

        <div className="mt-[18px] font-mono text-[10px] text-faint">
          {hasProject ? `${projectName ?? 'project'} connected` : 'no repo connected'} · no
          playbooks · 0 spend
        </div>
      </div>

      <Modal open={dialog} onClose={() => { setDialog(false); }} width={520} label="New objective">
        <div className="px-[22px] py-5">
          <h3 className="m-0 text-[17px] font-semibold">New objective</h3>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            in {projectName ?? 'this project'}
          </div>

          <Field label="Outcome" className="mt-4">
            <TextInput value={name} onChange={setName} placeholder="Ship v3 integrations" />
          </Field>
          <Field label="What done looks like" className="mt-3.5">
            <TextArea value={description} onChange={setDescription} rows={3} />
          </Field>

          {error && (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger-tint">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
            <div className="flex-1" />
            <Button onClick={() => { setDialog(false); }}>Cancel</Button>
            <Button tone="accent" onClick={submit} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create objective'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
