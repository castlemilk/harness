import { prisma, pglite } from './client.js';

export async function seedDefaults(): Promise<void> {
  await prisma.providerConfig.upsert({
    where: { name: 'ollama-local' },
    update: {},
    create: {
      name: 'ollama-local',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3',
      capabilities: JSON.stringify([{ name: 'llama3', level: 'capable' }]),
    },
  });

  if (process.env.KIMI_API_KEY) {
    await prisma.providerConfig.upsert({
      where: { name: 'kimi' },
      update: {
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'k3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'k3', level: 'advanced', supportsTools: true },
          { name: 'k3-256k', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'kimi',
        kind: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'k3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'k3', level: 'advanced', supportsTools: true },
          { name: 'k3-256k', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log('Seeded Kimi provider.');
  }
  // Disable Kimi if OMEGA_DISABLE_KIMI is set (quota exhausted etc.)
  if (process.env.OMEGA_DISABLE_KIMI) {
    await prisma.providerConfig.updateMany({
      where: { name: 'kimi' },
      data: { enabled: false },
    });
    console.log('Kimi provider disabled (OMEGA_DISABLE_KIMI).');
  }

  // GLM (z.ai) coding plan — OpenAI-compatible. Key format: <id>.<secret>.
  if (process.env.GLM_API_KEY) {
    await prisma.providerConfig.upsert({
      where: { name: 'glm' },
      update: {
        apiKey: process.env.GLM_API_KEY,
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        defaultModel: 'glm-5.2',
        capabilities: JSON.stringify([
          { name: 'glm-5.2', level: 'advanced', supportsTools: true },
          { name: 'glm-4.6', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'glm',
        kind: 'generic',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        apiKey: process.env.GLM_API_KEY,
        defaultModel: 'glm-5.2',
        capabilities: JSON.stringify([
          { name: 'glm-5.2', level: 'advanced', supportsTools: true },
          { name: 'glm-4.6', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log('Seeded GLM provider.');
  }

  // MiniMax-M3 — OpenAI-compatible. Endpoint and key provided by env.
  if (process.env.MINIMAX_API_KEY) {
    const baseUrl = process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.chat/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'minimax' },
      update: {
        apiKey: process.env.MINIMAX_API_KEY,
        baseUrl,
        defaultModel: 'MiniMax-M3',
        capabilities: JSON.stringify([
          { name: 'MiniMax-M3', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'minimax',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.MINIMAX_API_KEY,
        defaultModel: 'MiniMax-M3',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'MiniMax-M3', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded MiniMax provider (${baseUrl}).`);
  }

  // DeepSeek V4 — OpenAI-compatible.
  if (process.env.DEEPSEEK_API_KEY) {
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'deepseek' },
      update: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl,
        defaultModel: 'deepseek-v4-flash',
        capabilities: JSON.stringify([
          { name: 'deepseek-v4-pro', level: 'advanced', supportsTools: true, thinking: true, reasoningEffort: 'high' },
          { name: 'deepseek-v4-flash', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'deepseek',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.DEEPSEEK_API_KEY,
        defaultModel: 'deepseek-v4-flash',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'deepseek-v4-pro', level: 'advanced', supportsTools: true, thinking: true, reasoningEffort: 'high' },
          { name: 'deepseek-v4-flash', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded DeepSeek provider (${baseUrl}).`);
  }

  // Qwen (Alibaba Cloud Model Studio token-plan, ap-southeast-1).
  // OpenAI-compatible endpoint at .../compatible-mode/v1. Exposes the
  // latest Qwen3.x family plus glm-5.2 and deepseek-v4-pro as alternates.
  if (process.env.QWEN_API_KEY) {
    const baseUrl =
      process.env.QWEN_BASE_URL ?? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    await prisma.providerConfig.upsert({
      where: { name: 'qwen' },
      update: {
        apiKey: process.env.QWEN_API_KEY,
        baseUrl,
        defaultModel: 'qwen3.8-max-preview',
        capabilities: JSON.stringify([
          { name: 'qwen3.8-max-preview', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-max', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-plus', level: 'advanced', supportsTools: true },
          { name: 'qwen3.6-flash', level: 'advanced', supportsTools: true },
        ]),
      },
      create: {
        name: 'qwen',
        kind: 'generic',
        baseUrl,
        apiKey: process.env.QWEN_API_KEY,
        defaultModel: 'qwen3.8-max-preview',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'qwen3.8-max-preview', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-max', level: 'advanced', supportsTools: true },
          { name: 'qwen3.7-plus', level: 'advanced', supportsTools: true },
          { name: 'qwen3.6-flash', level: 'advanced', supportsTools: true },
        ]),
      },
    });
    console.log(`Seeded Qwen provider (${baseUrl}).`);
  }

  console.log('Seeded default providers.');
}

async function main(): Promise<void> {
  await seedDefaults();
  await prisma.$disconnect();
  await pglite.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
