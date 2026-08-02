CREATE TABLE "AiGraderV2LearningBank" (
    "id" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderV2LearningBank_pkey" PRIMARY KEY ("id")
);
