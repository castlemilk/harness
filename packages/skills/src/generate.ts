import type { SkillManifest } from '@omega/core';

export function toClassName(name: string): string {
  const normalized = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  let className = normalized || 'Skill';
  if (/^[0-9]/.test(className)) {
    className = `_${className}`;
  }

  return className;
}

export function generateAdapter(manifest: SkillManifest): string {
  const className = toClassName(manifest.name);
  const instructionsLiteral = JSON.stringify(manifest.instructions);
  const descriptionLiteral = JSON.stringify(manifest.description);

  return `import type { Provider } from '@omega/core';

export class ${className} {
  constructor(private readonly provider: Provider) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = ${instructionsLiteral} + '\\n\\nArgs:\\n' + JSON.stringify(args, null, 2);
    return this.provider.send(prompt, { system: ${descriptionLiteral} });
  }
}
`;
}
