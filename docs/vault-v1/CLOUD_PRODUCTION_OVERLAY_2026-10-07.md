# Vault cloud release preserving the deployed Ten Kings application

The compatible cloud release is deployed at `acd8ec0d00fea378480323378ae6ee55c1c31a35` / `dpl_C1gCMQ1zM4tiM5nuWDm8vRUK4TQZ`, build `_UT54uO0w0DIRShowIaSa`. Ordinary promotion completed October 8 at 05:12:36 UTC; independent API readback at 05:13:59 UTC confirms all five actual aliases, the Production target and the sole enabled Inventory minute cron on this artifact.

The cloud release starts from previously deployed source `20643deae9b9b341fc7dfcd7fb703c53d0b73d0b`. It adds the frozen Vault cloud source and contracts from `522845af797d3b1899cd24e311c64e73da392a1d`. The larger Vault integration branch starts from a different lineage and must not replace the serving application: it lacks the deployed main-site router, Inventory research and recovery readers, and minute cron.

The existing middleware, site routing, cron, Inventory/catalog code, non-Vault Prisma models, shared domain writers and existing migration bytes remain unchanged. The existing collect host passes through `/admin/vault`, `/vault/support/...` and `/api/vault/v1/...`; no apex route expansion or domain change is required. `@tenkings/vault-contracts` is the only new frontend runtime dependency. Its normal build precedes the application build.

## Migration lineage

Root's read-only October 7 live ledger preflight reports 99 active finished migrations, 13 retained rolled-back rows and no unfinished migration. All 98 migrations in deployed source match. The additional already-applied `20260908010000_speedster_prepared_evidence_authority` matches the frozen source; its unchanged SQL file is included only to retain that ledger lineage. This candidate adds no Speedster runtime admission, models or newly pending Speedster migration.

The eight additive migrations applied October 8 at 04:54:43 UTC are the Vault cloud domain, review integrity, machine profiles, Stripe observations, Spark observations, Spark recovery finance, supervised recovery and production stage isolation. The source union has 107 migration files. The exact 99-to-107 disposable rehearsal passed on PostgreSQL 17.11 before production execution. Root independent readback at 04:54:52 UTC confirms 107 completed migrations, zero unfinished migrations, all 99 prior active checksums and historical rows retained, prior tables preserved, and 23 new isolated Vault tables. The first-install apply is complete and must not be replayed. Never use schema push/reset or replace existing history. Retain the new additive schema on application rollback.

## Reproducible local checks

Use Node 20, a frozen install and a nonproduction build environment without application credentials. Run Prisma generation, contracts/shared/database builds, `pnpm vault:test-contracts`, `pnpm vault:test-cloud`, and the ordinary `scripts/vercel-build.sh` with `RUN_DB_MIGRATIONS=false`. The normal build does not establish deployed schema readiness.

Cloud tests exercise only cloud-owned behavior. The retained synthetic fixture `frontend/nextjs-app/tests/fixtures/vault-spark-cloud-bindings.json` was projected from the actual frozen provisioning implementation and records its source commit. It is test data, never an installation profile. Cross-component adapter/provisioner/SQLite-machine tests stay in the complete Vault source, where the real machine package is built; this candidate does not substitute mocks for those acceptance claims or introduce a hidden machine-package dependency. Ten cloud profile cases and the seven production callback/inbox cases remain in this standalone suite.

## Local validation evidence

October 7: frozen offline filtered install reused 736 packages with zero downloads. The ordinary production build, including the sharp packaging verifier, passed with migration execution disabled and a dummy unreachable database URL. Contracts: 12/12; standalone cloud: 110/110; database Vault helpers: 9/9. Direct frontend TypeScript checking still reports 12 existing AI-grader/Speedster test diagnostics in unchanged deployed-source files and no Vault diagnostics; their separate cleanup is not included here.

Byte comparisons confirmed that removing the isolated Vault schema block reproduces the deployed schema exactly, that existing middleware/site routing/cron and all 98 original SQL files are identical, and that the nine added SQL files and Vault contracts/server/API source match the frozen reviewed source. The new GitHub workflow repeats the cloud checks, ordinary build and exact disposable 99-to-107 migration rehearsal. CI run `37728334178` at the exact deployed source passed all 131 tests, the ordinary Linux production build and actual PostgreSQL 17.11 rehearsal. Its retained artifact verifies all eight pending SQL hashes, existing Inventory/research-recovery/catalog evidence and checksum preservation, three immutable-guard rejections, a no-op second deploy and owned-resource cleanup.

## Production postflight

The final public smoke passed 46 HTTP checks and seven comparisons with prior production, with zero failures. All returned page build IDs match `_UT54uO0w0DIRShowIaSa`. Real apex/main and staff routes, the www redirect, collect customer pages, both platform aliases and referenced public assets passed. Apex Vault routes and collect staff routes retain their prior denials. The public uncached locations read succeeded. Vault admin and machine GETs reject absent credentials; all six sandbox/production Spark callbacks and the Stripe callback remain disabled. No authenticated fixtures, admin POSTs, audit writes or provider requests were used.

Reviewable evidence is retained in `outputs/vault-cloud-rollout/production-post-promotion-readback.json`, `production-post-promotion-smoke.json`, `verified-ci-upgrade.json` and `migration-result.json`. No `VAULT_` environment keys are configured. Vendor/cabinet qualification, machine enrollment, protected acceptance and payment activation remain separate unfinished steps.

Root prepared a separate Ed25519 configuration-signing key, `vault-config-20261008`, under `/Users/markthomas/.local/share/tenkings-vault/config-signing-20261008`; public DER SHA-256 is `a99bc6f0099d9195b38426df9cc0388ccdb132cc9b5dc3eef1c8859683ff4a26`. Root reports directory mode 0700, private-file mode 0600 and a successful signing self-check. The key is not installed in cloud or appliance, and grants no payment activation. The owner account email/phone is still awaiting user input; no identity or grant has been guessed. Private material must stay outside Git.

## Deployment boundaries

A READY Preview is a build, not production acceptance. `RUN_DB_MIGRATIONS=true` runs migrations in any Vercel environment; keep it false during ordinary Preview and Production builds. A Preview using the existing database is not inherently read-only: valid machine GET authentication records `lastUsedAt`, authenticated admin writes persist Vault actions, and enabled callbacks persist receipts. Synthetic test harnesses must use their disposable database only.

Stage exact-source Production without automatically assigning domains, verify existing main/staff/collect routes, assets, auth boundaries and the sole research cron, then promote only the reviewed compatible artifact. Do not promote the larger Vault Preview. Keep all existing Inventory settings and scheduler ownership. Callback stages require independent explicit configuration, exact bindings and separate secrets; production acceptance and protected machine activation remain separate external steps. No callback flag or source publication grants acceptance.
