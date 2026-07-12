-- Reconcile User scalar columns that were introduced in larger feature
-- migrations but are absent in environments whose schema was historically
-- managed outside Prisma's migration ledger.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

COMMIT;
