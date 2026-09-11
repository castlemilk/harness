import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@omega/db';
import { resolveSkills } from './skill-resolver.js';

describe('skill resolver context bounds', () => {
  it('limits broad matches and truncates their instructions', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'omega-skill-resolver-'));
    try {
      await writeFile(path.join(projectPath, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }));
      const artifacts = Array.from({ length: 5 }, (_, index) => ({
        name: `typescript-skill-${String(index)}`,
        sourcePath: `/skills/skill-${String(index)}.md`,
        manifest: JSON.stringify({
          name: `typescript-skill-${String(index)}`,
          description: 'A TypeScript implementation skill.',
          instructions: 'x'.repeat(8_000),
        }),
      }));
      const prisma = {
        skillArtifact: { findMany: async () => artifacts },
      } as unknown as PrismaClient;

      const skills = await resolveSkills(prisma, projectPath, 'Implement a TypeScript change', []);

      expect(skills).toHaveLength(2);
      expect(skills[0]?.instructions).toHaveLength(6_000 + '\n\n[Additional broad skill instructions omitted to preserve agent context.]'.length);
      expect(skills[1]?.instructions).toHaveLength(2_000 + '\n\n[Additional broad skill instructions omitted to preserve agent context.]'.length);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('does not inject reference patches into benchmark tasks', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'omega-skill-resolver-'));
    try {
      const prisma = {
        skillArtifact: {
          findMany: async () => [{
            name: 'deepswe-example',
            sourcePath: '/skills/deepswe-example/SKILL.md',
            manifest: JSON.stringify({
              name: 'deepswe-example',
              description: 'A task-specific skill.',
            instructions: 'Apply solution.patch and run the verifier.',
            }),
          }],
        },
      } as unknown as PrismaClient;

      const skills = await resolveSkills(prisma, projectPath, 'Implement the benchmark task', [
        'example',
        'benchmark',
      ]);

      expect(skills).toEqual([]);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
