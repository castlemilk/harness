import { createHash } from 'node:crypto';
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

    const patch = 'diff --git a/tests/quoted path.test.ts b/tests/quoted path.test.ts\n';
    const encoded = await validationSummaryWithPatchAudit(prisma, 'run-1', {
      output: patch,
      gradedPatchTestPaths: ['tests/quoted path.test.ts', 'pkg/value_test.go'],
      gradedPatchAddedTestPaths: ['tests/quoted path.test.ts'],
    });

    expect(JSON.parse(encoded ?? '{}')).toEqual({
      allPassed: true,
      patchAudit: {
        old: true,
        gradedPatchTestPaths: 2,
        gradedPatchAddedTestPaths: 1,
        gradedPatchAddedTestPathList: ['tests/quoted path.test.ts'],
        gradedPatchSha256: createHash('sha256').update(patch).digest('hex'),
      },
    });
  });

  it('bounds persisted added-test paths without losing the authoritative count', async () => {
    const prisma = {
      agentRun: { findUnique: vi.fn().mockResolvedValue({ validationSummary: null }) },
    } as unknown as PrismaClient;
    const paths = Array.from(
      { length: 501 },
      (_, index) => `tests/generated_${String(index).padStart(3, '0')}.test.ts`,
    );

    const encoded = await validationSummaryWithPatchAudit(prisma, 'run-2', {
      output: 'large patch',
      gradedPatchTestPaths: [],
      gradedPatchAddedTestPaths: paths,
    });
    const parsed = JSON.parse(encoded ?? '{}') as {
      patchAudit?: { gradedPatchAddedTestPaths?: number; gradedPatchAddedTestPathList?: string[] };
    };

    expect(parsed.patchAudit?.gradedPatchAddedTestPaths).toBe(501);
    expect(parsed.patchAudit?.gradedPatchAddedTestPathList).toEqual(paths.slice(0, 500));
  });
});
