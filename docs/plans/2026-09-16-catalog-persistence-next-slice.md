# Shared catalog: next persistence and review slice

Date: 2026-09-16. Read-only source assessment at `ece8223b` on `codex/staff-inventory-release-20260910`, in `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`.

Status: implementation assignment, not an applied schema, reviewed real catalog, or release. This assessment writes only this document. No database connection, migration, credentials, provider call, commit, deployment, or Atlas edit was performed.

Authority: the September 16 amendment in the [approved blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md), the [updated improvement plan](2026-09-15-variant-and-sold-comps-improvement.md), and the [shared contract](2026-09-16-shared-catalog-contract.md). The owner has authorized building this extension; normal additive migration/release checks still apply. Do not ask for another generic implementation permission. A real manifest still needs its explicit human review.

## Deliverable and ownership

Build one complete local path: bounded candidate JSON → human SetOps review → immutable publication → exact authorized lookup → explicit revocation. Demonstrate it with the pilot agent's one sports product and one Pokémon set before adding more products. Reuse the existing SetOps identities, roles and audit table. Do not build a crawler, a second catalog editor, another worker, or a `CardIdentityCatalogV2` migration.

The persistence agent owns these paths (new paths unless marked existing):

- `packages/database/prisma/schema.prisma` and one additive migration directory `packages/database/prisma/migrations/20260916<coordinator-assigned-time>_set_catalog_evidence/` (existing schema; lead assigns the exact timestamp before work).
- `frontend/nextjs-app/lib/server/setCatalogEvidence.ts`: sole publication/proposal writer and authorized loader; server composition of `@tenkings/card-catalog-evidence`.
- `frontend/nextjs-app/lib/server/setCatalogEvidenceMedia.ts`: narrow source/image verification and private resolution boundary, reusing storage primitives.
- `frontend/nextjs-app/pages/api/admin/set-ops/catalog/{preview,publication,lookup,media}.ts`: bounded human-admin review/read actions. `publication.ts` owns publish and revoke; there is no generic JSON update endpoint.
- `frontend/nextjs-app/components/admin/SetCatalogEvidenceReview.tsx` and one link/panel insertion in existing `pages/admin/set-ops-review.tsx`.
- Scoped existing `lib/server/setOps.ts` and `lib/server/setOpsReplace.ts` guards for retained publication history; no rewrite of unrelated SetOps behavior.
- `frontend/nextjs-app/tests/setCatalogEvidence*.test.ts`, `packages/database/tests/setCatalogEvidencePostgres.test.js`, `packages/database/scripts/testSetCatalogEvidenceDisposable.mjs`.

Lead owns dependency/lock integration, common docs/session log, migration ordering, independent review and release. The pilot agent supplies source artifacts, an exact manifest and a human-readable exception/diagnostic review packet; it does not publish. The adapter agent owns `staffInventoryResearchReferences.ts`, existing research-attempt integration and its tests, after the loader interface is frozen. The adapter must not write publication tables, accept arbitrary manifest authority, edit this schema, or touch intake/save. Atlas remains separately owned.

## Existing code facts that determine the design

| Evidence | Consequence |
| --- | --- |
| `setOpsDrafts.ts:689` builds legacy `versionHash` without `row.raw`. | Do not change that hash or use legacy approval to authorize new manifest fields. |
| `pages/api/admin/set-ops/approval.ts` uses `requireAdminSessionOrOperatorCapability(..., 'set-ops:batch-import')`, calls `runSeedJob`, then separately inserts approval and updates draft/jobs. | Keep that legacy endpoint unchanged. New publication is a separate human-only action; no seeding inside its transaction. |
| `setOps.ts:193` audit helper writes via global Prisma and catches failures. | Publication/revocation must call `tx.setAuditEvent.create` directly and propagate failure. |
| `schema.prisma:1220–1376` has draft/version/approval/audit but no full-manifest pointer or proposal uniqueness. Version and approval FKs cascade on draft deletion; audit `requestId` is not unique. | Add actual constrained persistence. Retain referenced history with restrictive FKs; request-header IDs are never replay authority. |
| `setOps.ts:365` deletes taxonomy/draft/audit rows; `setOpsReplace.ts:1327` deletes the old draft during replacement. | Refuse destructive delete/replace for any draft with publication history, including revoked history. Additive revocation is not permission to delete it. |
| `staffInventoryResearchReferences.ts:70–103` reads approved, unarchived taxonomy joins and source kinds. | Existing private references remain legacy evidence. They are not a loader for the new fully reviewed contract. |
| Package reader requires exact publication pin; its implementation has no production loader. | Implement the host boundary before an adapter claims shared-catalog authority. |
| `staffInventoryResearchStorage.ts` archives checksum-keyed private research images, but has no reusable-reference permission grant. | A retained flag/storage key cannot authorize catalog or Atlas reuse. Image permissions and depicted identity require explicit review. |

