const READ_ONLY_SHELL_PATTERNS = [
  /^\s*(sed|grep|cat|tail|head|awk|find|ls|wc|dir|more|less|file|stat|which|whereis|printenv)\b/,
  /^\s*git\s+(diff|log|show|branch)\b/,
];

const FILE_READING_SHELL_PATTERNS = [
  /\bnode\s+(?:-[ec]\s+)?[^\n]*\b(?:readFileSync|readFile|fs\.readFile|fs\.readFileSync)\b/,
  /\bpython\d*\s+(?:-[c]\s+)?[^\n]*\bopen\s*\(\s*['"`]/,
  /\bruby\s+(?:-[ec]\s+)?[^\n]*\b(?:File\.read|IO\.read|File\.open)\b/,
  /\bperl\s+(?:-[ec]\s+)?[^\n]*\bopen\s*\(/,
];

export function isReadOnlyShellCommand(command: string): boolean {
  const segments = command.split(/(?:&&|\|\||;)/);
  return segments.every((seg) =>
    READ_ONLY_SHELL_PATTERNS.some((pattern) => pattern.test(seg))
  );
}

export function isFileReadingShellCommand(command: string): boolean {
  return FILE_READING_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}
