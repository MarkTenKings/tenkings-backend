# ATLAS standalone PostgreSQL baseline

This package installs the current ATLAS schema into a dedicated, empty PostgreSQL 17 database. It does not replay the historical Ten Kings `public` or ATLAS Prisma migration chains, copy data, discover credentials, contact providers, or activate a runtime.

The baseline contains seven owned schemas, 108 application tables, 186 functions and 161 triggers. Installation adds one separate `_standalone_migrations` receipt table. There are no `public` application objects, `AiGrader` composite types, foreign servers, legacy staff specimen/workspace tables, obsolete customer submission tables, or catalog contribution queue.

## Provenance and extraction

`baseline.manifest.json` binds the SQL to a read-only schema-definition census of the deployed R15 PostgreSQL 17.11 database, observed 2026-10-13. No row data was exported. `scripts/build-baseline.py` accepts only the exact retained census SHA and writes deterministic SQL plus the manifest; it never connects to a database.

The retained schema uses its authoritative current columns, defaults, constraints, indexes, functions and triggers. Only two retained function definitions change: `customer_call_v1` loses obsolete submission/card branches while preserving authentication/profile behavior; `operations_change_guard` retains current identity audit enforcement and loses obsolete specimen/assignment/invoice branches. The old cross-check against legacy public reports and exclusively retired function/trigger closure are omitted. Current dealer authority still requires `StaffOperationsGrant`; the private signed manual-public reader still requires `PublicReaderControl`.

`research_effect` remains necessary for current independent research/provider request, response and uncertain-outcome fencing. Future correction and prepared-lesson storage remains present, but serving roles have no release-promotion authority. No historical lesson data is seeded.

## Installation contract

The release operator supplies a reviewed explicit PostgreSQL client connected with verified TLS to the new dedicated database, and calls:

```js
import { applyStandaloneBaseline } from './migrate.mjs';
const result = await applyStandaloneBaseline(explicitClient);
```

The installer verifies SQL/manifest SHA, takes an advisory transaction lock, refuses preexisting application schemas or `public` relations/functions/types and foreign servers, then installs atomically. A repeat call requires the exact single registered version/checksum and returns `NO_OP`; it does not silently repair schema drift. Catalog/readiness checks remain required separately.

After installation, the release operator executes `standaloneRoleSQL` in its own transaction:

```js
import { standaloneRoleSQL } from './grants.mjs';
const sql = standaloneRoleSQL({
  staff: 'atlas_staff_runtime',
  manual: 'atlas_manual_runtime',
  variant: 'atlas_variant_runtime',
  customer: 'atlas_customer_runtime',
  customerPrivate: 'atlas_customer_private_runtime',
});
await explicitClient.query(sql);
```

The helper validates five distinct role names and creates **NOLOGIN**, non-owner roles with no role membership, superuser, database/role creation, replication or RLS bypass. Root's separate reviewed credential transaction binds fresh LOGIN credentials. No old roles/passwords are imported. The staff role has exactly the seven current auth-table contracts; customer roles execute their narrow SQL gateways; manual/variant roles retain current generated-frame reading and cannot write learning release/control/membership. The public website uses its signed manual service and has no PostgreSQL role.

Use `retained-copy-policy.json` as a review allowlist, not as a bulk-copy implementation. Retain reviewed account/phone hashes and financial facts; keep old browsers, sessions, challenges, audit and SMS reservations out. Rebind controls while disabled. Do not import card/derivative or lesson examples. Existing source neutral release/control rows and global geometry capacity are configuration/coordination, not old card content; create fresh target equivalents. Reference cache import is excluded by default pending policy/provenance review. Import transactions must respect immutable triggers and prove FK/row-digest preservation; this package does not bypass them.

## Owned local qualification

Run with Node 22 and explicit already-installed PostgreSQL 17 binaries and `pg` module:

```sh
node scripts/qualify-local.mjs /absolute/pg17/bin /absolute/pg/lib/index.js /absolute/new-receipt.json
```

This creates a nonce-owned socket-only local cluster, refuses ambient DB settings, restores all empty tables, verifies the exact no-op and altered-ledger refusal, rejects an existing public function, installs all five role contracts, checks actual serving privilege validators, tests negative authority and account compatibility, and executes restricted customer authentication bootstrap. It stops/verifies/removes its owned cluster before writing success. No production or provider calls occur.

The shared `frontend/atlas-app/scripts/disposable-postgres.mjs` now uses this same current baseline and refuses all historical upgrade hooks. Current manual-service, image, geometry, findings, variant, research, commerce and public-report qualifiers can therefore exercise the application against an independent schema. The staff `validate-postgres.mjs` entry point runs the real durable manual/auth flow plus the signed synthetic manual-public round trip. Historical workflow tests are retired with their removed implementations; their old counts are not represented as current qualification.

