import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@omega/db';
import { validationSummaryWithPatchAudit } from './patch-audit.js';

describe('validationSummaryWithPatchAudit', () => {
  it('persists both authoritative path counts while preserving validation data', async () => {
    const prisma = {
      agentRun: {
        findUnique: vi.fn().mockResolvedValue({
          validationSummary: JSON.stringify({ allPassed: true, patchAudit: { old: true } }),
        }),
      },
    } as unknown as PrismaClient;

    const encoded = await validationSummaryWithPatchAudit(prisma, 'run-1', {
      specGatePathsRemoved: ['tests/value.omega_specgate.test.ts'],
      gradedPatchTestPaths: ['tests/quoted path.test.ts', 'pkg/value_test.go'],
    });

    expect(JSON.parse(encoded ?? '{}')).toEqual({
      allPassed: true,
      patchAudit: {
        old: true,
        specgateThrowawayPathsRemoved: 1,
        gradedPatchTestPaths: 2,
      },
    });
  });
});
