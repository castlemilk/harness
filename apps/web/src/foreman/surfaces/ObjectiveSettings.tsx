import { useEffect, useState } from 'react';
import type { Objective } from '../types.js';
import { Field, Modal, Select, TextArea, TextInput } from '../ui/Modal.js';
import { Button } from '../ui/primitives.js';

/**
 * Surface 1i — Objective settings.
 *
 * Objectives used to be immutable after creation — no rename, no way to write
 * down project-level context, no way to retire one without SQL. The
 * `instructions` field is the load-bearing one: it is injected into the
 * system prompt of EVERY pulse of every harness under this objective, so it
 * is where "how this project works" lives, once, instead of being repeated
 * into each harness's mission.
 */
export interface ObjectiveSettingsInput {
  name: string;
  description: string | null;
  instructions: string | null;
  spendCapUsd: number | null;
  status: 'active' | 'complete' | 'archived';
}

export function ObjectiveSettings({
  open,
  onClose,
  objective,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  objective: Objective | null;
  onSave: (id: string, input: ObjectiveSettingsInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [spendCap, setSpendCap] = useState('');
  const [status, setStatus] = useState<'active' | 'complete' | 'archived'>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !objective) return;
    setName(objective.name);
    setDescription(objective.description ?? '');
    setInstructions(objective.instructions ?? '');
    setSpendCap(objective.spendCap != null ? String(objective.spendCap) : '');
    setStatus(
      objective.status === 'complete' || objective.status === 'archived'
        ? objective.status
        : 'active',
    );
    setError(null);
    setBusy(false);
    // Keyed on `open` alone: a refresh mid-edit must not clear typed text.

  }, [open]);

  if (!objective) return null;

  const capNum = spendCap.trim() === '' ? null : Number(spendCap);
  const valid =
    name.trim().length > 0
    && (capNum === null || (Number.isFinite(capNum) && capNum >= 0));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(objective.id, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        instructions: instructions.trim() === '' ? null : instructions.trim(),
        spendCapUsd: capNum,
        status,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={604} label={`Settings for ${objective.name}`}>
      <div className="px-[22px] py-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="m-0 text-[17px] font-semibold">Objective settings</h3>
            <div className="mt-1 font-mono text-[10.5px] text-muted">
              {objective.useCase ? `shell: ${objective.useCase}` : 'core chrome'}
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

        <Field label="Name" className="mt-4">
          <TextInput value={name} onChange={setName} />
        </Field>

        <Field label="Description" className="mt-3.5">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>

        <Field
          label="Standing instructions — injected into every pulse of every harness here"
          className="mt-3.5"
        >
          <TextArea value={instructions} onChange={setInstructions} rows={6} />
        </Field>

        <div className="mt-3.5 flex gap-2.5">
          <Field label="Spend cap ($, blank = none)" className="flex-1">
            <TextInput value={spendCap} onChange={setSpendCap} mono />
          </Field>
          <Field label="Status" className="flex-1">
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v === 'complete' || v === 'archived' ? v : 'active');
              }}
              options={[
                { value: 'active', label: 'active' },
                { value: 'complete', label: 'complete' },
                { value: 'archived', label: 'archived' },
              ]}
            />
          </Field>
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
