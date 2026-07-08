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
        defaultModel: 'moonshot-v1-32k',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'moonshot-v1-32k', level: 'advanced', supportsTools: true },
          { name: 'moonshot-v1-128k', level: 'advanced', supportsTools: true },
          { name: 'moonshot-v1-8k', level: 'capable', supportsTools: true },
        ]),
      },
      create: {
        name: 'kimi',
        kind: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'moonshot-v1-32k',
        enabled: true,
        capabilities: JSON.stringify([
          { name: 'moonshot-v1-32k', level: 'advanced', supportsTools: true },
          { name: 'moonshot-v1-128k', level: 'advanced', supportsTools: true },
          { name: 'moonshot-v1-8k', level: 'capable', supportsTools: true },
        ]),
      },
    });
    console.log('Seeded Kimi provider.');
  }
  // Disable Kimi if OMEGA_DISABLE_KIMI is set (quota exhausted etc.)
  if (process.env.OMEGA_DISABLE_KIMI) {
    await prisma.providerConfig.update({
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
