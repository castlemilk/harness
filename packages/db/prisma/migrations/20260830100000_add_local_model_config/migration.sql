CREATE TABLE "LocalModelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:11435',
    "model" TEXT NOT NULL,
    "cacheMode" TEXT NOT NULL DEFAULT 'cold',
    "warmupRuns" INTEGER NOT NULL DEFAULT 0,
    "contextTokens" INTEGER,
    "keepAlive" TEXT NOT NULL DEFAULT '30m',
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tokenHorizonUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:8765',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "LocalModelConfig_name_key" ON "LocalModelConfig"("name");
