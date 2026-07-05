import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AGENT_SYSTEM_PROMPT, TEXT_TOOLS_SYSTEM_PROMPT } from './prompts.js';
import { PLAN_PROMPT } from './planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = path.resolve(__dirname, '..', 'src', 'prompts.ts');
const PLANNER_PATH = path.resolve(__dirname, '..', 'src', 'planner.ts');

export interface PromptVersionInput {
  name: string;
  sourcePath: string;
  systemPrompt: string;
  textToolsPrompt: string;
  planningPrompt?: string;
  skillContext?: string;
  hash: string;
  metadata?: Record<string, unknown>;
}

function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function hashPrompts(input: {
  systemPrompt: string;
  textToolsPrompt: string;
  planningPrompt?: string;
  skillContext?: string;
}): string {
  return hashString(
    [
      input.systemPrompt,
      input.textToolsPrompt,
      input.planningPrompt ?? '',
      input.skillContext ?? '',
    ].join('\n---\n')
  );
}

export async function readPromptsSource(): Promise<{ systemPrompt: string; textToolsPrompt: string }> {
  try {
    const source = await fs.readFile(PROMPTS_PATH, 'utf-8');

    const systemMatch = /export const AGENT_SYSTEM_PROMPT =\s*(?:loadPromptFromEnv\('OMEGA_SYSTEM_PROMPT'\) \?\?\s*)?`([\s\S]*?)`;/m.exec(source);
    const textToolsMatch = /export const TEXT_TOOLS_SYSTEM_PROMPT =\s*(?:loadPromptFromEnv\('OMEGA_TEXT_TOOLS_PROMPT'\) \?\?\s*)?`([\s\S]*?)`;/m.exec(source);

    return {
      systemPrompt: systemMatch?.[1] ?? AGENT_SYSTEM_PROMPT,
      textToolsPrompt: textToolsMatch?.[1] ?? TEXT_TOOLS_SYSTEM_PROMPT,
    };
  } catch {
    return { systemPrompt: AGENT_SYSTEM_PROMPT, textToolsPrompt: TEXT_TOOLS_SYSTEM_PROMPT };
  }
}

export async function loadCurrentPrompts(skillContext?: string): Promise<PromptVersionInput> {
  const { systemPrompt, textToolsPrompt } = await readPromptsSource();
  let planningPrompt: string | undefined;
  try {
    const plannerSource = await fs.readFile(PLANNER_PATH, 'utf-8');
    const planningMatch = /const PLAN_PROMPT = `([\s\S]*?)`;/m.exec(plannerSource);
    planningPrompt = planningMatch?.[1];
  } catch {
    planningPrompt = PLAN_PROMPT;
  }

  return {
    name: `auto-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    sourcePath: PROMPTS_PATH,
    systemPrompt,
    textToolsPrompt,
    planningPrompt,
    skillContext,
    hash: hashPrompts({ systemPrompt, textToolsPrompt, planningPrompt, skillContext }),
  };
}

export async function saveCurrentPrompts(input: Pick<PromptVersionInput, 'systemPrompt' | 'textToolsPrompt'>): Promise<void> {
  const source = await fs.readFile(PROMPTS_PATH, 'utf-8');

  const replaceConst = (name: string, value: string): string => {
    const pattern = new RegExp(`export const ${name} =\\s*(?:loadPromptFromEnv\\('OMEGA_[A-Z_]+_PROMPT'\\) \\?\\?\\s*)?\`[\\s\\S]*?\`;`, 'm');
    return source.replace(
      pattern,
      `export const ${name} =\n  loadPromptFromEnv('OMEGA_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}_PROMPT') ??\n  \`${value}\`;`
    );
  };

  let updated = replaceConst('AGENT_SYSTEM_PROMPT', input.systemPrompt);
  updated = replaceConst('TEXT_TOOLS_SYSTEM_PROMPT', input.textToolsPrompt);

  await fs.writeFile(PROMPTS_PATH, updated, 'utf-8');
}

export function envForPrompts(input: Pick<PromptVersionInput, 'systemPrompt' | 'textToolsPrompt'>): Record<string, string> {
  return {
    OMEGA_SYSTEM_PROMPT: input.systemPrompt,
    OMEGA_TEXT_TOOLS_PROMPT: input.textToolsPrompt,
  };
}