## R16 selective retained-data copy

`retained-copy.mjs` is offline planning plus an explicit-client executor. It discovers no credentials, connects to no database, and sends no provider requests. The operator supplies the exact source snapshot, new deployment bindings, target connection and reviewed plan hash. `retainedSourceSQL()` exports only the 33 reviewed account/commerce/control tables and counts all 108 current tables, in one UTC repeatable-read read-only transaction. Store the result privately (0600). Freeze every old writer before the final snapshot; a previous census is qualification evidence, not final cutover evidence.

The first observed snapshot contained 29 rows: 21 unchanged account/financial/capacity rows and eight control rows. Both financial effects were SUCCEEDED, the payment PAID and the reservation CONSUMED. Nonterminal financial work, nonzero physical-card/learned data, unexpected export tables or changed dealer population refuse planning. Historical catalog/query/label/image cache, sessions, SMS reservations, browser/challenge secrets and audit rows are never exported. Financial receipt JSON remains financial history and never becomes card/lesson data.

Build the reviewed plan without a database connection:

```js
const controlRows = disabledRetainedControls(snapshot, {
  staff: freshStaffBinding,
  publicReader: freshPublicBinding,
  customer: freshCustomerBinding,
  customerService: freshPrivateCustomerBinding,
  commerce: freshCommerceBinding,
  at: explicitCutoverTimestamp,
});
const { plan, sha256 } = prepareRetainedCopy(snapshot, {
  controlRows,
  geometryConcurrency: 12,
  neutralReleaseId: freshReleaseId,
  reason: explicitOwnerRequestedEmptyBaselineReason,
});
```

Bindings must be the actual reviewed new release/configuration values. They remain disabled. The two SMS controls start disabled with no old pilot, provider binding, activation window or public-admission approval; later SMS admission needs its own current configuration. Exact account phone hashes remain usable only if the separately managed phone-hash key is retained. Do not print these values or put them in repository files.

Before calling `executeRetainedCopy`, independently bind the verified-TLS connection to the newly provisioned ATLAS cluster/database and hold its writers disabled. The executor checks `expectedDatabase`, exact baseline ledger, all 108 empty target tables, all 161 enabled triggers, and the reviewed plan hash. It locks the target tables and imports in FK order. Four named target trigger exceptions apply only to nonempty import tables:

| Table / trigger | Exact reason |
| --- | --- |
| CommerceOrder / dealer_order_paid | Do not reconstruct purged physical dealer card rows from a historical paid receipt. |
| CommercePayment / CommercePayment_weekly_capacity | Preserve exact capacity records without deriving duplicate events. |
| WeeklyCapacitySharedPolicy / WeeklyCapacitySharedPolicy_valid | Preserve a historical effective date that the new-policy guard correctly rejects today. |
| SmsPilotControl / SmsPilotControl_no_replace | Insert the two new disabled policy rows into the empty target. |

Every other trigger, ordinary check and foreign key stays active, including verified-email guards. Compare retained PostgreSQL canonical row text exactly; compare typed new control rows to their plan. Restore and compare every trigger definition/state before completing. The same transaction initializes geometry capacity12 and creates a new `EMPTY_BASELINE` release with `balanced-defect-v1`, version `atlas-learning-release-v1`, `evaluation:null`, and `publications:[]`. The ordinary activation trigger writes exactly one **new** history record with the supplied reason; no old release/history/membership is copied. Serving roles remain unable to promote lessons.

The executor defaults to rollback. Its rehearsal performs SQL writes inside a transaction and may consume a PostgreSQL sequence value even after rollback; use the owned local qualifier for a mutation-free production dry run. An actual copy requires explicit `commit:true`, the exact reviewed hash and `expectedDatabase:'atlas_grading'`. A populated target always refuses a repeat attempt; reconcile uncertain commits before any new action. No automatic retry, application activation or schema change is performed.

`node scripts/qualify-retained-copy.mjs <absolute-PG17-bin> <absolute-pg-module> <private-snapshot-json> <new-private-receipt-json>` creates a socket-only owned cluster, restores this baseline, exercises exact retained data with synthetic disabled bindings, proves rollback, then commits only in the disposable fixture and proves replay refusal, trigger restoration and empty learning. It stops/removes the fixture before writing success. `retained-copy-01.json` records 11 passing checks; package tests pass5/5. No production/target writes or provider calls were made. A final plan must be regenerated from the frozen source and the actual release bindings, not reused from the synthetic rehearsal.

The older broad connected CPU fixture still assumes the pre-R15 absence of a generated grading image and fails `GRADING_IMAGE_NOT_CONFIGURED`; it is not a passing current-workflow proof. Current standalone manual/public, generated-image, Astra geometry, variant, research, human confirmation and transient-batch PostgreSQL qualifiers are separately recorded in the session log.
