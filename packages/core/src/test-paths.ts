function normalisePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Heuristic used only for audit/disclosure; it never removes patch content. */
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
