# AI Grader Migration Readiness

Date: 2026-05-29

Branch: `feature/ai-grader-migration-readiness`

Base reviewed: `origin/main` at `49c2d3b71a10026b041dbae1e9844463b90d78be`

## Migration Under Review

AI Grader migration:

`packages/database/prisma/migrations/20260528120000_ai_grader_v5_foundation/migration.sql`

The migration is 724 lines and creates the AI Grader v5 foundation schema:

- enums for grading modes, capture sides/kinds, session/run statuses, auth verdicts, evidence/certificate states, rig/calibration metadata, overrides, audit events, and custody events
- AI Grader operational tables including `Tenant`, rig/location/operator/helper/calibration metadata, `CaptureSession`, `CaptureManifest`, `GradingSuspectRegion`, provenance tables, `GradeRun`, `ReplayRun`, `AuthRun`, `CardPrintProfile`, `GradeCertificate`, `EvidenceArtifact`, `CustodyEvent`, `OperatorOverride`, and `AuditEvent`
- indexes/unique constraints for expected tenant, session, artifact, certificate, profile, and audit lookups
- foreign keys among newly introduced AI Grader tables

Readiness run also found and fixed a pre-existing clean-chain migration issue before the AI Grader migration:

`packages/database/prisma/migrations/20260305120000_cvri_storage_key/migration.sql`

This migration adds the current `CardVariantReferenceImage.storageKey` column and index before `20260305143000_variant_program_identity` uses that column while duplicating reference rows.

## Safety Decision

No production, staging, hosted, or real app database was used.

No ambient production or staging `DATABASE_URL` was used. The repo contains only example/docker env files with local container-style `postgres` hosts; no real local `.env` was used for this pass.

The first pass had no usable local Docker/Postgres tooling. After Docker Desktop was installed, the live validation pass used only the dedicated disposable Compose target:

- `docker --version` -> Docker version `29.5.2`
- `docker compose version` -> Docker Compose version `v5.1.3`
- compose file: `docker-compose.ai-grader-migration.yml`
- local host/port: `127.0.0.1:55432`
- database: `tenkings_ai_grader_readiness`
- user: `tenkings_readiness`
- storage: tmpfs-backed Postgres data directory, discarded on teardown

Disposable URL, with password redacted:

`postgresql://tenkings_readiness:<redacted>@127.0.0.1:55432/tenkings_ai_grader_readiness?schema=public`

This URL is local-only and does not reference production, staging, hosted, or shared app databases.

Safety properties:

- local Docker only
- loopback-only host binding: `127.0.0.1:55432`
- throwaway database: `tenkings_ai_grader_readiness`
- throwaway user: `tenkings_readiness`
- no shared app database name
- no production, staging, hosted, or external URL
- tmpfs-backed Postgres data directory, discarded when the container stops

## Validation Performed

- Identified AI Grader migration in `packages/database/prisma/migrations/20260528120000_ai_grader_v5_foundation/migration.sql`.
- Started disposable Postgres with `docker-compose.ai-grader-migration.yml`.
- Confirmed disposable Postgres was healthy and accepting connections.
- Ran Prisma schema validation with the disposable localhost URL:
  - `DATABASE_URL=postgresql://tenkings_readiness:<redacted>@127.0.0.1:55432/tenkings_ai_grader_readiness?schema=public pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
- Ran `prisma migrate deploy` against the disposable database.
- Ran `prisma migrate status` against the disposable database.
- Verified representative AI Grader enums and tables through container `psql`.
- Ran static SQL review for destructive or rewrite operations:
  - no `DROP`
  - no `ALTER TYPE`
  - no `ALTER TABLE ... DROP`
  - no `ALTER TABLE ... ALTER COLUMN`
  - no `CREATE INDEX CONCURRENTLY`, which is acceptable here because indexes are created on newly created tables
- Ran local package validation:
  - `pnpm --filter @tenkings/database build` -> pass.
  - `pnpm --filter @tenkings/database test` -> pass, 36 tests.
  - `pnpm --filter @tenkings/shared test` -> pass, 105 tests.
  - `pnpm --filter @tenkings/nextjs-app build` -> pass.
- Ran `git diff --check` -> pass.
- Tore down the disposable Postgres container and tmpfs-backed data with `docker compose -f docker-compose.ai-grader-migration.yml down -v`.

Local warnings only:

- Node is `v25.6.1`; repo engines expect Node `20.x`.
- Next.js still reports existing `<img>` lint warnings in unrelated admin pages.

## Disposable DB Migration Execution

Run on disposable local Postgres only.

Initial clean-chain result:

- `prisma migrate deploy` reached the disposable database and failed before the AI Grader migration at `20260305143000_variant_program_identity`.
- Error: `P3018`, PostgreSQL `42703`, column `storageKey` of relation `CardVariantReferenceImage` did not exist.
- Direct disposable DB verification showed no AI Grader tables/enums existed after this failure, as expected.

Fix added:

- Added `packages/database/prisma/migrations/20260305120000_cvri_storage_key/migration.sql`.
- The migration is idempotent:
  - `ALTER TABLE "CardVariantReferenceImage" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;`
  - `CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_storageKey_idx" ON "CardVariantReferenceImage" ("storageKey");`
- No already-committed migration file was edited.

Clean rerun result:

- Reset only the disposable DB with `docker compose -f docker-compose.ai-grader-migration.yml down -v`.
- Restarted the same disposable DB.
- `prisma migrate deploy` applied all 67 migrations successfully, including:
  - `20260305120000_cvri_storage_key`
  - `20260528120000_ai_grader_v5_foundation`
