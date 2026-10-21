# Card provenance foundation — source and local database qualification

This increment is built on the foundation worktree after `c4b7cc85`, separately from the frozen archive release. It implements the recorded grading/custody portion of master-plan items 01, 06, 07 and 08. It does not claim those entire workstreams are complete. No production database, external provider, customer data, payment, ownership record, deployment or physical finishing operation was accessed or changed during this qualification.

## Internal read contract

`GET /api/staff/manual-connected/cards/:cardId/provenance` is admitted through the existing signed native-service transport and same-origin staff proxy. It accepts only `cursor` and `limit`; limits are 1–100, default 50, and a cursor is at most 768 base64url characters. Unknown/duplicate parameters, another card's cursor, malformed instants and mutation methods are rejected. Responses are `private, no-store`.

The response contains:

- `card`: the latest immutable approval at a fixed snapshot, approved identity/grade, certificate, approval action, report version/state and version-bound published report/front/back photo links. Pending publication has no public link or media.
- `ownership`: `UNKNOWN` verification/status, no history, reason `NO_REVIEWED_OWNERSHIP_RECORD`.
- `custody`: the last recorded physical handoff, if present, with its own source event and times; `currentPhysicalHolder` remains `UNKNOWN`.
- `history`: bounded recorded Atlas events, the fixed microsecond snapshot and a next cursor. `complete:false` acknowledges unknown earlier history.
- `capabilities`: ownership claims, ownership transfers and reholder operations are all false.

The SQL function independently verifies the bound staff session, browser, deployment/release/configuration, current phone roster, REVIEWER role, current per-card ACL and discard state on every page. The JavaScript service also requires the original WeakMap-held authenticated capability. Hidden, discarded and unknown cards return the same 404. A forged object resembling staff identity is insufficient. Only the exact SECURITY DEFINER function is granted to the manual runtime; no customer/custody source table SELECT or new write authority is granted. The function has a fixed `pg_catalog` search path and PUBLIC execution is revoked.

The staff proxy imports only the pure `card-provenance-contract.mjs`. Private service, SQL, media projections and handlers remain on the native side. The staff Card history page consumes the API, checks the session again, clears private state on access failure and requires the same card, approval action and snapshot while merging pages.

## Sourced events and the limits of their meaning

Existing immutable `atlas_manual.approval`, one-way `atlas_manual.publication`, append-only `atlas_dealer.custody_event` and immutable `manual_card_link` records remain the journals. No duplicate event table, historical rewrite, read-time backfill or decorative event creation is added.

`REPORT_APPROVED` and `REPORT_PUBLISHED` are separate events. Approval carries the source revision/hash and saved report hash; publication carries the immutable public packet and manifest hashes. A later publication appends a new event instead of changing the approval event's payload. Later approvals retain the same permanent card/certificate identity and append their own source anchors. No reason such as regrade, replacement or reholder is invented from an approval alone.

Custody events enter the projection only through an immutable manual-card link bound to an actual `ATLAS_RECEIVED` source event for that submission card. Events retain occurred and recorded times and the recorded sequence. Sorting uses `(recorded_at,event_id)` descending. Customer `DEPOSIT_DECLARED` is labeled `SUBMITTER_REPORTED`; declaration and delay notes do not advance the last physical handoff. A recorded dispatch is not a guarantee of current possession. Shipping-label preparation, tracking plans, staff workspace ownership, submitter identity, certificate or NFC possession establish neither physical custody nor legal ownership.

`VERIFIED_RECORD` describes an existing saved Atlas record and its source binding. It does not authenticate a physical card or establish an owner. The future ownership contract reserves distinct `VERIFIED`, `OWNER_REPORTED` and `UNKNOWN` states, but this increment manufactures none of the first two from submission or grading records. Reviewed claimant/transfer authority, consent/privacy rules and dispute/revocation policy remain prerequisites for ownership writes.

Fixed-snapshot pagination selects the latest approval as of that snapshot and includes publication only if it existed by then. Publishing a pending approval later cannot leak its new media/report URL into an earlier snapshot. Source events and their payloads remain stable across later approvals. Current access revocation still takes effect immediately.

## Privacy and public projection

The authorized staff projection allowlists source references needed to audit the saved events. It excludes customer name, email, address, payment identifiers, staff actor identity, custody free text and unapproved draft content. Original image evidence remains in the existing authorized media systems; this read does not export raw storage keys or create image derivatives.

