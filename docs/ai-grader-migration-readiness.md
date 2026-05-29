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

## Safety Decision

No production, staging, hosted, or real app database was used.

`process.env.DATABASE_URL` was unset in this shell. The repo contains only example/docker env files with local container-style `postgres` hosts; no real local `.env` with a usable disposable database URL was present.

Checked local tooling for a disposable DB path during the first pass and again while adding the disposable Compose path:

- `psql` not available
- `pg_isready` not available
- `docker` not available

Because there was no usable local Postgres client/server/container path, the migration was not applied. The only `DATABASE_URL` value supplied during that pass was a dummy localhost URL for `prisma validate`:

`postgresql://<user>:<redacted>@localhost:5432/tenkings_ai_grader_readiness`

That command validates Prisma schema configuration and did not apply migrations.

The repo now includes a dedicated disposable Postgres Compose file for the next migration-readiness run:

`docker-compose.ai-grader-migration.yml`

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
- Ran Prisma schema validation with a dummy localhost URL:
  - `DATABASE_URL=postgresql://<user>:<redacted>@localhost:5432/tenkings_ai_grader_readiness pnpm --filter @tenkings/database exec prisma validate --schema prisma/schema.prisma`
  - Result: pass.
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

Local warnings only:

- Node is `v25.6.1`; repo engines expect Node `20.x`.
- Next.js still reports existing `<img>` lint warnings in unrelated admin pages.

## Disposable DB Migration Execution

Not run.

Blocker: no safe disposable local Postgres target was available in this checkout/session. `DATABASE_URL` was unset, and neither local Postgres client tooling nor Docker was present to provision a throwaway database. Running the migration against production or staging is explicitly out of scope for this pass.

Because the migration was not executed, this pass does not prove that the full migration chain applies cleanly on an empty or copied database. It validates the Prisma schema and static migration shape only.

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

No migration SQL blocker was found by static review.

Observed risk profile:

- The AI Grader migration is additive: it creates new enums, tables, indexes, and foreign keys. It does not drop data, rewrite existing columns, or alter existing enums.
- It is still a large DDL migration. PostgreSQL will take catalog locks while creating types, tables, indexes, and constraints. This should be run during a controlled migration window even though the objects are new.
- Object-name collision remains the primary apply risk. If any target database already contains out-of-band objects with names like `Tenant`, `CaptureSession`, `GradeRun`, `EvidenceArtifact`, or the new enum names, `migrate deploy` would fail.
- Runtime readiness remains gated by table existence. Keep `AI_GRADER_API_ENABLED` disabled until after the migration is applied and verified.
- Because this pass could not execute on a disposable database, relation/index naming and full migration-chain order need one more disposable/staging dry run before production approval.

## Recommended Approval Path

1. Run the dedicated disposable Compose path above on a workstation with Docker available, or provision a disposable local Postgres database matching the production major version.
2. Run only against that disposable target:
   - `DATABASE_URL=<disposable-url> pnpm --filter @tenkings/database exec prisma migrate deploy --schema prisma/schema.prisma`
   - `DATABASE_URL=<disposable-url> pnpm --filter @tenkings/database exec prisma migrate status --schema prisma/schema.prisma`
3. Verify AI Grader enums/tables/indexes exist on the disposable target.
4. Keep `AI_GRADER_API_ENABLED` disabled during and after migration verification until the runtime rollout is explicitly approved.
5. For staging/prod:
   - confirm backups and current migration status first
   - run migration through the approved deployment/migration path only
   - set `RUN_DB_MIGRATIONS=true` only in the approved migration window or migration job, never as a persistent default
   - monitor migration logs and database lock/wait metrics
   - confirm Vercel/build logs show the migration ran only when explicitly intended

## Explicit Non-Actions

- No production migration was run.
- No staging migration was run.
- `RUN_DB_MIGRATIONS=true` was not set.
- No manual deploy was run.
- No runtime DB operation was run against a real app database.
