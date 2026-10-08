# Vault cloud candidate preserving the deployed Ten Kings application

The cloud candidate starts from deployed source `20643deae9b9b341fc7dfcd7fb703c53d0b73d0b`. It adds the frozen Vault cloud source and contracts from `522845af797d3b1899cd24e311c64e73da392a1d`. The larger Vault integration branch starts from a different lineage and must not replace the serving application: it lacks the deployed main-site router, Inventory research and recovery readers, and minute cron.

The existing middleware, site routing, cron, Inventory/catalog code, non-Vault Prisma models, shared domain writers and existing migration bytes remain unchanged. The existing collect host passes through `/admin/vault`, `/vault/support/...` and `/api/vault/v1/...`; no apex route expansion or domain change is required. `@tenkings/vault-contracts` is the only new frontend runtime dependency. Its normal build precedes the application build.

## Migration lineage

Root's read-only October 7 live ledger preflight reports 99 active finished migrations, 13 retained rolled-back rows and no unfinished migration. All 98 migrations in deployed source match. The additional already-applied `20260908010000_speedster_prepared_evidence_authority` matches the frozen source; its unchanged SQL file is included only to retain that ledger lineage. This candidate adds no Speedster runtime admission, models or newly pending Speedster migration.

The eight pending migrations are the Vault cloud domain, review integrity, machine profiles, Stripe observations, Spark observations, Spark recovery finance, supervised recovery and production stage isolation. The source union has 107 migration files. Use the normal reviewed additive deploy path only after the exact 99-to-107 disposable rehearsal, current ledger/checksum and backup checks. Never use schema push/reset or replace existing history. Retain the new additive schema on application rollback.

## Reproducible local checks

Use Node 20, a frozen install and a nonproduction build environment without application credentials. Run Prisma generation, contracts/shared/database builds, `pnpm vault:test-contracts`, `pnpm vault:test-cloud`, and the ordinary `scripts/vercel-build.sh` with `RUN_DB_MIGRATIONS=false`. The normal build does not establish deployed schema readiness.

Cloud tests exercise only cloud-owned behavior. The retained synthetic fixture `frontend/nextjs-app/tests/fixtures/vault-spark-cloud-bindings.json` was projected from the actual frozen provisioning implementation and records its source commit. It is test data, never an installation profile. Cross-component adapter/provisioner/SQLite-machine tests stay in the complete Vault source, where the real machine package is built; this candidate does not substitute mocks for those acceptance claims or introduce a hidden machine-package dependency. Ten cloud profile cases and the seven production callback/inbox cases remain in this standalone suite.

## Local validation evidence

October 7: frozen offline filtered install reused 736 packages with zero downloads. The ordinary production build, including the sharp packaging verifier, passed with migration execution disabled and a dummy unreachable database URL. Contracts: 12/12; standalone cloud: 110/110; database Vault helpers: 9/9. Direct frontend TypeScript checking still reports 12 existing AI-grader/Speedster test diagnostics in unchanged deployed-source files and no Vault diagnostics; their separate cleanup is not included here.

Byte comparisons confirmed that removing the isolated Vault schema block reproduces the deployed schema exactly, that existing middleware/site routing/cron and all 98 original SQL files are identical, and that the nine added SQL files and Vault contracts/server/API source match the frozen reviewed source. The new GitHub workflow repeats the cloud checks, ordinary build and exact disposable 99-to-107 migration rehearsal. The rehearsal received syntax and independent source review locally; actual PostgreSQL execution remains pending remote CI because the local Docker daemon is stopped.

## Deployment boundaries

A READY Preview is a build, not production acceptance. `RUN_DB_MIGRATIONS=true` runs migrations in any Vercel environment; keep it false during ordinary Preview and Production builds. A Preview using the existing database is not inherently read-only: valid machine GET authentication records `lastUsedAt`, authenticated admin writes persist Vault actions, and enabled callbacks persist receipts. Synthetic test harnesses must use their disposable database only.

Stage exact-source Production without automatically assigning domains, verify existing main/staff/collect routes, assets, auth boundaries and the sole research cron, then promote only the reviewed compatible artifact. Do not promote the larger Vault Preview. Keep all existing Inventory settings and scheduler ownership. Callback stages require independent explicit configuration, exact bindings and separate secrets; production acceptance and protected machine activation remain separate external steps. No callback flag or source publication grants acceptance.
