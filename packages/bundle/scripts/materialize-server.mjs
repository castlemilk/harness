#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '../../../..');
const serverDir = path.resolve(root, 'packages/bundle/dist/server');

const workspacePackageNames = new Set([
  '@omega/agent',
  '@omega/core',
  '@omega/db',
  '@omega/providers',
  '@omega/router',
]);

const workspacePackages = [
  { name: '@omega/agent', src: 'packages/agent', extra: ['dist'] },
  { name: '@omega/core', src: 'packages/core', extra: ['dist'] },
  { name: '@omega/db', src: 'packages/db', extra: ['dist', 'generated', 'prisma/migrations'] },
  { name: '@omega/providers', src: 'packages/providers', extra: ['dist'] },
  { name: '@omega/router', src: 'packages/router', extra: ['dist'] },
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function copyDir(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, dereference: true, force: true });
}

async function writeMinimalPackageJson(srcDir, destDir) {
  const pkg = await readJson(path.join(srcDir, 'package.json'));
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

async function resolveExactVersions(deps) {
  const exact = {};
  for (const name of deps) {
    try {
      const pkgPath = path.join(serverDir, 'node_modules', name, 'package.json');
      const pkg = await readJson(pkgPath);
      exact[name] = pkg.version;
    } catch (err) {
      console.warn(`Could not resolve exact version for ${name}: ${err.message}`);
      // Fall back to the range from the source package.
      exact[name] = undefined;
    }
  }
  return exact;
}

async function copyWorkspacePackages() {
  for (const { name, src, extra } of workspacePackages) {
    const srcDir = path.resolve(root, src);
    const destDir = path.resolve(serverDir, 'node_modules', name);

    try {
      const stat = await fs.lstat(destDir);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        await fs.rm(destDir, { recursive: true, force: true });
      } else {
        await fs.unlink(destDir);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    await writeMinimalPackageJson(srcDir, destDir);
    for (const part of extra) {
      const srcPart = path.join(srcDir, part);
      const destPart = path.join(destDir, part);
      try {
        await fs.access(srcPart);
        await copyDir(srcPart, destPart);
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.warn(`  skipping missing ${srcPart}`);
          continue;
        }
        throw err;
      }
    }
    console.log(`copied workspace package ${name}`);
  }
}

async function main() {
  const serverPkg = await readJson(path.resolve(root, 'apps/server/package.json'));

  // Determine external runtime dependencies (everything that is not a workspace package).
  const externalDeps = Object.keys(serverPkg.dependencies ?? {}).filter(
    (dep) => !workspacePackageNames.has(dep)
  );

  // Capture exact installed versions from the pnpm-deployed tree before we wipe node_modules.
  const exactVersions = await resolveExactVersions(externalDeps);
  const externalDepsWithVersions = Object.fromEntries(
    externalDeps.map((dep) => [dep, exactVersions[dep] ?? serverPkg.dependencies[dep]])
  );

  // Wipe the pnpm node_modules tree so npm can create a physical, installable one.
  await fs.rm(path.join(serverDir, 'node_modules'), { recursive: true, force: true });

  // Write a minimal server package.json for npm install.
  const installPkg = {
    name: '@castlemilk/omega-server',
    version: serverPkg.version,
    type: 'module',
    main: './dist/index.js',
    dependencies: externalDepsWithVersions,
  };
  await fs.writeFile(path.join(serverDir, 'package.json'), JSON.stringify(installPkg, null, 2));

  // Install external dependencies physically inside the bundled server.
  console.log('Installing external server dependencies...');
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-package-lock', '--ignore-scripts'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status}`);
  }

  // Copy workspace packages into the server's node_modules.
  await copyWorkspacePackages();

  // Copy proto file for gRPC.
  const protoDest = path.join(serverDir, 'proto', 'tasks.proto');
  await fs.mkdir(path.dirname(protoDest), { recursive: true });
  await fs.copyFile(path.resolve(root, 'proto/tasks.proto'), protoDest);

  // Remove any leftover lockfile just in case.
  try {
    await fs.unlink(path.join(serverDir, 'package-lock.json'));
  } catch {
    // ignore
  }

  console.log('Server bundle materialized.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
