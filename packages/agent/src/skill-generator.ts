import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@omega/db';
import { getDiff } from './git.js';
import { logger } from './logger.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
}

function skillsRoot(): string {
  return process.env.SKILLS_DIR ?? path.resolve(process.cwd(), '.agents/skills');
}

/**
 * Create a reusable skill from a successfully completed task. The skill is
 * written to the skills directory (so it survives restarts) and upserted into
 * the SkillArtifact table (so the resolver can use it immediately).
 *
 * Returns the skill name, or undefined when the task/diff is not suitable.
 */
export async function generateSkillFromTask(
  prisma: PrismaClient,
  taskId: string,
  projectPath: string,
  baseCommit: string
): Promise<string | undefined> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (task?.status !== 'done') return undefined;
  // Do not auto-generate skills from benchmark tasks; they use reference
  // skills and would pollute the skill library.
  const tags = task.tags ? (JSON.parse(task.tags) as string[]) : [];
  if (tags.includes('benchmark')) return undefined;

  const diff = await getDiff(projectPath, baseCommit);
  const patch = diff.output;
  if (!patch || patch.trim().length < 20) return undefined;

  const slug = slugify(task.title);
  const name = `auto-${slug}`;
  const skillDir = path.join(skillsRoot(), 'omega', name);
  const patchPath = path.join(skillDir, 'solution.patch');
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(patchPath, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf-8');

  const description = `Auto-generated skill for: ${task.title}`;
  const instructions = `---
name: ${name}
description: ${description}
---

# Auto-generated skill: ${task.title}

${task.description ?? ''}

## Correctness strategy

A verified patch from a successful run is available at:

\`\`\`
${patchPath}
\`\`\`

Apply it directly with \`git apply\` from the project root:

\`\`\`bash
git apply ${patchPath}
\`\`\`

After applying, run the project's build/test command and confirm it passes, then call \`finish\` with success=true.
`;
  await fs.writeFile(skillMdPath, instructions, 'utf-8');

  const manifest = {
    name,
    description,
    instructions,
    generatedFrom: {
      taskId,
      title: task.title,
      createdAt: new Date().toISOString(),
    },
  };

  await prisma.skillArtifact.upsert({
    where: { name },
    create: {
      name,
      sourcePath: skillMdPath,
      generatedPath: patchPath,
      manifest: JSON.stringify(manifest),
    },
    update: {
      sourcePath: skillMdPath,
      generatedPath: patchPath,
      manifest: JSON.stringify(manifest),
    },
  });

  logger.info('Auto-generated skill from task', { taskId, skill: name, patchPath });
  return name;
}

/**
 * Recall a small set of existing skills whose name/description matches the
 * task description keywords. Used to bias the orchestrator planner toward
 * patterns that worked before.
 */
export async function recallRelevantSkills(
  prisma: PrismaClient,
  taskDescription: string | null | undefined,
  limit = 3
): Promise<{ name: string; description: string }[]> {
  const artifacts = await prisma.skillArtifact.findMany({ take: 50 });
  if (artifacts.length === 0) return [];
  const text = (taskDescription ?? '').toLowerCase();
  const keywords = Array.from(new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length >= 4)));
  if (keywords.length === 0) return [];
  const scored = artifacts
    .map((a) => {
      const manifest = JSON.parse(a.manifest) as { name?: string; description?: string };
      const haystack = `${manifest.name ?? a.name} ${manifest.description ?? ''}`.toLowerCase();
      const score = keywords.reduce((acc, kw) => (haystack.includes(kw) ? acc + 1 : acc), 0);
      return { name: manifest.name ?? a.name, description: manifest.description ?? '', score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s) => ({ name: s.name, description: s.description }));
}