`publicCardProvenance` is a pure, per-page redaction helper only. It returns published report facts and certificate, with unknown ownership. It excludes pending approvals, custody, internal card/source/actor IDs, hashes other than the already public packet hash, cursors and internal snapshot metadata. A page with no published report event returns null, including an entirely pending card. There is no public provenance endpoint and no claim that this helper establishes publication consent or customer authority. A later public/customer integration must separately use appropriate public report admission or authenticated submission access and must not widen that access into ownership authority.

## Migration and runtime readiness

Additive migration `atlas-standalone-009-card-provenance` has SHA256 `2ce701a8d22ca0b2dfa81381919331046358f7acff308440220f1a9c3faa1a6a`. Released migration 008 is unchanged. Migration 009 creates only the read function; it does not create tables, backfill rows or alter source event guards. Existing card/event indexes support its bounded per-card query; production scale and latency have not been measured.

The future native runtime requires the exact function and EXECUTE grant, failing with `CARD_PROVENANCE_SCHEMA_REQUIRED` or `CARD_PROVENANCE_GRANTS_REQUIRED` before serving if either is missing. This check belongs to the future source and does not change frozen archive-release startup. The standalone grant generator conditionally grants the function when installed, preserving historical-prefix qualification. The existing archive qualifier now explicitly identifies migration 008 and tests the currently registered suffix, so additive 009 does not invalidate the archive's own upgrade evidence.

## Verification

The final focused contract/service/HTTP/migration run passed 13/13 tests. It covers malformed and cross-card cursors, counterfeit capabilities, private projections, exact source binding, stable ordering, pending/public redaction, raw role-name injection rejection, missing-schema/grant readiness and an actual signed proxy/private HTTP round trip. No ownership mutation path is accepted.

The integrated connected-manual suite passed 892 tests: 890 passes, zero failures and two existing environment-gated measurement skips. The complete standalone-database suite together with the seven actual/client Card history tests passed 14/14. `git diff --check` passed. Logs are `/tmp/atlas-marketplace-foundation-checks/provenance-connected-full.log` and `/tmp/atlas-marketplace-foundation-checks/provenance-database-history.log`. The integrated run includes the concurrently developed reviewed-sports-attributes/identification v5 source at that checkpoint; later narrow fixes in that separate lane require its own focused validation.

The final owned PostgreSQL 17 run passed all seven groups with Node 22.16.0:

1. Least-privilege service reads preserve immutable approval/publication/custody anchors and unknown ownership/holder. Pending, inaccessible, discarded and mutable draft evidence are correctly excluded. Before/after protected-row snapshots are equal.
2. Microsecond keyset pages retain the same card, certificate, approval and source event payloads when a new approval/publication is inserted between pages. The new read sees new events without inventing a reholder cause.
3. Later publication appends an event without rewriting approval evidence or changing an earlier snapshot's pending report/media state.
4. Actual append-only source guards reject attempted historical rewrites. Declarations/delay notes do not advance the physical summary. Recorded dispatch still leaves the current holder unknown.
5. Direct SQL checks reject forged session/browser/release/roster, observer role and malformed input. Revoked card access fails on the next cursor page. Customer role cannot execute; manual role cannot SELECT private custody/order tables.
6. The integrated authenticated HTTP handler returns the source-bound DTO/cache policy, leaves protected rows unchanged and fails after session revocation.
7. Registered 009 upgrades an exact prefix through 008 while retaining previous staff/card/approval/publication rows and migration ledger entries unchanged. Clean baseline through 009 and repeated migration no-op also pass.

Retained evidence: `/tmp/atlas-marketplace-foundation-checks/provenance-postgres-final2/postgres-result.json`; browser fixture from actual synthetic SQL projection: `/tmp/atlas-marketplace-foundation-checks/provenance-postgres-final2/synthetic-card-history.json`. The result records `productionQueries:0`, `providerCalls:0`, `ownershipWrites:0` and owned-cluster cleanup `stoppedVerified:true`. The current archive qualifier also passed six groups with registered suffix 008+009; evidence is `/tmp/atlas-marketplace-foundation-checks/archive-postgres-with009/postgres-result.json`.

Reproduction (no install, provider or ambient database URL):

```sh
PATH=/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin:$PATH \
ATLAS_CARD_PROVENANCE_EVIDENCE=/tmp/atlas-marketplace-foundation-checks/provenance-postgres-final2 \
node packages/atlas-connected-manual/scripts/validate-card-provenance-postgres.mjs \
  --ack-disposable-local-postgres \
  --postgres-bin /opt/homebrew/opt/postgresql@17/bin \
  --pg-module /Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg
```

These are source and synthetic local database results, not proof of live schema, production access, physical possession, verified ownership or marketplace eligibility. Root owns the final integrated build/browser qualification and release decision.
