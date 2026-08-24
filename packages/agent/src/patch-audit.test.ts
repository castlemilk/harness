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
        specgateThrowawayPaths: ['tests/value.omega_specgate.test.ts'],
        gradedPatchTestPaths: 2,
      },
    });
  });

  it('bounds persisted stripped paths without losing the authoritative count', async () => {
    const prisma = {
      agentRun: { findUnique: vi.fn().mockResolvedValue({ validationSummary: null }) },
    } as unknown as PrismaClient;
    const paths = Array.from(
      { length: 501 },
      (_, index) => `tests/test_omega_specgate_${String(index).padStart(3, '0')}.py`,
    );

    const encoded = await validationSummaryWithPatchAudit(prisma, 'run-2', {
      specGatePathsRemoved: paths,
      gradedPatchTestPaths: [],
    });
    const parsed = JSON.parse(encoded ?? '{}') as {
      patchAudit?: { specgateThrowawayPathsRemoved?: number; specgateThrowawayPaths?: string[] };
    };

    expect(parsed.patchAudit?.specgateThrowawayPathsRemoved).toBe(501);
    expect(parsed.patchAudit?.specgateThrowawayPaths).toEqual(paths.slice(0, 500));
  });
});
