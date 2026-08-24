import type { PrismaClient } from '@omega/db';
import type { GradedDiffResult } from './git.js';
import { sanitizeForDb } from './utils.js';

export interface PatchAuditSummary {
  specgateThrowawayPathsRemoved: number;
  specgateThrowawayPaths: string[];
  gradedPatchTestPaths: number;
}

const MAX_PERSISTED_PATCH_AUDIT_PATHS = 500;

export async function validationSummaryWithPatchAudit(
  prisma: PrismaClient,
  agentRunId: string,
  audit: Pick<GradedDiffResult, 'specGatePathsRemoved' | 'gradedPatchTestPaths'>,
): Promise<string | undefined> {
  if (audit.specGatePathsRemoved.length === 0 && audit.gradedPatchTestPaths.length === 0) {
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
      specgateThrowawayPathsRemoved: audit.specGatePathsRemoved.length,
      specgateThrowawayPaths: audit.specGatePathsRemoved.slice(0, MAX_PERSISTED_PATCH_AUDIT_PATHS),
      gradedPatchTestPaths: audit.gradedPatchTestPaths.length,
    } satisfies PatchAuditSummary,
  })) ?? undefined;
}
