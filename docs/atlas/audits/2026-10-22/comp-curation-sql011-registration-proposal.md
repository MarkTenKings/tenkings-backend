# SQL011 comp-curation registration — proposal and source qualification

## Current local checkpoint

After SQL010 commit `2a632429`, root authorized this bounded registration and future-fixture compatibility. SQL011 now exists and is registered locally at the exact6748-byte `aa198791…` transform below; all original proposal, role proposal, baseline/002–010, migrator, grant and consumed010 qualifier bytes remain unchanged. No production migration, grant, runtime activation or database execution occurred in this lane. The separate finite qualification now passes all six PG02 groups; root independently reviewed actual preservation/native replay/cleanup. Final envelope `d23f832f…`, result `75f814ce…`; see [qualification](comp-foundation-qualification.md). Production remains SQL009.

Six source/helper tests pass under OS network denial, with nine changed JavaScript files passing syntax checks and clean whitespace. Source envelope `/Users/markthomas/.codex/atlas-handoffs/atlas-comp-foundation-20261022/source-qualification-01/qualification.json`, SHA256 `208a55a7c3d6222112b3bf37cea597a7721578f31a1df0b0e2ec1b4f60fa82d1`, retains29 exact current/saved sources (11 changed,18 unchanged) and four evidence files. This is not a full vendor closure or a new actual-PG/browser claim.

`test/comp-foundation-fixture.mjs` asserts the full exact current ledger,011 checksum, `pg_catalog` inspection context, unchanged externally reviewed `a1bbdf29…` schema and common actual object owner. It only reads; it cannot install, repair, grant or adopt observed schema. The four future comp fixtures use that assertion instead of installing the proposal twice and retain new dependencies. Restricted-role/preference ledger expectations are11. Original service, policy:null semantics, role/checker, source authority, mutation assertions and prior receipt checks remain unchanged. Positive actual schema/role/helper behavior belongs to ownership lane’s separately reviewed finite011 qualification.

Independent ownership-lane source review passed on envelope `208a55a7…`, verifying all29 current/saved source pairs plus four evidence refs, exact manifest prefix/transform, strict helper and bounded future-fixture changes. No tests or DB effects were repeated by that review. The new finite qualifier is owned and qualified separately; source review is not execution authorization.

The following proposal is retained as the pre-implementation decision record. References to future work describe that checkpoint unless superseded above.

## Historical proposal before registration

This is a read-only implementation plan. No SQL011 file, registry entry, shared fixture, grant, runtime or production setting was changed. SQL010 now has local six-group PG03 qualification and independent receipt/source review, envelope `fd359467…`; its frozen source/receipts remain immutable. The earlier PG02 attempt stopped after two groups on a fixture privilege-census expression and is retained with verified cleanup. SQL010 is not deployed. Production remains SQL009; root owns the source commit before any011 implementation.

## Smallest registration

Add `packages/atlas-standalone-database/sql/011-comp-curation.sql` and append one manifest entry named `atlas-standalone-011-comp-curation`, after the exact010 entry. Keep the original proposal immutable. The migration is precisely its bytes minus the single outer `BEGIN;` line and final `COMMIT;` line. Retain its original introductory comments as historical proposal provenance; registration is defined by the manifest. No DDL, trigger/function body, public revocation or constraint changes are required.

The source proposal is6763 bytes, SHA256 `3eb42a3f93e4caf7b9e1a53cecd5290ad6b0aaf22cbe35bd039951f8e6cbf0d2`. The proposed wrapper-free bytes are6748 bytes, SHA256 `aa19879134c9ad6261fa33ad96ed0f5be6ee2e498b601c3e2f12deee407fe36a`. This hash was calculated locally in memory; no migration file was written.

```diff
 -- insertion; this table's hashes alone cannot establish source authority.
-BEGIN;
 CREATE TABLE atlas_manual.comp_curation (
 ... all intervening bytes identical ...
 REVOKE ALL ON FUNCTION atlas_manual.comp_curation_guard() FROM PUBLIC;
-COMMIT;
```

The current migrator already owns `BEGIN`, its advisory transaction lock, the SQL application, ledger insert and final `COMMIT`. Registering the proposal unchanged would let its internal `COMMIT` end that transaction before the ledger insert. Removing exactly those two wrapper lines preserves atomic migration and ledger behavior. Internal PL/pgSQL `BEGIN`/`END` must remain untouched; do not strip tokens globally. No migrator or ledger-validator change is needed.

The schema adds one empty private append-only receipt table, its foreign key/constraints/indexes, one guard function and three triggers. It does not seed a decision, policy, owner, role, marketplace listing or price. Guard semantics remain latest publication of any state must be PUBLISHED and match the requested approval; a newer pending publication refuses. Saved artifact verification and live staff/card access remain service responsibilities. Registration alone does not expose a usable route or grant a writer.

## Independent role and schema boundary