`SetProgram`, `SetCard`, `SetParallel`, `SetVariation`, `SetParallelScope` already supply required identities. Language/edition and exact per-card applicability belong in the immutable manifest, not inferred from those flat scopes. A pilot with missing actual taxonomy IDs cannot publish a synthetic ID: materialize/review the existing taxonomy through its normal source path first, or report that prerequisite.

## Small additive persistence

Implement the previously proposed `SetCatalogEvidencePublication` plus nullable `SetDraft.currentCatalogPublicationId`.

Publication fields: server ID; `draftId`; `draftVersionId`; a unique newly created `setApprovalId`; schema version; positive revision; complete `manifestJson`; server `manifestSha256`; nullable unique `supersedesPublicationId`; non-null `reviewedById`; server `reviewedAt`. Add bounded, hashed `verificationJson` only for the host facts absent from the package payload: exact private artifact references/versions, source classification verification, image byte/dimension verification and the explicitly reviewed internal usage grant. Bind its SHA alongside the manifest SHA in the new review request and audit. This is one publication's verification snapshot, not another media registry or a new mutable permissions system. The normal private media resolver still checks current access.

Required constraints/guards:

1. Unique `(draftId, revision)`, unique successor of a prior publication, unique `(id, draftId)` for a same-draft composite current-pointer FK, and exact same-draft links to version and predecessor. Link the specific approval to this version/draft; reject a mismatching or non-APPROVED approval.
2. Restrict publication-referenced draft/version/approval/user deletion. Publication UPDATE/DELETE fail in PostgreSQL. Freeze the referenced approval/version binding against UPDATE as well; a nullable legacy actor relation must not erase the publication's required human identity.
3. Publication revision is previous historical revision + 1, serialized under `SELECT ... FOR UPDATE` on the exact `SetDraft`. Only revision 1 has no predecessor. Clearing current availability does not erase the historical head.
4. Narrow UPDATE/DELETE protection for catalog publish/revoke audit events (and their authority linkage) while preserving unrelated legacy audit behavior. The existing freely deletable audit table alone cannot preserve a revocation record.
5. `currentCatalogPublicationId` can only advance to a valid new successor or clear to unavailable through the writer. Never expose a generic pointer setter or resurrect an earlier revision. Add SQL consistency guards where possible; unique constraints alone do not prove an allowed pointer transition.

The same migration may add the small `SetCatalogObservationProposal` inbox because neither existing SetAuditEvent nor the package helper enforces its uniqueness: server ID, producer, observation ID, input revision, complete proposal JSON/hash, authenticated submitter and submission time, unique `(producer, observationId, inputRevision)`, append-only UPDATE/DELETE guard. Do not add mutable review status or overwrite a proposal with the accepted manifest. A later review references the proposal IDs in the new publication's review evidence. Implement the durable writer/test now, but expose no Atlas HTTP submission route until Atlas transport authorization and physical-record binding are agreed. Inventory submissions are server-internal, tied to its actual immutable attempt input.

## Review and publication contract

