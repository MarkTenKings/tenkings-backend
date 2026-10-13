# Old shared-database ATLAS retirement — October 13, 2026

The current ATLAS application runs on its independent PostgreSQL17 cluster. The old shared `defaultdb` still serves Ten Kings. The seven exclusively ATLAS-owned schemas and eight retired ATLAS database roles were removed after the independently verified cutover. Ten Kings product data, database structures and routes remain.

## Ownership correction: public AiGrader is also Ten Kings

The initial private diagnostic retirement plans01–03 included25public AiGrader/V2 tables,15public trigger functions,7enums and the `CollectibleCardV2_speedsterSessionId_fkey`. **Those broad plans are superseded and must not execute.** A name inherited from an older grader and a zero-row count do not establish exclusive ATLAS ownership.

The owner-approved V2 blueprint explicitly preserves `AiGraderV2Session`, Speedster-owned media, the permanent `/c/<token>` report and V1 historical NFC/report routes (sections1,5,7,19,22,26,28). Actual source confirms these dependencies:

- `frontend/nextjs-app/pages/c/[token].tsx:74` reads the completed Speedster session for the permanent report.
- `frontend/nextjs-app/lib/server/compsV2.ts:110` selects the Speedster media relation for the independent Ten Kings comps engine.
- `packages/database/src/cardPlatformV2.ts:951` reads the same relation for identity synchronization.
- `frontend/nextjs-app/pages/nfc/[publicTagId].tsx:16` serves the V1 NFC report; `/card-maps` and the existing grader routes are Ten Kings surfaces.
- `frontend/nextjs-app/lib/server/physicalInventoryRead.ts:12` only selects the opaque source-session scalar, but this does not negate the other actual joins.

Therefore preserve all25public tables,15functions,7enums, the V2 foreign key, `/c`, `/nfc`, `/card-maps`, existing grader routes, `/api/v2`, human grading and inventory. No retirement middleware, replacement report system or route deletion is required. The new ATLAS app has no connection/fallback to this retained Ten Kings foundation.

## Exact owned scope

| Schema | Old tables |
|---|---:|
| `atlas_staff` |59|
| `atlas_customer` |36|
| `atlas_manual` |17|
| `atlas_manual_connected` |28|
| `atlas_manual_intake` |5|
| `atlas_defect_analysis` |4|
| `atlas_dealer` |11|
| Total |160|

There is also one owned sequence. The160tables include obsolete staff models and the old86-entry staff migration ledger; the current independent baseline has108application tables and a separate ledger. Do not copy or restore the old schema chain.

The eight exact old roles are:

- `atlas_website_customer_20260909`
- `atlas_website_staff_20260909`
- `atlas_customer_private_20260924`
- `atlas_workspace_source_20260910`
- `atlas_workspace_coordinator_20260910`
- `atlas_workspace_operator_20260910`
- `atlas_manual_connected_20260912`
- `atlas_variant_review_20261010`

The old roles have ACL dependencies only, no object ownership and no dependencies in another database.247residual grants outside the owned schemas consist of246column grants on12public tables and one public-schema USAGE grant. Revoke only these exact grants from the retired roles; preserve the public tables and other grantees.

The seven-schema dependency closure has exactly three outside catalog objects: two ATLAS identity-correction triggers and their constraint on the preserved `public.AiGraderV2Session`. These are ATLAS-specific synchronization hooks. The15retained public trigger-function definitions contain no `atlas_` references. Removal of the three hooks is the only permitted outside cascade; unknown dependencies must abort the operation.

## Prepared transaction and evidence

Private packet: `/Users/markthomas/.codex/atlas-handoffs/atlas-followup-20261012/r16-isolation`.

`owned-schema-retirement-plan-01.json` SHA-256 `2cbefe6acc802e3c92a90bc821377df29e236712f43619335ad48fae9c6a0dba` binds the current inventory and exact SQL `9ba3b52b7f4d8db662427df25a900421ea2df400d075ab267e50f9e9b1b78bc5`. `prepare-owned-schema-retirement.py` is preparation only. The separate one-shot execution wrapper requires both the reviewed plan hash and the actual canonical-cutover proof hash; uncertain outcomes require read-only reconciliation.

The transaction checks source database/authority, eight already-disabled roles, zero sessions/prepared transactions, exact relation set and160table counts; locks the scoped tables; checks the exact outside dependency closure; records digests of all25public table contents,15functions,7enums and the V2 foreign key; drops only the seven owned schemas; revokes247explicit old-role grants; drops the eight roles; and compares every retained public proof before committing. It contains no public table/function/type/constraint deletion and no `DROP OWNED`.

Owned socket-only PostgreSQL17 qualification passed6checks. The synthetic fixture has the exact185old/current table names and counts, real15public function definitions,7enums and247ACL grants. Only the three external catalog object OIDs were rebound to the local fixture. An extra Ten Kings view dependency causes a complete refusal; the reviewed narrowed SQL then succeeds and preserves the public product proof. The fixture was stopped and removed. This is a local SQL qualification, not production schema-removal evidence.

