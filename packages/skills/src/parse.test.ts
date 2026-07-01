import { describe, expect, it } from 'vitest';
import { parseSkill } from './parse.js';

describe('parseSkill', () => {
  it('parses frontmatter and body into a SkillManifest', () => {
    const md = `---
name: summarize
description: Summarize text
args:
  - name: text
    type: string
    required: true
---
Summarize the following text concisely.
`;

    const manifest = parseSkill(md);

    expect(manifest.name).toBe('summarize');
    expect(manifest.description).toBe('Summarize text');
    expect(manifest.args).toEqual([
      { name: 'text', type: 'string', required: true },
    ]);
    expect(manifest.instructions).toBe('Summarize the following text concisely.');
  });

  it('defaults args to an empty array when omitted', () => {
    const md = `---
name: greet
description: Greet the user
---
Say hello.
`;

    const manifest = parseSkill(md);

    expect(manifest.args).toEqual([]);
  });

  it('throws when name is missing', () => {
    const md = `---
description: Missing name
---
Do something.
`;

    expect(() => parseSkill(md)).toThrow('name');
  });

  it('throws when description is missing', () => {
    const md = `---
name: no-desc
---
Do something.
`;

    expect(() => parseSkill(md)).toThrow('description');
  });
});
