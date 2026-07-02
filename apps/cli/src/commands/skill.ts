import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerSkill } from '@omega/skills';

function getOutputDir(): string {
  if (process.env.OMEGA_HARNESS_ROOT) {
    return path.join(path.resolve(process.env.OMEGA_HARNESS_ROOT), 'packages/skills/src');
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.join(path.resolve(__dirname, '../../../..'), 'packages/skills/src');
  } catch {
    return path.join(process.cwd(), 'harness-skills');
  }
}

export const skillCmd = new Command('skill').description('Manage skill artifacts');

skillCmd
  .command('generate')
  .description('Generate a harness adapter from a SKILL.md file')
  .argument('<source>', 'path to SKILL.md')
  .action(async (source) => {
    const outputDir = getOutputDir();
    const manifest = await registerSkill(path.resolve(source), outputDir);
    console.log(`Generated adapter for skill: ${manifest.name}`);
    console.log(`Output directory: ${path.join(outputDir, 'generated')}`);
  });
