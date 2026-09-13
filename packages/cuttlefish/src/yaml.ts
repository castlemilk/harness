/**
 * Small YAML emitter for cuttlefish workflow documents.
 *
 * Cuttlefish accepts JSON as YAML, but generated workflows are frequently read
 * by humans in the cuttlefish editor, so we render block YAML. The emitter
 * covers the subset the translator produces (plain scalars, nested maps,
 * arrays of maps, block strings) and falls back to JSON quoting for anything
 * ambiguous.
 */

const BOOL_LIKE = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~']);

function renderScalar(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length === 0) return '""';
    if (/^[A-Za-z0-9_./-]+$/.test(value) && !BOOL_LIKE.has(value.toLowerCase())) return value;
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(value);
}

function renderKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function linesFor(value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const out: string[] = [];
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const [first, ...rest] = linesFor(item, indent + 2);
        out.push(`${pad}- ${first.trimStart()}`);
        out.push(...rest);
      } else {
        out.push(`${pad}- ${renderScalar(item)}`);
      }
    }
    return out;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined
    );
    if (entries.length === 0) return [`${pad}{}`];
    const out: string[] = [];
    for (const [key, v] of entries) {
      const renderedKey = renderKey(key);
      if (typeof v === 'string' && /[\n\r]/.test(v)) {
        out.push(`${pad}${renderedKey}: |-`);
        const body = v.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
        for (const line of body) out.push(`${pad}  ${line}`);
      } else if (v !== null && typeof v === 'object') {
        out.push(`${pad}${renderedKey}:`);
        out.push(...linesFor(v, indent + 2));
      } else {
        out.push(`${pad}${renderedKey}: ${renderScalar(v)}`);
      }
    }
    return out;
  }

  return [`${pad}${renderScalar(value)}`];
}

export function toWorkflowYaml(value: unknown): string {
  return linesFor(value, 0).join('\n') + '\n';
}
