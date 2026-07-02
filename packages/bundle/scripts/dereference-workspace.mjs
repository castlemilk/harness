#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '../../../..');
const targetNodeModules = path.resolve(root, 'packages/bundle/dist/server/node_modules');

const workspacePackages = [
  { name: '@omega/agent', src: 'packages/agent', extra: ['dist'] },
  { name: '@omega/core', src: 'packages/core', extra: ['dist'] },
  { name: '@omega/db', src: 'packages/db', extra: ['dist', 'generated', 'prisma/migrations'] },
  { name: '@omega/providers', src: 'packages/providers', extra: ['dist'] },
  { name: '@omega/router', src: 'packages/router', extra: ['dist'] },
];

async function copyDir(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, dereference: true, force: true });
}

async function writeMinimalPackageJson(srcDir, destDir) {
  const raw = await fs.readFile(path.join(srcDir, 'package.json'), 'utf-8');
  const pkg = JSON.parse(raw);
  const minimal = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type ?? 'module',
    main: pkg.main,
    types: pkg.types,
    exports: pkg.exports,
  };
  if (pkg.dependencies) {
    minimal.dependencies = Object.fromEntries(
      Object.entries(pkg.dependencies).map(([k, v]) => [
        k,
        String(v).startsWith('workspace:') ? '*' : v,
      ])
    );
  }
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(path.join(destDir, 'package.json'), JSON.stringify(minimal, null, 2));
}

async function main() {
  for (const { name, src, extra } of workspacePackages) {
    const srcDir = path.resolve(root, src);
    const destDir = path.resolve(targetNodeModules, name);

    // Remove the symlink/file-link pnpm created so we can replace it with real files.
    try {
      const stat = await fs.lstat(destDir);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        await fs.rm(destDir, { recursive: true, force: true });
      } else {
        await fs.unlink(destDir);
      }
    } catch (err) {
      if ((err).code !== 'ENOENT') throw err;
    }

    await writeMinimalPackageJson(srcDir, destDir);
    for (const part of extra) {
      const srcPart = path.join(srcDir, part);
      const destPart = path.join(destDir, part);
      try {
        await fs.access(srcPart);
        await copyDir(srcPart, destPart);
      } catch (err) {
        if ((err).code === 'ENOENT') {
          console.warn(`  skipping missing ${srcPart}`);
          continue;
        }
        throw err;
      }
    }
    console.log(`copied ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
