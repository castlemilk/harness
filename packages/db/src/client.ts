import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';

const databaseDir = process.env.DATABASE_DIR ?? './pglite-data';

export const pglite = new PGlite(databaseDir);
const adapter = new PrismaPGlite(pglite);

export const prisma = new PrismaClient({ adapter });
