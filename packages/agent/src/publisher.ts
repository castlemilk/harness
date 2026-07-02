import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTag, push } from './git.js';

const execFileAsync = promisify(execFile);

export interface PublishResult {
  success: boolean;
  version?: string;
  output: string;
}

function bumpPatch(version: string): string {
  const parts = version.split('.');
  const patch = parseInt(parts[2] ?? '0', 10);
  parts[2] = String(patch + 1);
  return parts.join('.');
}

export async function publishOmega(projectPath: string, versionOverride?: string): Promise<PublishResult> {
  const bundlePackagePath = path.join(projectPath, 'packages/bundle/package.json');
  let bundlePackage: { version: string };
  try {
    const raw = await fs.readFile(bundlePackagePath, 'utf-8');
    bundlePackage = JSON.parse(raw) as { version: string };
  } catch (err) {
    return {
      success: false,
      output: `Could not read packages/bundle/package.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const newVersion = versionOverride ?? bumpPatch(bundlePackage.version);

  try {
    // Update root version to keep things in sync
    const rootPackagePath = path.join(projectPath, 'package.json');
    const rootRaw = await fs.readFile(rootPackagePath, 'utf-8');
    const rootPackage = JSON.parse(rootRaw) as { version?: string };
    rootPackage.version = newVersion;
    await fs.writeFile(rootPackagePath, JSON.stringify(rootPackage, null, 2) + '\n', 'utf-8');

    bundlePackage.version = newVersion;
    await fs.writeFile(bundlePackagePath, JSON.stringify(bundlePackage, null, 2) + '\n', 'utf-8');

    await execFileAsync('pnpm', ['install'], { cwd: projectPath, timeout: 120_000 });
    await execFileAsync('pnpm', ['build'], { cwd: projectPath, timeout: 300_000 });
    await execFileAsync(
      'pnpm',
      ['--filter', '@castlemilk/omega', 'publish', '--no-git-checks'],
      { cwd: projectPath, timeout: 120_000 }
    );

    const tag = `v${newVersion}`;
    const tagResult = await createTag(projectPath, tag, `Release ${newVersion}`);
    if (!tagResult.success) {
      return { success: false, version: newVersion, output: tagResult.output };
    }
    const pushResult = await push(projectPath, 'origin', tag);
    if (!pushResult.success) {
      return { success: false, version: newVersion, output: pushResult.output };
    }

    return { success: true, version: newVersion, output: `Published ${newVersion}` };
  } catch (err) {
    return {
      success: false,
      output: `Publish failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
