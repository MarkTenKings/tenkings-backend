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
