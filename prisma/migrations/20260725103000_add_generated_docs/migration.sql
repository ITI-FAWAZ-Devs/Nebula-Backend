-- CreateEnum
CREATE TYPE "doc_status" AS ENUM ('PENDING', 'RETRIEVING', 'GENERATING', 'VERIFYING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "generated_docs" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "doc_status" NOT NULL DEFAULT 'PENDING',
    "commitSha" TEXT,
    "triggeredByUserId" TEXT,
    "model" TEXT NOT NULL,
    "verificationScore" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_sections" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "contentMd" TEXT NOT NULL,
    "sourceFiles" TEXT[],
    "diagramMermaid" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_docs_repositoryId_status_idx" ON "generated_docs"("repositoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "generated_docs_repositoryId_version_key" ON "generated_docs"("repositoryId", "version");

-- CreateIndex
CREATE INDEX "doc_sections_docId_order_idx" ON "doc_sections"("docId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "doc_sections_docId_key_key" ON "doc_sections"("docId", "key");

-- AddForeignKey
ALTER TABLE "generated_docs" ADD CONSTRAINT "generated_docs_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_sections" ADD CONSTRAINT "doc_sections_docId_fkey" FOREIGN KEY ("docId") REFERENCES "generated_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
