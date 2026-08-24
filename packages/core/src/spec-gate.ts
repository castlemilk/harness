/** Exact, case-sensitive token reserved for disposable DeepSWE spec-gate tests. */
export const SPEC_GATE_TEST_BASENAME_MARKER = 'omega_specgate';

function normalisePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function isSpecGateTestPath(filePath: string): boolean {
  const basename = normalisePath(filePath).split('/').at(-1) ?? '';
  return basename.includes(SPEC_GATE_TEST_BASENAME_MARKER);
}

export function isTestishPath(filePath: string): boolean {
  const normalised = normalisePath(filePath).toLowerCase();
  const parts = normalised.split('/');
  const basename = parts.at(-1) ?? '';
  if (parts.slice(0, -1).some((part) => ['test', 'tests', '__tests__', 'spec', 'specs'].includes(part))) {
    return true;
  }
  return /^(test_.+|.+_test)(\.[^.]+)+$/.test(basename)
    || /\.(test|spec)(\.[^.]+)+$/.test(basename)
    || /^.+_spec(\.[^.]+)+$/.test(basename);
}
