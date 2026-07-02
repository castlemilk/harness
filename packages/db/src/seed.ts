import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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
      update: {},
      create: {
        name: 'kimi',
        kind: 'kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: 'moonshot-v1-8k',
        capabilities: JSON.stringify([{ name: 'moonshot-v1-8k', level: 'advanced' }]),
      },
    });
    console.log('Seeded Kimi provider.');
  }

  console.log('Seeded default providers.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