Use `requireAdminSession(req)` followed by `canPerformSetOpsRole(admin, 'reviewer')` for review/preview; `approver` for publication and revocation. Server-resolved human session/user is authoritative. Static operator-key requests and body-supplied user/reviewer/trust fields fail. Ordinary background consumers call the internal loader from their already authorized app context; do not give staff public access to admin APIs to make research work.

The first review surface accepts a locally prepared bounded manifest. It presents full canonical data plus usable structured views: source excerpts and hashes, aliases, all applicability changes/exclusions/unknowns, language/edition scope, independent coverage states, actual depicted identity versus represented finish, every image and its diagnostics, and differences from the pinned predecessor. Human confirmation is explicitly **Publish reviewed catalog evidence**. Legacy **Approve** and the batch-import CLI never invoke it. A downloadable hash alone is not an adequate review interface.

`preview` is zero-business-write preparation. It validates the manifest and server source/media evidence, returning the exact manifest/verification hashes and expected version/current/history pins. No incoming URL is fetched arbitrarily; resolve approved private artifacts through the existing storage boundary, bounded by bytes/time and exact object identity. Prepare bytes/network work before the lock. A local private fixture can test the boundary but must be labeled test-only.

Publish request: complete manifest plus its expected full hash, verification hash, exact draft/version and legacy hash, expected current publication pin (nullable), expected latest historical publication pin (nullable), and explicit review acknowledgement. Server recomputes all hashes and derives approval/user/time itself. The separate history pin is necessary after revocation: a null current pointer must not make revision 1 or a stale first-publication request eligible again.

Inside one short transaction:

1. Lock the draft; reject archived/ineligible status, mismatched exact version, active replace/seed transition or changed current/history pins. Publication against an earlier version is allowed only if deliberately selected and explicitly eligible; the initial implementation should require the latest exact draft version to keep this unambiguous.
2. Validate every program/card/parallel/variation/scope ID and set/program relationship against current SetOps records and verify the precomputed evidence still names the same immutable objects. Never read mutable source data as an implicit new review. Existing mutable taxonomy is a source to validate, not a substitute for the stored manifest snapshot.
3. Insert a fresh `SetApproval` for this exact version/user, retaining its legacy `versionHash` semantics and linking the new complete-manifest review. Do not accept an old batch-import approval as that review and do not invoke legacy seeding.
4. Insert publication with server reviewer/time and predecessor; read it back and re-hash the exact persisted manifest and verification payload. Mismatch aborts everything.
5. Move the current pointer and insert the catalog success audit through `tx`. Commit all or none. Do not update inventory, research results, photos, grades, prices, or historical catalog rows.

Reader: short repeatable-read transaction reads exact pin, pointer, archive state and immutable approval/manifest/verification binding; checks current media authorization; returns a detached snapshot into `createPublishedCatalogReader`. Unknown/wrong hash/set/revision, revoked/superseded/archived, missing grant or inconsistent binding fails closed. Pin discovery, if needed, returns only current pin for an exact set; the subsequent lookup is still explicitly pinned. No newest/nearest fallback. Historical audit read is separately authorized and visibly noncurrent.

## Retry, races and revocation

- Same draft/revision/exact manifest+verification hashes retries return the original publication receipt. Different bytes under the same expected revision conflict. Replay never changes a pointer and never says a revoked publication is currently usable.
- Two competing publishers locking one draft yield one commit and one stale-pin conflict. Check both current and historical pins; tests must include revoke → new review and revoke → stale retry, not just first publication races.
- Revoke compares exact expected current pin, clears it and appends a protected audit in the same transaction. A repeated revoke returns an idempotent unavailable result only for that exact publication; it cannot clear a later publication. No network/media operation runs under the lock.
- Supersession creates the next immutable revision; restoring old content is a newly reviewed revision with a new predecessor/hash, never a pointer rollback.
- Archive suspends lookup. Unarchive cannot restore a cleared pointer. For the initial slice, keep eligibility dependent on approved status as well as `archivedAt`; the existing unarchive route changes ARCHIVED to DRAFT, so renewed publication/review is explicit.
- Proposals use a DB unique insert and read-back hash comparison. Under a concurrent unique conflict, read the existing record in a valid transaction (retry outside an aborted insert transaction or use an appropriate no-op insert pattern). Exact payload replays; different payload conflicts. Authenticated producer/card/input bindings cannot be supplied by the body.
- Recheck availability before accepting catalog-derived new research output. An in-flight stale computation may be retained as historical evidence, never relabeled as current or used to resurrect authority. The adapter implements this bounded final check without adding anything to intake/save.

