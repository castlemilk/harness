import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { omegaDatabaseDir } from '@omega/core';
import { PrismaClient } from '../generated/client/index.js';

const databaseDir = omegaDatabaseDir();

export const pglite = new PGlite(databaseDir);
const adapter = new PrismaPGlite(pglite);

export const prisma = new PrismaClient({ adapter });
