-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('PHONE', 'SMS', 'CHAT', 'EMAIL', 'VOICE');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'AGENT', 'HUMAN');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'FRUSTRATED');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'RESPONDED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('AI_INFERRED', 'HUMAN_ADDED');

-- CreateTable
CREATE TABLE "SupportCustomer" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "preferredLang" TEXT DEFAULT 'en',
    "notes" JSONB,
    "linkedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT,
    "transcript" TEXT,
    "agentId" TEXT,
    "locationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentiment" "Sentiment",

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "source" "NoteSource" NOT NULL DEFAULT 'AI_INFERRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportFAQ" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportFAQ_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportCustomer_phone_key" ON "SupportCustomer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCustomer_email_key" ON "SupportCustomer"("email");

-- CreateIndex
CREATE INDEX "SupportCustomer_linkedUserId_idx" ON "SupportCustomer"("linkedUserId");

-- CreateIndex
CREATE INDEX "SupportCustomer_createdAt_idx" ON "SupportCustomer"("createdAt");

-- CreateIndex
CREATE INDEX "SupportCustomer_updatedAt_idx" ON "SupportCustomer"("updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_customerId_startedAt_idx" ON "Conversation"("customerId", "startedAt");

-- CreateIndex
CREATE INDEX "Conversation_locationId_startedAt_idx" ON "Conversation"("locationId", "startedAt");

-- CreateIndex
CREATE INDEX "Conversation_status_startedAt_idx" ON "Conversation"("status", "startedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_timestamp_idx" ON "Message"("conversationId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_conversationId_key" ON "Escalation"("conversationId");

-- CreateIndex
CREATE INDEX "Escalation_status_triggeredAt_idx" ON "Escalation"("status", "triggeredAt");

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportFAQ_isActive_category_idx" ON "SupportFAQ"("isActive", "category");

-- AddForeignKey
ALTER TABLE "SupportCustomer" ADD CONSTRAINT "SupportCustomer_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SupportCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SupportCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