## Tests and exact local commands

Implement the named new disposable runner by following `testCardInventoryV2Disposable.mjs`: it creates its own loopback-only cluster, does not accept external `DATABASE_URL`, copies the complete migration chain into an owned temp tree, deploys twice and compares the migration ledger, runs SQL/API fixtures, then stops/removes only its own cluster. Reuse isolated test tools; do not add PostgreSQL tooling to production dependencies. Use PostgreSQL 17 to match the last recorded production major, then verify actual target major separately before a real rollout. No live query is needed for this assignment.

Commands after implementation, from the authoritative checkout (new catalog runner does not exist yet):

```sh
node --test packages/card-catalog-evidence/tests/*.test.mjs
pnpm --filter @tenkings/database generate
pnpm --filter @tenkings/database build
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-inventory-test-tools-20260907 node packages/database/scripts/testSetCatalogEvidenceDisposable.mjs --ack-disposable-local-postgres
pnpm --filter @tenkings/nextjs-app exec tsx --test tests/setCatalogEvidence*.test.ts
```

If the recorded isolated tools directory is absent, provision a new test-only tools directory; never substitute a configured application database. The frontend test invocation must match the repository's actual test loader dependencies during implementation; do not claim these future tests have run. Lead runs the established migration-disabled production build with an allowlisted credential-free environment after integration.

Acceptance must cover actual two-connection publication/revoke/proposal races; cross-draft pointer/FK rejection; no partial approval/publication/audit after injected failure; post-persistence JSON hash verification; UPDATE/DELETE guards including actor/version/approval authority; complete-chain/second-deploy no-op; legacy hashes unchanged; malformed/oversize manifests; static-key denial; stale version/current/history pins; forged reviewer/media access; archived set; missing permissions/bytes; prototype/unknown field rejection; wrong Pokémon language/edition and exact number; representative-image mismatch; and false independence from one listing root. After commit-worthy code, lead appends the mandatory session record.

## Pilot and release boundary

Release candidate passes when a real sports and Pokémon packet can be rendered, explicitly reviewed by an authorized human, and queried through the same writer/loader in a disposable environment; publish/revoke/replay behavior must be demonstrated. The real source bytes, exact IDs, rights and exception coverage are required evidence. Synthetic package fixtures cannot satisfy that gate. Missing licensed reusable images can leave image coverage unknown; they cannot be filled by a retained listing photo assumption. A text-only pass is useful but does not satisfy the planned visual pilot.

The adapter's separate completion gate is one saved research attempt pinning the exact real publication, with independent applicability/identity/sold-price decisions and unchanged human description/cost/grade. Atlas compatibility and different-card two-way reuse are later independently demonstrated; this slice does not claim them.

Deploy disabled by default until schema, human review and consumer checks pass. Before the first publication/proposal write, application rollback can disable the new feature; retain the additive schema. After durable authority exists, rollback means disable new reads/writes and preserve publication/history/pins; do not drop the tables, remove guards or route consumers through a legacy approval substitute. A schema rollback or destructive set replacement is outside this slice. Existing unrelated intake remains available.

## Actual blockers versus parallel work

The implementation can start now. The first useful real publication is blocked by missing host persistence, full-review UI/writer, verified private source/media grants and a real pilot with valid existing taxonomy IDs. These are concrete deliverables above, not reasons to design a larger platform. Atlas transport auth/adoption blocks cross-app activation only; it does not block a local Inventory pilot. Provider higher-resolution/sold semantics and idle-versus-saturated intake proof remain separate existing workstreams and must not be represented as passed by catalog unit tests.
