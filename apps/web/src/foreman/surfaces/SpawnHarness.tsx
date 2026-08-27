import { useEffect, useState } from 'react';
import type { Harness, Playbook } from '../types.js';
import type { SkillListing, SpawnHarnessInput } from '../data/api.js';
import { Field, Modal, Select, TextArea, TextInput, Toggle } from '../ui/Modal.js';
import { Button, SectionLabel } from '../ui/primitives.js';
import { SkillPicker } from './SkillPicker.js';

/**
 * Surface 1d — Spawn a harness.
 *
 * Caps and permissions are set at birth, and a dry run costs nothing: nothing
 * about a harness's blast radius is left to be configured after it is already
 * running.
 */

export interface Permission {
  id: string;
  label: string;
  granted: boolean;
  needsApproval: boolean;
}

const DEFAULT_PERMISSIONS: Permission[] = [
  { id: 'repo', label: 'Read repo, run tests, open PRs', granted: true, needsApproval: false },
  { id: 'comment', label: 'Comment on tickets it owns', granted: true, needsApproval: false },
  { id: 'merge', label: 'Merge without review', granted: false, needsApproval: true },
  { id: 'scope', label: 'Touch anything outside its scope', granted: false, needsApproval: false },
];

/** Fallback only — the real list comes from the server's providers. */
const FALLBACK_MODELS = ['opus-4.6', 'sonnet-4.6', 'haiku-4'];

/**
 * Router-delegated model choice: the IntelligentRouter picks a provider/model
 * every pulse from capability + benchmark + health evidence. Bare `auto` lets
 * the strategy learner choose the strategy too.
 */
export const AUTO_MODELS = ['auto', 'auto:cost-optimized', 'auto:performance-optimized'];
const HEARTBEATS = [15, 30, 60, 120];
const BUDGETS = [5, 15, 40, 100];
const MAX_CHILDREN = [0, 3, 6, 16];

export function SpawnHarness({
  open,
  onClose,
  objectiveId,
  objectiveName,
  parent,
  playbooks,
  models,
  skills,
  onSpawn,
}: {
  open: boolean;
  onClose: () => void;
  objectiveId: string;
  objectiveName: string;
  parent: Harness | null;
  playbooks: Playbook[];
  /** Models the server can serve; empty falls back to the static list. */
  models: string[];
  skills: SkillListing[];
  onSpawn: (input: SpawnHarnessInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [playbookId, setPlaybookId] = useState('');
  const [mission, setMission] = useState('');
  const [model, setModel] = useState('');
  const [heartbeat, setHeartbeat] = useState(30);
  const [budget, setBudget] = useState(15);
  const [maxChildren, setMaxChildren] = useState(3);
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_PERMISSIONS);
  const [granted, setGranted] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = [...AUTO_MODELS, ...(models.length > 0 ? models : FALLBACK_MODELS)];
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog for a different parent starts from a clean form.
  useEffect(() => {
    if (!open) return;
    setName('');
    setPlaybookId(playbooks[0]?.id ?? '');
    setMission('');
    setModel(parent?.model ?? available[0]);
    setHeartbeat(30);
    setBudget(15);
    setMaxChildren(3);
    setPermissions(DEFAULT_PERMISSIONS);
    setGranted([]);
    setDryRun(false);
    setError(null);
    setBusy(false);
    // Deliberately keyed on `open` alone: a playbook list refresh mid-edit
    // must not clear what the user has typed.
     
  }, [open]);

  const valid = name.trim().length > 0 && mission.trim().length > 0 && model.length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSpawn({
        objectiveId,
        parentId: parent?.id ?? null,
        workstreamId: parent?.workstreamId ?? null,
        playbookId: playbookId || null,
        name: name.trim(),
        mission: mission.trim(),
        model,
        heartbeatMinutes: heartbeat,
        spendCapUsd: budget,
        maxChildren,
        permissions,
        skills: granted,
        dryRun,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={604} label="New harness">
      <div className="px-[22px] py-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="m-0 text-[17px] font-semibold">New harness</h3>
            <div className="mt-1 font-mono text-[10.5px] text-muted">
              {parent ? `under ${parent.name} · ` : ''}
              {objectiveName}
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
            <TextInput value={name} onChange={setName} placeholder="640-webhook-retry" mono />
          </Field>
          <Field label="From playbook" className="w-[150px]">
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
          <TextArea value={mission} onChange={setMission} rows={3} />
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
          <Field label="Heartbeat" className="flex-1">
            <Select
              value={String(heartbeat)}
              onChange={(v) => { setHeartbeat(Number(v)); }}
              mono
              options={HEARTBEATS.map((h) => ({ value: String(h), label: `${String(h)}m` }))}
            />
          </Field>
          <Field label="Budget cap" className="flex-1">
            <Select
              value={String(budget)}
              onChange={(v) => { setBudget(Number(v)); }}
              mono
              options={BUDGETS.map((b) => ({ value: String(b), label: `$${b.toFixed(2)}` }))}
            />
          </Field>
          <Field label="Max children" className="flex-1">
            <Select
              value={String(maxChildren)}
              onChange={(v) => { setMaxChildren(Number(v)); }}
              mono
              options={MAX_CHILDREN.map((c) => ({ value: String(c), label: String(c) }))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <SectionLabel className="mb-2">Permissions</SectionLabel>
          <div className="flex flex-col gap-px overflow-hidden rounded-[7px] border border-hair">
            {permissions.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-2.5 px-3 py-2.5 ${
                  i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'
                }`}
              >
                <Toggle
                  on={p.granted}
                  label={p.label}
                  onChange={(v) =>
                    { setPermissions((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, granted: v } : x)),
                    ); }
                  }
                />
                <span
                  className={`flex-1 text-[11.5px] ${p.granted ? 'text-ink' : 'text-ink3'}`}
                >
                  {p.label}
                </span>
                {p.needsApproval && !p.granted && (
                  <span className="font-mono text-[9.5px] text-warn">needs approval</span>
                )}
              </div>
            ))}
          </div>
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
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink3">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => { setDryRun(e.target.checked); }}
              className="h-[13px] w-[13px] rounded-sm border border-white/20 bg-card accent-accent"
            />
            Dry run first (no writes)
          </label>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="accent" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? 'Spawning…' : dryRun ? 'Dry run' : 'Spawn & start'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
