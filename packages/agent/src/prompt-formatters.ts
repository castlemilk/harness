export function xml(tag: string, content: string, attrs?: Record<string, string>): string {
  const attrStr = attrs
    ? ' ' + Object.entries(attrs)
        .map(([k, v]) => `${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
        .join(' ')
    : '';
  return `<${tag}${attrStr}>${content}</${tag}>`;
}

export function xmlIf(tag: string, condition: boolean, content: string): string {
  if (!condition) return '';
  return `<${tag}>${content}</${tag}>`;
}

export function truncateAtTag(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastClose = cut.lastIndexOf('</');
  if (lastClose > maxLen * 0.8) {
    const endBracket = cut.indexOf('>', lastClose);
    if (endBracket !== -1) {
      return cut.slice(0, endBracket + 1) + '\n... [truncated]';
    }
  }
  const spaceAt = cut.lastIndexOf(' ');
  return (spaceAt > maxLen * 0.5 ? cut.slice(0, spaceAt) : cut) + '\n... [truncated]';
}
