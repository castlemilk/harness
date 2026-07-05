import type { PrismaClient, PromptVersion } from '../generated/client/index.js';

export interface PromptVersionInput {
  name: string;
  sourcePath: string;
  systemPrompt: string;
  textToolsPrompt: string;
  planningPrompt?: string;
  skillContext?: string;
  hash: string;
  metadata?: Record<string, unknown>;
  benchmarkScore?: number;
}

export function createPromptVersionRepository(prisma: PrismaClient) {
  return {
    async create(input: PromptVersionInput): Promise<PromptVersion> {
      return prisma.promptVersion.create({
        data: {
          name: input.name,
          sourcePath: input.sourcePath,
          systemPrompt: input.systemPrompt,
          textToolsPrompt: input.textToolsPrompt,
          planningPrompt: input.planningPrompt ?? null,
          skillContext: input.skillContext ?? null,
          hash: input.hash,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          benchmarkScore: input.benchmarkScore ?? null,
        },
      });
    },

    async findById(id: string): Promise<PromptVersion | null> {
      return prisma.promptVersion.findUnique({ where: { id } });
    },

    async findByName(name: string): Promise<PromptVersion | null> {
      return prisma.promptVersion.findUnique({ where: { name } });
    },

    async findByHash(hash: string): Promise<PromptVersion | null> {
      return prisma.promptVersion.findFirst({ where: { hash } });
    },

    async list(): Promise<PromptVersion[]> {
      return prisma.promptVersion.findMany({ orderBy: { createdAt: 'desc' } });
    },

    async latest(): Promise<PromptVersion | null> {
      return prisma.promptVersion.findFirst({ orderBy: { createdAt: 'desc' } });
    },

    async updateBenchmarkScore(id: string, score: number): Promise<PromptVersion> {
      return prisma.promptVersion.update({
        where: { id },
        data: { benchmarkScore: score },
      });
    },
  };
}

export type PromptVersionRepository = ReturnType<typeof createPromptVersionRepository>;
