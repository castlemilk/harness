import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerSkill } from '@omega/skills';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const skillCmd = new Command('skill').description('Manage skill artifacts');

skillCmd
  .command('generate')
  .description('Generate a harness adapter from a SKILL.md file')
  .argument('<source>', 'path to SKILL.md')
  .action(async (source) => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const outputDir = path.join(repoRoot, 'packages/skills/src');
    const manifest = await registerSkill(path.resolve(source), outputDir);
    console.log(`Generated adapter for skill: ${manifest.name}`);
    console.log(`Output: ${path.join(outputDir, 'generated', `${manifest.name}.ts`)}`);
  });
