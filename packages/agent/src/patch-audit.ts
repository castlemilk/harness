import { createHash } from 'node:crypto';
import type { PrismaClient } from '@omega/db';
import type { GradedDiffResult } from './git.js';
import { sanitizeForDb } from './utils.js';

export interface PatchAuditSummary {
  gradedPatchTestPaths: number;
  gradedPatchAddedTestPaths: number;
  gradedPatchAddedTestPathList: string[];
  gradedPatchSha256: string;
}

const MAX_PERSISTED_PATCH_AUDIT_PATHS = 500;

export async function validationSummaryWithPatchAudit(
  prisma: PrismaClient,
  agentRunId: string,
  audit: Pick<GradedDiffResult, 'output' | 'gradedPatchTestPaths' | 'gradedPatchAddedTestPaths'>,
): Promise<string | undefined> {
  if (audit.gradedPatchTestPaths.length === 0 && audit.gradedPatchAddedTestPaths.length === 0) {
    return undefined;
  }
  let existing: Record<string, unknown> = {};
  try {
    const row = await prisma.agentRun.findUnique({
      where: { id: agentRunId },
      select: { validationSummary: true },
    });
    if (row?.validationSummary) {
      const parsed = JSON.parse(row.validationSummary) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Patch capture must remain terminal even if optional audit enrichment fails.
  }
  return sanitizeForDb(JSON.stringify({
    ...existing,
    patchAudit: {
      ...(existing.patchAudit !== null && typeof existing.patchAudit === 'object' && !Array.isArray(existing.patchAudit)
        ? existing.patchAudit as Record<string, unknown>
        : {}),
      gradedPatchTestPaths: audit.gradedPatchTestPaths.length,
      gradedPatchAddedTestPaths: audit.gradedPatchAddedTestPaths.length,
      gradedPatchAddedTestPathList: audit.gradedPatchAddedTestPaths.slice(0, MAX_PERSISTED_PATCH_AUDIT_PATHS),
      gradedPatchSha256: createHash('sha256').update(audit.output).digest('hex'),
    } satisfies PatchAuditSummary,
  })) ?? undefined;
}
