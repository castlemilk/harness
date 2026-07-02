import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pglite as sharedPglite } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function applyMigrations(databaseDir?: string): Promise<void> {
  const ownInstance = databaseDir !== undefined;
  const pglite = ownInstance ? new PGlite(databaseDir) : sharedPglite;

  try {
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS "_Migration" (
        "id" TEXT PRIMARY KEY,
        "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedResult = await pglite.query<{ id: string }>(
      'SELECT "id" FROM "_Migration" ORDER BY "id" ASC'
    );
    const applied = new Set(appliedResult.rows.map((r) => r.id));

    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries
      .filter((e) => e.isDirectory() && e.name !== 'migration_lock.toml')
      .map((e) => e.name)
      .sort();

    for (const dir of migrationDirs) {
      if (applied.has(dir)) continue;

      const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
      try {
        const sql = await fs.readFile(sqlPath, 'utf-8');
        await pglite.exec(sql);
        await pglite.query('INSERT INTO "_Migration" ("id") VALUES ($1)', [dir]);
        console.log(`Applied migration: ${dir}`);
      } catch (err) {
        // Ignore missing migration.sql (e.g. lock-only migrations)
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  } finally {
    if (ownInstance) {
      await pglite.close();
    }
  }
}

async function main(): Promise<void> {
  await applyMigrations();
  console.log('Migrations applied.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