Credential retirement already completed separately at06:22:00.877702Z: exact8NOLOGIN/passwordNULL/CONNECT revocation, one old staff session terminated, no table/schema change. Receipt SHA `380a78a45a5a73133339c6cff7269ccce319f8e8929d7129b1ca85b70411b7f8`; independent read at06:23:25Z confirms8NOLOGIN, zero sessions/prepared transactions, all7oldschemas and25public tables present (SHA `26cf9e551b9d6e36d6d25d057b27b5b9a721109eba97af8864f7584be11d32ce`). These mutation intents are consumed.

The source transport pins the existing SSH host and protected source container, uses `defaultdb`/`doadmin`, and honestly retains existing TLS `require`; no old-cluster CA verification is claimed. The new target uses verified CA TLS. Temporary old-source admin URI and credential extracts must be inventoried and removed after final authorized source checks; Ten Kings-owned runtime configuration and current independent ATLAS secrets remain protected.

## Observed five-photo compatibility cleanup

The approved five storage objects are absent. All 45 image fields across the five CardAsset and five Item rows are now NULL, including the final ten former `CardAsset.storageKey`/`imageUrl` pointers. Compatible Ten Kings web consumers and the narrowly patched Bytebot worker were deployed before the two-column nullable migration and exact five-row update. Every nonimage business field on all ten rows matches the reviewed preimage; no fake URL, blank replacement string or business-row deletion was used.

The production web candidate dpl_J6Y1ytJLx6cgLWBQ2JV8H76yZBdK is based on independently verified actual f02 source, not the ATLAS branch. It checks missing storage before upload completion, local-file upload, thumbnail backfill and PhotoRoom work, and renders missing-photo detail states. Full original build, 20 offline consumer checks and nine owned PostgreSQL groups passed. The existing worker image received only two id-only update projections to avoid its older Prisma model deserializing nullable photo columns. Successor611e0bcbed9b3e2defd1411c5be3a4aa807c7bf97d4b2f23332a8a4174321dd3 runs imagec0d8469e… with exact semantic environment/configuration, zero restarts and endpoint401. NormalTERM/INT did not stop the original; a separately reviewed exact-container force stop completed replacement. Reference computation may repeat; durable queued/reference rows remain. The failed raw environment-order assertion and unavailable pre-stop worker digest are explicitly disclosed in reconciliation4a7f2693…; no mutation was replayed.

Exact SQL `f322900c0bc3e87479216b1b0e98f5ac51f5904c2a3d1b4d92b0101b98f8584f` completed once at07:52:24UTC; result `ten-kings-photo-null-result-01.json` SHA f344aea5f0322818036e3280e6d7652dd75d1ea7ac133a80935dcddba3910ba5 proves five assets/ten pointers NULL and ten business rows preserved. Independent direct read at07:57:04UTC confirms all 45 NULL fields, all ten business hashes, public ledger122 and exact migration checksum, current worker health and both canonical Ten Kings aliases; proof SHA `c2d4bca0cb0963d215509b9c5452bcafbfa0dc057849e1f8635733e9176f66bb`. All 11 exact obsolete metadata, SQL/preimage and old administrator credential-copy files were subsequently deleted at08:00:15UTC. Receipt `release-r16-cleanup/retirement/held-residual-result-01.json` SHA `e8963f4c091cb62ca3d10576834961987337f7be01faec56d8c83ab76d6e152b`; current credentials and sanitized proofs are unchanged. No Speedster route/schema foundation change is included; this separate compatibility correction does not change deployed ATLAS source424fc.

## Remaining physical copies

Removing old ATLAS schemas does not erase managed backups. The old cluster still serves unrelated Ten Kings data and must not be destroyed by this operation. Root owns the separately reviewed shared-backup/cluster disposition and archive retirement. Keep minimal sanitized execution proofs; do not retain raw card archives or old administrator credentials as a convenience fallback.

## Observed owned retirement

Observed exact owned retirement committed 2026-10-13T06:38:23.042019+00:00:7schemas/160tables and8fencedroles removed,247old-role public grants revoked, exactly3ATLAS-specific external hooks removed. All25Ten Kings public table row digests,15functions,7enums andCollectibleFK match the pretransaction proof 97cb1d2c9d526404673e9f6cc464ff0b. Result SHA 90d54f53e27880b569918f32ffad6c724037d28460bc5fe3a22eecacdab83089. Fresh independent READ ONLY postcheck 2026-10-13T06:39:27.942647+00:00 confirms zero owned schemas/roles/sessions/external hooks, same public proof digest and retained FK; SHA 7bdd5b8b84892ff26d55cd8a08c54f682e0619b901a7152beefedd3c0fc23588. No Ten Kings route/product change, no newtarget change and no backup-erasure claim. One-shot intents consumed; no replay.
