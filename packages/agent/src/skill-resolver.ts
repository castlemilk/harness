import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { PrismaClient } from '@omega/db';

export interface ResolvedSkill {
  name: string;
  description: string;
  instructions: string;
  sourcePath: string;
}

interface FileSignature {
  languages: Set<string>;
  frameworks: Set<string>;
  hasTests: boolean;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript-react',
  '.js': 'javascript',
  '.jsx': 'javascript-react',
  '.go': 'go',
  '.py': 'python',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
};

const FRAMEWORK_MARKERS: Record<string, string[]> = {
  'typescript-react': ['react'],
  react: ['react', 'jsx'],
  nextjs: ['next'],
  vue: ['vue'],
  svelte: ['svelte'],
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['nestjs'],
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function detectProjectSignature(projectPath: string): Promise<FileSignature> {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  let hasTests = false;

  const entries = await readdir(projectPath).catch(() => []);
  const rootFiles = new Set(entries);

  // Package-level signals.
  if (await exists(join(projectPath, 'package.json'))) {
    const pkg = await readJsonSafe(join(projectPath, 'package.json'));
    const deps = {
      ...((pkg?.dependencies ?? {}) as Record<string, string>),
      ...((pkg?.devDependencies ?? {}) as Record<string, string>),
    };
    if (deps.react) frameworks.add('react');
    if (deps.next) frameworks.add('nextjs');
    if (deps.vue) frameworks.add('vue');
    if (deps.svelte) frameworks.add('svelte');
    if (deps.express) frameworks.add('express');
    if (deps.fastify) frameworks.add('fastify');
    if (deps['@nestjs/core']) frameworks.add('nestjs');
    if (deps.typescript || rootFiles.has('tsconfig.json')) languages.add('typescript');
    if (deps.jest || deps.vitest || deps['@testing-library/react']) hasTests = true;
  }

  if (await exists(join(projectPath, 'go.mod'))) {
    languages.add('go');
    hasTests = true;
  }
  if (await exists(join(projectPath, 'Cargo.toml'))) {
    languages.add('rust');
    hasTests = true;
  }
  if (await exists(join(projectPath, 'pyproject.toml')) || (await exists(join(projectPath, 'requirements.txt')))) {
    languages.add('python');
    hasTests = true;
  }

  // Sample files up to a shallow depth to detect languages without walking node_modules.
  const sampleExts = new Set<string>();
  const maxSamples = 50;
  let samples = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth <= 0 || samples >= maxSamples) return;
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      if (samples >= maxSamples) break;
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.venv'].includes(item.name)) {
          continue;
        }
        await walk(fullPath, depth - 1);
        continue;
      }
      if (item.isFile()) {
        samples++;
        const ext = extname(item.name);
        if (ext) sampleExts.add(ext);
        if (/\.(test|spec)\./.test(item.name) || /tests?\//.test(fullPath)) {
          hasTests = true;
        }
      }
    }
  }

  await walk(projectPath, 2);

  for (const ext of sampleExts) {
    const lang = EXTENSION_LANGUAGE[ext];
    if (lang) {
      languages.add(lang);
      for (const fw of FRAMEWORK_MARKERS[lang] ?? []) frameworks.add(fw);
    }
  }

  return { languages, frameworks, hasTests };
}

function skillMatches(signature: FileSignature, skillName: string, description: string): boolean {
  const haystack = `${skillName} ${description}`.toLowerCase();
  for (const lang of signature.languages) {
    if (haystack.includes(lang.toLowerCase())) return true;
  }
  for (const fw of signature.frameworks) {
    if (haystack.includes(fw.toLowerCase())) return true;
  }
  return false;
}

export async function resolveSkills(
  prisma: PrismaClient,
  projectPath: string,
  taskDescription?: string | null
): Promise<ResolvedSkill[]> {
  const signature = await detectProjectSignature(projectPath);

  // Add task-description hints as synthetic framework/language signals.
  if (taskDescription) {
    const lower = taskDescription.toLowerCase();
    const hintMap: Record<string, string[]> = {
      typescript: ['typescript', 'ts'],
      go: ['go', 'golang'],
      python: ['python', 'py'],
      rust: ['rust'],
      react: ['react'],
      nextjs: ['next.js', 'nextjs'],
      vue: ['vue'],
      svelte: ['svelte'],
      frontend: ['frontend', 'ui', 'component', 'css', 'html'],
    };
    for (const [hint, terms] of Object.entries(hintMap)) {
      if (terms.some((t) => lower.includes(t))) {
        if (['frontend'].includes(hint)) {
          signature.frameworks.add('frontend');
        } else {
          signature.languages.add(hint);
        }
      }
    }
  }

  const artifacts = await prisma.skillArtifact.findMany();
  const matched = artifacts
    .filter((a) => {
      const manifest = JSON.parse(a.manifest) as { name: string; description: string };
      return skillMatches(signature, manifest.name, manifest.description);
    })
    .map((a) => {
      const manifest = JSON.parse(a.manifest) as { name: string; description: string; instructions: string };
      return {
        name: manifest.name,
        description: manifest.description,
        instructions: manifest.instructions,
        sourcePath: a.sourcePath,
      };
    });

  // De-duplicate by name, preserving DB order.
  const seen = new Set<string>();
  return matched.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

export function formatSkillContext(skills: ResolvedSkill[]): string {
  if (skills.length === 0) return '';
  const parts = ['Relevant skills for this project/task:'];
  for (const skill of skills) {
    parts.push(`\n### ${skill.name}\n${skill.description}\n\n${skill.instructions}`);
  }
  return parts.join('\n');
}
