import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillManifest } from '@omega/core';
import { generateAdapter, toClassName } from './generate.js';
import { parseSkill } from './parse.js';

export async function registerSkill(
  sourcePath: string,
  outputDir: string,
): Promise<SkillManifest> {
  const source = await readFile(sourcePath, 'utf-8');
  const manifest = parseSkill(source);

  const generatedDir = join(outputDir, 'generated');
  await mkdir(generatedDir, { recursive: true });

  const className = toClassName(manifest.name);
  const fileName = `${className}.ts`;
  const filePath = join(generatedDir, fileName);

  await writeFile(filePath, generateAdapter(manifest), 'utf-8');

  const indexPath = join(generatedDir, 'index.ts');
  const exportLine = `export * from './${className}.js';\n`;

  let indexContent = '';
  try {
    indexContent = await readFile(indexPath, 'utf-8');
  } catch {
    // Index file does not exist yet.
  }

  if (!indexContent.includes(exportLine)) {
    await writeFile(indexPath, indexContent + exportLine, 'utf-8');
  }

  return manifest;
}
