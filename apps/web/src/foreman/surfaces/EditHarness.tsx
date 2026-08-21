import { useEffect, useState } from 'react';
import type { Harness, Playbook } from '../types.js';
import type { SkillListing } from '../data/api.js';
import { Field, Modal, Select, TextArea, TextInput } from '../ui/Modal.js';
import { Button } from '../ui/primitives.js';
import { SkillPicker } from './SkillPicker.js';

/**
 * Surface 1h — Edit a harness.
 *
 * The spawn dialog's counterpart: everything a standing agent can change
 * after birth — mission, model, cadence, caps, playbook, skills. The server
 * has exposed PATCH /harnesses/:id since the orchestration tables landed;
 * this is the first thing in the web app that calls it. (The Console used to
 * render heartbeat and max-children as slider-shaped read-only widgets — the
 * strongest "this should be editable" affordance in the app, doing nothing.)
 */
export interface EditHarnessInput {
  name: string;
  mission: string;
  model: string;
  playbookId: string | null;
  heartbeatMinutes: number;
  spendCapUsd: number | null;
  maxChildren: number;
  skills: string[];
}

export function EditHarness({
  open,
  onClose,
  harness,
  playbooks,
  models,
  skills,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  harness: Harness | null;
  playbooks: Playbook[];
  /** Models the server can serve; the harness's current model is always offered. */
  models: string[];
  skills: SkillListing[];
  onSave: (id: string, input: EditHarnessInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [model, setModel] = useState('');
  const [playbookId, setPlaybookId] = useState('');
  const [heartbeat, setHeartbeat] = useState('30');
  const [budget, setBudget] = useState('');
  const [maxChildren, setMaxChildren] = useState('3');
  const [granted, setGranted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening for a different harness starts from ITS current values.
  useEffect(() => {
    if (!open || !harness) return;
    setName(harness.name);
    setMission(harness.mission);
    setModel(harness.model);
    setPlaybookId(harness.playbookId ?? '');
    setHeartbeat(String(harness.heartbeatMinutes));
    setBudget(harness.spendCap != null ? String(harness.spendCap) : '');
    setMaxChildren(String(harness.maxChildren));
    setGranted(harness.skills ?? []);
    setError(null);
    setBusy(false);
    // Keyed on `open` alone for the same reason the spawn dialog is: a state
    // refresh mid-edit must not clear what the operator has typed.

  }, [open]);

  if (!harness) return null;

  const heartbeatNum = Number(heartbeat);
  const maxChildrenNum = Number(maxChildren);
  const budgetNum = budget.trim() === '' ? null : Number(budget);
  const valid =
    name.trim().length > 0
    && mission.trim().length > 0
    && model.length > 0
    && Number.isInteger(heartbeatNum) && heartbeatNum >= 1
    && Number.isInteger(maxChildrenNum) && maxChildrenNum >= 0
    && (budgetNum === null || (Number.isFinite(budgetNum) && budgetNum >= 0));

  const available = [...new Set([harness.model, ...models])];

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(harness.id, {
        name: name.trim(),
        mission: mission.trim(),
        model,
        playbookId: playbookId || null,
        heartbeatMinutes: heartbeatNum,
        spendCapUsd: budgetNum,
        maxChildren: maxChildrenNum,
        skills: granted,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={604} label={`Edit ${harness.name}`}>
      <div className="px-[22px] py-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="m-0 text-[17px] font-semibold">Edit harness</h3>
            <div className="mt-1 font-mono text-[10.5px] text-muted">
              changes apply from the next pulse
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[13px] text-muted hover:text-ink"
          >
            esc
          </button>
        </div>

        <div className="mt-4 flex gap-2.5">
          <Field label="Name" className="flex-1">
            <TextInput value={name} onChange={setName} mono />
          </Field>
          <Field label="Playbook" className="w-[150px]">
            <Select
              value={playbookId}
              onChange={setPlaybookId}
              options={[
                { value: '', label: 'None' },
                ...playbooks.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>
        </div>

        <Field label="Mission" className="mt-3.5">
          <TextArea value={mission} onChange={setMission} rows={4} />
        </Field>

        <div className="mt-3.5 flex gap-2.5">
          <Field label="Model" className="flex-1">
            <Select
              value={model}
              onChange={setModel}
              mono
              options={available.map((m) => ({ value: m, label: m }))}
            />
          </Field>
          <Field label="Heartbeat (m)" className="flex-1">
            <TextInput value={heartbeat} onChange={setHeartbeat} mono />
          </Field>
          <Field label="Budget cap ($, blank = none)" className="flex-1">
            <TextInput value={budget} onChange={setBudget} mono />
          </Field>
          <Field label="Max children" className="flex-1">
            <TextInput value={maxChildren} onChange={setMaxChildren} mono />
          </Field>
        </div>

        <div className="mt-4">
          <SkillPicker skills={skills} selected={granted} onChange={setGranted} />
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger-tint">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="accent" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
