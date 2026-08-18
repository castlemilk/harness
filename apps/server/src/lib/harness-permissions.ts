import { safeJsonParse } from './utils.js';

/**
 * A single entry in `Harness.permissions` — the JSON column that says what a
 * harness is allowed to do. `granted` is standing authority; `needsApproval`
 * says a human must sign off on each individual use.
 */
export interface HarnessPermission {
  id: string;
  label: string;
  granted: boolean;
  needsApproval: boolean;
}

/**
 * Parse the column defensively. Anything that is not a well-formed entry is
 * dropped rather than coerced: a malformed permission must never read as a
 * granted one.
 */
export function parsePermissions(value: string | null | undefined): HarnessPermission[] {
  const parsed = safeJsonParse<unknown>(value ?? '[]', []);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return [];
    return [{
      id: row.id,
      label: row.label,
      granted: row.granted === true,
      needsApproval: row.needsApproval === true,
    }];
  });
}
