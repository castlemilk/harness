-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "textToolsPrompt" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_name_key" ON "PromptVersion"("name");
