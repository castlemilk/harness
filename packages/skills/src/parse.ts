import matter from 'gray-matter';
import YAML from 'yaml';
import type { SkillArg, SkillManifest } from '@omega/core';

export function parseSkill(md: string): SkillManifest {
  const parsed = matter(md);
  const frontmatter = YAML.parse(parsed.matter || '{}') as Record<string, unknown>;

  if (typeof frontmatter.name !== 'string' || frontmatter.name.trim() === '') {
    throw new Error('SKILL.md frontmatter must include a non-empty "name" string');
  }

  if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '') {
    throw new Error('SKILL.md frontmatter must include a non-empty "description" string');
  }

  let args: SkillArg[] = [];
  if ('args' in frontmatter) {
    if (!Array.isArray(frontmatter.args)) {
      throw new Error('SKILL.md frontmatter "args" must be an array');
    }

    args = frontmatter.args.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`SKILL.md arg at index ${index.toString()} must be an object`);
      }

      const arg = entry as Record<string, unknown>;

      if (typeof arg.name !== 'string' || arg.name.trim() === '') {
        throw new Error(`SKILL.md arg at index ${index.toString()} must have a non-empty "name"`);
      }

      if (typeof arg.type !== 'string' || arg.type.trim() === '') {
        throw new Error(`SKILL.md arg at index ${index.toString()} must have a non-empty "type"`);
      }

      return {
        name: arg.name.trim(),
        type: arg.type.trim(),
        required: typeof arg.required === 'boolean' ? arg.required : true,
        description: typeof arg.description === 'string' ? arg.description : undefined,
      };
    });
  }

  return {
    name: frontmatter.name.trim(),
    description: frontmatter.description.trim(),
    args,
    instructions: parsed.content.trim(),
  };
}