- `prisma migrate status` reported: `Database schema is up to date!`
- `_prisma_migrations` confirmed both `20260305120000_cvri_storage_key` and `20260528120000_ai_grader_v5_foundation` finished successfully.

## Disposable DB Command Sequence

Use this sequence only on a workstation with Docker available. It intentionally does not use `.env`, production, staging, hosted, or shared app database URLs.

Safe disposable URL, with non-secret throwaway credentials:

`postgresql://tenkings_readiness:<redacted>@127.0.0.1:55432/tenkings_ai_grader_readiness?schema=public`

Commands:

```sh
docker compose -f docker-compose.ai-grader-migration.yml up -d

docker compose -f docker-compose.ai-grader-migration.yml exec -T \
  ai-grader-migration-postgres \
  pg_isready -U tenkings_readiness -d tenkings_ai_grader_readiness

DATABASE_URL='postgresql://tenkings_readiness:tenkings_readiness@127.0.0.1:55432/tenkings_ai_grader_readiness?schema=public' \
  pnpm --filter @tenkings/database exec prisma migrate deploy --schema prisma/schema.prisma

DATABASE_URL='postgresql://tenkings_readiness:tenkings_readiness@127.0.0.1:55432/tenkings_ai_grader_readiness?schema=public' \
  pnpm --filter @tenkings/database exec prisma migrate status --schema prisma/schema.prisma

docker compose -f docker-compose.ai-grader-migration.yml exec -T \
  ai-grader-migration-postgres \
  psql -U tenkings_readiness -d tenkings_ai_grader_readiness \
  -c "select typname from pg_type where typname in ('CaptureSessionStatus', 'GradeRunStatus', 'AuthVerdict') order by typname;"

docker compose -f docker-compose.ai-grader-migration.yml exec -T \
  ai-grader-migration-postgres \
  psql -U tenkings_readiness -d tenkings_ai_grader_readiness \
  -c "select tablename from pg_tables where schemaname = 'public' and tablename in ('CaptureSession', 'CaptureManifest', 'GradeRun', 'AuthRun', 'GradeCertificate', 'EvidenceArtifact', 'AuditEvent') order by tablename;"

docker compose -f docker-compose.ai-grader-migration.yml down -v
```

Expected verification result:

- `migrate deploy` applies the full committed Prisma migration chain without drift or failed migration records.
- `migrate status` reports the database schema is up to date.
- The enum query returns the AI Grader enum names.
- The table query returns the AI Grader table names.

If any command fails, keep PR #15 draft and treat the failure as a migration readiness blocker until the failure is understood and fixed.

## Findings And Risks

The AI Grader migration itself applied successfully after the clean-chain `CardVariantReferenceImage.storageKey` gap was fixed.

Readiness finding fixed in this PR:

- Clean databases did not have `CardVariantReferenceImage.storageKey` before `20260305143000_variant_program_identity` referenced it.
- This caused the full migration chain to fail before reaching the AI Grader migration.
- The new `20260305120000_cvri_storage_key` migration repairs that chain gap without editing historical migration SQL.

Observed risk profile:

- The AI Grader migration is additive: it creates new enums, tables, indexes, and foreign keys. It does not drop data, rewrite existing columns, or alter existing enums.
- It is still a large DDL migration. PostgreSQL will take catalog locks while creating types, tables, indexes, and constraints. This should be run during a controlled migration window even though the objects are new.
- Object-name collision remains the primary apply risk. If any target database already contains out-of-band objects with names like `Tenant`, `CaptureSession`, `GradeRun`, `EvidenceArtifact`, or the new enum names, `migrate deploy` would fail.
- Runtime readiness remains gated by table existence. Keep `AI_GRADER_API_ENABLED` disabled until after the migration is applied and verified.
- Production/staging may already have `CardVariantReferenceImage.storageKey`; if so, `20260305120000_cvri_storage_key` should be a no-op because it uses `IF NOT EXISTS`. If the column is absent, it adds the nullable column and index before AI Grader migration approval.

## Verification Queries

AI Grader enum verification:

```text
       typname
----------------------
 AuthVerdict
 CaptureSessionStatus
 GradeRunStatus
(3 rows)
```

AI Grader table verification:

```text
    tablename
------------------
 AuditEvent
 AuthRun
 CaptureManifest
 CaptureSession
 EvidenceArtifact
 GradeCertificate
 GradeRun
(7 rows)
```

## Recommended Approval Path

1. Keep `AI_GRADER_API_ENABLED` disabled during and after migration execution until the runtime rollout is explicitly approved.
2. For staging/prod:
   - confirm backups and current migration status first
   - run migration through the approved deployment/migration path only
   - set `RUN_DB_MIGRATIONS=true` only in the approved migration window or migration job, never as a persistent default
   - monitor migration logs and database lock/wait metrics
   - confirm Vercel/build logs show the migration ran only when explicitly intended
3. After migration execution, verify:
   - `prisma migrate status` reports the database schema is up to date
   - `20260305120000_cvri_storage_key` is marked finished
   - `20260528120000_ai_grader_v5_foundation` is marked finished
   - representative AI Grader tables/enums exist

## Explicit Non-Actions

- No production migration was run.
- No staging migration was run.
- `RUN_DB_MIGRATIONS=true` was not set.
- No manual deploy was run.
- No runtime DB operation was run against a real app database.
- Only the disposable local database at `127.0.0.1:55432/tenkings_ai_grader_readiness` was migrated and queried.
