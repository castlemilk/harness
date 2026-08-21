import type { SkillListing } from '../data/api.js';
import { Toggle } from '../ui/Modal.js';
import { SectionLabel } from '../ui/primitives.js';

/**
 * The skill grant list, shared by the spawn and edit dialogs.
 *
 * Skills are SkillArtifact rows — SKILL.md files seeded from `.agents/skills`
 * — and a granted skill's body is injected into every pulse's system prompt.
 * An empty registry says where skills come from instead of rendering nothing.
 */
export function SkillPicker({
  skills,
  selected,
  onChange,
}: {
  skills: SkillListing[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const chosen = new Set(selected);
  const toggle = (name: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(name);
    else next.delete(name);
    // Preserve registry order so the prompt injection order is stable.
    onChange(skills.map((s) => s.name).filter((n) => next.has(n)));
  };
  return (
    <div>
      <SectionLabel className="mb-2">Skills</SectionLabel>
      {skills.length === 0 ? (
        <p className="m-0 text-[11px] text-muted">
          No skills registered — SKILL.md files under <span className="font-mono">.agents/skills</span>{' '}
          are seeded into the registry at server start.
        </p>
      ) : (
        <div className="flex max-h-44 flex-col gap-px overflow-y-auto rounded-[7px] border border-hair">
          {skills.map((skill, i) => (
            <div
              key={skill.name}
              className={`flex items-center gap-2.5 px-3 py-2 ${i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'}`}
            >
              <Toggle
                on={chosen.has(skill.name)}
                label={skill.name}
                onChange={(v) => { toggle(skill.name, v); }}
              />
              <span className={`font-mono text-[11px] ${chosen.has(skill.name) ? 'text-ink' : 'text-ink3'}`}>
                {skill.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted" title={skill.description}>
                {skill.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
