/**
 * Shared utility functions for the Omega agent package.
 */

/**
 * Sanitize a string for safe storage in Postgres TEXT columns.
 * Removes NUL bytes and C0 control characters that break Postgres.
 */
export function sanitizeForDb(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code !== 0x00 && !(code >= 0x01 && code <= 0x08) && code !== 0x0b && code !== 0x0c && !(code >= 0x0e && code <= 0x1f);
    })
    .join('');
}
