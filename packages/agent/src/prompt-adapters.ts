import type { ProviderKind } from '@omega/core';

export type PromptFormat = 'xml' | 'markdown';

export interface AdaptedPrompts {
  systemPrompt: string;
  textToolsPrompt: string;
  format: PromptFormat;
}

interface ModelProfile {
  format: PromptFormat;
  strip: string[];
}

// Which PROMPT_* sections to strip per provider kind. Weak/small-context models
// get shorter prompts so their attention budget is spent on the workflow, tool
// rules, and budget constraints rather than long-form prose.
const MODEL_PROFILES: Record<ProviderKind, ModelProfile> = {
  anthropic: { format: 'xml', strip: [] },
  openai: { format: 'xml', strip: [] },
  generic: { format: 'xml', strip: ['PROMPT_TYPE', 'PROMPT_IMPLEMENTATION'] },
  gemini: { format: 'markdown', strip: ['PROMPT_TYPE', 'PROMPT_IMPLEMENTATION'] },
  kimi: { format: 'xml', strip: ['PROMPT_TYPE', 'PROMPT_IMPLEMENTATION'] },
  ollama: { format: 'markdown', strip: ['PROMPT_TYPE', 'PROMPT_IMPLEMENTATION', 'PROMPT_FORBIDDEN', 'PROMPT_SKILLS', 'PROMPT_BUDGET'] },
};

// Models that share the same provider kind but have distinct prompt needs,
// matched on the model identifier.
const MODEL_NAME_PROFILES: { pattern: RegExp; profile: ModelProfile }[] = [
  {
    pattern: /deepseek|qwen/i,
    profile: { format: 'xml', strip: ['PROMPT_TYPE', 'PROMPT_IMPLEMENTATION', 'PROMPT_FORBIDDEN'] },
  },
];

const SECTION_TAGS: Record<string, string> = {
  PROMPT_ROLE: 'role',
  PROMPT_SKILLS: 'skills',
  PROMPT_WORKFLOW: 'workflow',
  PROMPT_TOOL_RULES: 'tool-rules',
  PROMPT_FORBIDDEN: 'forbidden-patterns',
  PROMPT_BUDGET: 'budget-rules',
  PROMPT_TYPE: 'type-discipline',
  PROMPT_IMPLEMENTATION: 'implementation-rules',
};

function stripSections(prompt: string, sections: string[]): string {
  let result = prompt;
  for (const section of sections) {
    const tag = SECTION_TAGS[section];
    if (!tag) continue;
    const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>\\s*`, 'g');
    result = result.replace(re, '');
  }
  return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const MARKDOWN_MAP: Partial<Record<string, { header: string; style: 'text' | 'list' | 'ordered' }>> = {
  role: { header: 'Role', style: 'text' },
  skills: { header: 'Skills', style: 'text' },
  workflow: { header: 'Workflow', style: 'ordered' },
  'tool-rules': { header: 'Tool Rules', style: 'list' },
  'forbidden-patterns': { header: 'Forbidden Patterns', style: 'list' },
  'budget-rules': { header: 'Budget Rules', style: 'list' },
  'type-discipline': { header: 'TypeScript Discipline', style: 'text' },
  'implementation-rules': { header: 'Implementation Rules', style: 'list' },
  'project-context': { header: 'Project Context', style: 'text' },
  format: { header: 'Response Format', style: 'text' },
};

const CHILD_TAGS = /<step[^>]*>([\s\S]*?)<\/step>|<rule[^>]*>([\s\S]*?)<\/rule>|<pattern[^>]*>([\s\S]*?)<\/pattern>/g;

function xmlToMarkdown(xmlText: string): string {
  const lines: string[] = [];
  const sectionRe = /<([a-z-]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(xmlText)) !== null) {
    const tag = m[1];
    const content = m[2];
    const map = MARKDOWN_MAP[tag];
    if (!map) {
      const inner = content.trim();
      if (inner) lines.push(inner);
      continue;
    }
    lines.push(`# ${map.header}`);
    if (map.style === 'ordered') {
      const steps = [...content.matchAll(/<step[^>]*>([\s\S]*?)<\/step>/g)].map((x) => x[1].trim());
      steps.forEach((s, i) => lines.push(`${String(i + 1)}. ${s}`));
    } else if (map.style === 'list') {
      const items = [...content.matchAll(CHILD_TAGS)]
        .map((x) => x.slice(1).find(Boolean) ?? '')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      items.forEach((s) => lines.push(`- ${s}`));
    } else {
      lines.push(content.trim());
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function adaptPrompts(systemPrompt: string, textToolsPrompt: string, kind: ProviderKind, model?: string): AdaptedPrompts {
  const modelMatch = MODEL_NAME_PROFILES.find((p) => model !== undefined && p.pattern.test(model));
  const profile = modelMatch?.profile ?? MODEL_PROFILES[kind];
  let adaptedSystem = systemPrompt;
  let adaptedTextTools = textToolsPrompt;

  if (profile.strip.length > 0) {
    adaptedSystem = stripSections(adaptedSystem, profile.strip);
    adaptedTextTools = stripSections(adaptedTextTools, profile.strip);
  }

  if (profile.format === 'markdown') {
    adaptedSystem = xmlToMarkdown(adaptedSystem);
    adaptedTextTools = xmlToMarkdown(adaptedTextTools);
  }

  return { systemPrompt: adaptedSystem, textToolsPrompt: adaptedTextTools, format: profile.format };
}
