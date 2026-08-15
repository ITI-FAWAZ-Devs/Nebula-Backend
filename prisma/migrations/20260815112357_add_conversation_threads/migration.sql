-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_threads_repositoryId_userId_idx" ON "conversation_threads"("repositoryId", "userId");

-- CreateIndex
CREATE INDEX "conversation_messages_threadId_idx" ON "conversation_messages"("threadId");

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
