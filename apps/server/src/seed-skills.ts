import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseSkill } from '@omega/skills';
import { prisma } from '@omega/db';

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  if (!(await exists(dir))) return files;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
      files.push(fullPath);
    }
  }
  return files;
}

export async function seedSkills(): Promise<void> {
  const skillsDir = process.env.SKILLS_DIR ?? path.resolve(process.cwd(), '.agents/skills');
  if (!(await exists(skillsDir))) {
    console.log(`Skills directory not found at ${skillsDir}, skipping skill seed.`);
    return;
  }
  const files = await findSkillFiles(skillsDir);
  let seeded = 0;
  for (const file of files) {
    try {
      const source = await readFile(file, 'utf-8');
      const manifest = parseSkill(source);
      const name = manifest.name;
      await prisma.skillArtifact.upsert({
        where: { name },
        update: {
          sourcePath: file,
          generatedPath: file,
          manifest: JSON.stringify(manifest),
        },
        create: {
          name,
          sourcePath: file,
          generatedPath: file,
          manifest: JSON.stringify(manifest),
        },
      });
      seeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to seed skill from ${file}:`, message);
    }
  }
  console.log(`Seeded ${seeded.toString()} skills from ${skillsDir}.`);
}