Do not register `comp-curation-role-proposal.sql`, add it to global serving grants, or broaden the existing staff/manual/customer role. That retained role proposal (`f7378ae8…`) remains a separately reviewed provisioning action: schema USAGE on manual/intake, SELECT on the nine enumerated tables, INSERT only on comp_curation, EXECUTE only on manual.authenticate, and UPDATE(id) only on the two card tables for row-lock admission. Existing immutable/revision triggers must continue rejecting actual ID writes, including `id=id`. The role owns no objects, has no membership, CREATE/TEMPORARY or unrelated effective rights. New native credentials/lifecycle and operational provisioning stay separate.

Reuse `comp-curation-database.mjs` unchanged (`571d124650a0682ea07cac432f4accd8326322e0382163043b951d9ee1a27c1a`). Its reviewed normalized nine-table schema pin is `a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7`. The independently reviewed source envelope is `restricted-role-pg-03/reviewed-owned-schema.json`, SHA256 `edd44ee56cc7c55e77b0442c756406ea4652c92e01ff2e02a1f403f41d3b62ba`, under `atlas-staff-comp-curation-20261021`.

Wrapper removal should leave that normalized catalog hash unchanged, but actual PostgreSQL must prove it. Compare columns/defaults/constraints/indexes/non-internal enabled triggers and reachable routine bodies/security/search_path/return metadata using the existing inspection and checker under `SET LOCAL search_path=pg_catalog`. Names of installation owners are normalized only for the hash; actual owners remain checked independently against the reviewed schema owner. Do not replace the expected pin with a newly observed value to make a failure pass. Differences require diagnosis/review.

## Source compatibility work after010 closes

1. Add a dedicated011 source test with exact original proposal hash, exact two-line transform/byte equality, immutable baseline/002–010 prefix, no top-level transaction wrapper/grants/seeds and exact last registry entry. Update the existing migration-count expectation to ten additive migrations/eleven total ledger rows. The010 component test still proves its original bytes at index8; its full-current-ledger count becomes11.
2. Add a small test-only comp-foundation assertion to require the exact011 ledger/checksum and installed schema/function/trigger pin before fixtures omit their duplicate proposal install. No `IF NOT EXISTS`, table-existence fallback, repair or weakened prior-receipt check. Existing `inspectCompCurationSchema` and role checker provide the catalog contract; no production wrapper is needed.
3. Four current comp fixtures manually install the proposal after creating a fully migrated owned database: `comp-curation-postgres.mjs`, `staff-comp-curation-native-postgres.mjs`, `comp-curation-restricted-role-postgres.mjs` and `staff-comp-curation-journey-postgres.mjs`. Replace those duplicate installs with the exact assertion and update their future source closures. Restricted-role explicit ledger counts become11. The ownership-preferences fixture also has two explicit ledger10 expectations to update; its dynamically inventoried table census naturally includes the new empty comp table. Other ownership helpers already validate the full current manifest.
4. Preserve all historical010/comp source copies, plans and results. The010 finite qualifier intentionally installed an unregistered comp table before testing010; it is not directly reusable once full-chain migration includes011. Keep that consumed qualifier as dated evidence and use the new011 qualifier for current-prefix work, or explicitly review a targeted-prefix successor if a future010 rerun is actually required. Do not silently replay or weaken it. Likewise old restricted-role receipt-source pins will correctly refuse fresh plans after registry changes; produce fresh compatibility evidence instead of rewriting accepted browser/PG receipts.

## Bounded qualification to authorize separately

Propose a fresh finite owned PG17 qualifier, with an exact logged nonce/path/socket/port/source plan and verified `finally` shutdown/data absence. It should cover:

- Populated exact010 prefix to011: every existing table row, prior ledger row/time, schema/routine/trigger definition, role membership and ACL unchanged; exactly one empty comp table, its required catalog objects and one ledger row added. Preserve real synthetic approval/report/market/control fixtures without provider or grading work.
- Fresh full chain and repeat no-op: eleven exact ledger rows, zero application seeds, no new role or unexpected existing-role access. Prove ordinary staff/manual/customer roles gain no new comp INSERT or function access through the migration.
- Atomic failure: force an actual ledger INSERT failure after011 DDL in an owned test database, then verify neither the new table/function/triggers nor ledger row survived. Also refuse a partial/existing unledgered comp schema or corrupt prefix without repair. No destructive action against any non-owned database.
- Restricted native compatibility: grant only the retained proposal to a fresh non-owner synthetic role, assert the external `a1bbdf29…` schema pin, then use the actual restricted boundary/service for policy:null read, Skip, No suitable and exact same-ID receipt replay. Exact expected comp-event rows may change; all reports/presentation/market/grading rows and artifacts remain identical. SELECTED must remain unavailable without policy/designation; never infer STANDARD or a current price.

Source review should first verify the exact transform/registry prefix and future fixture changes. A second reviewer should inspect the actual upgraded catalog, negative privileges, rollback proof, expected mutation sets and cleanup receipt before calling011 locally qualified. Root owns any later deployment, operational grant/client/dispatcher configuration and live acceptance. None of this requires an owner pricing-policy decision for private read/Skip/No suitable; valuation guidance, listing/asking-price use, rights and designation decisions remain unresolved and separate.
