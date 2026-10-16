# Skill library

Every `SKILL.md` in this tree is seeded into the harness's `SkillArtifact`
registry at server start-up (`apps/server/src/seed-skills.ts`), which is what
puts a skill in the spawn/edit dialogs and the skill picker.

## Layout and seeding

- One directory per skill: `<group>/<skill-name>/SKILL.md`, with any supporting
  files (references, scripts, `solution.patch`) beside it.
- Frontmatter must carry a non-empty `name` and `description`; `args` is
  optional. Parsing lives in `packages/skills/src/parse.ts`.
- `SKILLS_DIR` overrides what is scanned. It is a `:`-separated list; the server
  defaults it to this directory plus `apps/server/skills`, the latter being
  where `generateSkillFromTask` writes auto-generated skills.

## How a skill reaches an agent

1. **Granted.** A harness's granted skills are injected, full body, into every
   pulse's system prompt (`apps/server/src/lib/pulse-engine.ts`).
2. **Resolved.** `resolveSkills` (`packages/agent/src/skill-resolver.ts`) picks
   up to three skills by matching the project's languages and frameworks, plus
   frontend hints in the task description, against each skill's name and
   description. Reference-patch skills (those citing a `solution.patch`) are
   only delivered on an exact task-tag match, and benchmark tasks get no skills
   at all — so a design skill here cannot leak into a DeepSWE run.

Because of (2), a skill that should be found automatically has to name its
language or framework in the name or description.

## Vendored design skills

`omega/design-taste-frontend`, `omega/frontend-design`,
`omega/high-end-visual-design`, `omega/minimalist-ui`,
`omega/industrial-brutalist-ui`, `omega/redesign-existing-projects` and
`omega/web-design-guidelines` are vendored copies of `~/.agents/skills`
entries. Re-vendor with `cp -R` when the upstream skill changes, then keep the
two adaptations below.

- `design-taste-frontend/SKILL.md` resolves its own `<skill>` placeholder to
  `.agents/skills/omega/design-taste-frontend`, so an agent running in the repo
  or a worktree can execute `scripts/*.mjs`. Those scripts need Node 22+ and an
  installed Chrome/Edge/Chromium, and `assets.mjs` needs network access.
- `web-design-guidelines` fetches its rule list from a public URL at use time.
