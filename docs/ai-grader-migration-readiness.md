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

Checked local tooling for a disposable DB path:

- `psql` not available
- `pg_isready` not available
- `docker` not available

Because there was no usable local Postgres client/server/container path, the migration was not applied. The only `DATABASE_URL` value supplied during this pass was a dummy localhost URL for `prisma validate`:

`postgresql://<user>:<redacted>@localhost:5432/tenkings_ai_grader_readiness`

That command validates Prisma schema configuration and did not apply migrations.

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

## Findings And Risks

No migration SQL blocker was found by static review.

Observed risk profile:

- The AI Grader migration is additive: it creates new enums, tables, indexes, and foreign keys. It does not drop data, rewrite existing columns, or alter existing enums.
- It is still a large DDL migration. PostgreSQL will take catalog locks while creating types, tables, indexes, and constraints. This should be run during a controlled migration window even though the objects are new.
- Object-name collision remains the primary apply risk. If any target database already contains out-of-band objects with names like `Tenant`, `CaptureSession`, `GradeRun`, `EvidenceArtifact`, or the new enum names, `migrate deploy` would fail.
- Runtime readiness remains gated by table existence. Keep `AI_GRADER_API_ENABLED` disabled until after the migration is applied and verified.
- Because this pass could not execute on a disposable database, relation/index naming and full migration-chain order need one more disposable/staging dry run before production approval.

## Recommended Approval Path

1. Provision a disposable local Postgres database matching the production major version, or a throwaway staging clone with no production credentials exposed to development tooling.
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
