# Shared SetOps catalog evidence contract

Date: September 16, 2026. Implementation base: `60572cec895ad63d4ab826cd366f6475b04e725a` in the isolated Inventory checkout. Status: **local contract foundation; no publication or persistence activation**.

Authority: [owner-approved blueprint, September 16 amendment](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md) and [reviewed improvement plan](2026-09-15-variant-and-sold-comps-improvement.md). The Inventory lead owns this initial SetOps contract/pilot. Atlas owns its adapters, originals, authentication/accounting, grading and separate release. The package does not authorize cross-checkout edits or merge the release lineages.

## Delivered boundary

`packages/card-catalog-evidence` is a versioned, dependency-free plain-JavaScript module usable in-process or behind an authenticated internal API. It provides full canonical manifest hashing, strict validation, exact candidate lookup, explicit supported/excluded/unknown applicability, separate source/applicability/image coverage, image/source lineage, actual depicted versus representative identity, and idempotent unreviewed observation proposals. The [package README](../../packages/card-catalog-evidence/README.md) and executable fixtures define the wire format and API.

No application reader/writer, intake path, provider, image acquisition, database schema, production data or Atlas adapter is changed by this foundation. No production authority is represented by the fixture reviewer/source IDs. Real-source sports/Pokémon review, storage implementation and both app adapters remain subsequent work.

## Evidence from existing source

| Current structure | Reuse | Limitation for new authority |
| --- | --- | --- |
| `SetDraft`, `SetDraftVersion`, `SetApproval` | Existing set/draft/version/reviewer identities and review workflow | Legacy `versionHash` omits `row.raw`; it does not bind new applicability, aliases, diagnostics or image facts stored there. |
| `SetTaxonomySource`, `SetProgram`, `SetCard`, `SetParallel`, `SetVariation` | Existing stable naming and identity records | A current row or source kind by itself does not prove complete-manifest review. Pin immutable manifest facts and actual source hashes. |
| `SetParallelScope` | Existing program/parallel/variation/format/channel relation | No exact-card exclusion/inclusion or language/edition authority. A flat program list cannot establish all card combinations. |
| `SetAuditEvent` | Existing human-visible audit trail | Its `requestId` is not unique and its metadata does not provide a publication/current-pointer or durable proposal-idempotency constraint. |
| `SetIngestionJob.rawPayload` and existing media storage | Source staging and existing private artifacts where their current contract applies | Unbound raw JSON, retained flags, URL ownership or legacy approval cannot automatically authorize new reusable imagery. |

Checked source: `frontend/nextjs-app/lib/server/setOpsDrafts.ts:createDraftVersionPayload`, `pages/api/admin/set-ops/approval.ts`, `lib/server/staffInventoryResearchReferences.ts`, and the named Prisma models. The existing approval route seeds/synchronizes before inserting its approval and then updates draft/jobs separately. It is not already the atomic full-evidence publication transaction described below. Do not describe this new contract as live merely because that route or approved SetOps rows exist.

## Concrete storage design before publication

Reuse all existing SetOps identities and ordinary staff/admin authorization. Preserve legacy data shapes and `versionHash` exactly. Do not overload that hash or attach new authority solely to `row.raw`, `metadataJson` or `diffSummaryJson`.

The smallest proposed durable publication extension is **one append-only `SetCatalogEvidencePublication` record per reviewed manifest**, plus a nullable current-publication pointer on the existing `SetDraft`:

| Publication field | Meaning |
| --- | --- |
| `id`, `draftId`, `draftVersionId`, `setApprovalId` | Server-owned ID and existing SetOps authority links; restrict deletion of referenced history. |
| `schemaVersion`, `revision` | Exact parser contract and monotonically increasing revision per existing draft. |
| `manifestJson`, `manifestSha256` | Entire validated bounded manifest and server-computed SHA-256 over UTF-8 canonical JSON. |
| `supersedesPublicationId` | Exact prior publication; manifest also binds its set/revision/full hash. Null only for first revision. |
| `reviewedById`, `reviewedAt` | Actual authorized human session and server time, retained immutably. |

Required database constraints: unique `(draftId, revision)`, at most one successor per prior publication, reference integrity, append-only UPDATE/DELETE guards, and a current pointer that can reference only the same draft. A short row lock on `SetDraft` serializes publication and current-pointer changes. The pointer is availability, not a duplicate mutable catalog. Existing set archive state also gates reads. Revocation clears the pointer and appends an existing SetOps audit event in the same transaction; it does not delete the historical publication. Supersession installs a new immutable row and changes the pointer atomically.

This storage is a **proposal requiring coordinator integration and the normal additive migration checks**, not an applied migration. Existing schema does not safely provide these guarantees merely by embedding JSON. If the coordinator chooses a different equally bound storage mechanism, record it before enabling publication. A historical raw payload must never be retroactively interpreted as having this authority.

Idempotent cross-app proposal persistence also needs a real uniqueness boundary. Reuse an existing app-specific durable observation record only if it demonstrably enforces `(producer, observationId, inputRevision)` uniqueness and exact payload-hash replay. `SetAuditEvent.requestId` alone cannot do so. If no such record exists for the shared submission path, add a small append-only `SetCatalogObservationProposal` record with that unique triple, proposal JSON/hash, server submission actor/time and optional linked publication ID in a separate review result. It is a review inbox record, not a crawler/job engine or another editable catalog. This package's `new/replay/conflict` helper performs no persistence and cannot by itself prevent concurrent duplicate inserts.

## Human approval transaction

1. Prepare source bytes, clean text data, image bytes and candidate manifest outside any inventory/save or publication transaction. Use existing safe private media handling. Verify exact source/image hashes and media access/usage permissions. No network work is held under a database lock.
2. Present the exact full manifest/hash, original source excerpts, aliases, all applicability changes, partial/truncated coverage, depicted image identity, representative scope and visible diagnostic claims to an authenticated SetOps human approver. Machine output, old approval, comp inclusion, grade completion and Atlas defect-memory acceptance are not this review. The existing static batch-import capability must not silently stand in for human review of new reference evidence.
3. The submitted action names the expected draft version, current publication pin and full manifest SHA. Derive reviewer authority from the existing server session/role checks; ignore caller-authored reviewer/approval/trust fields. Recompute validation and hash on the server.
4. In one short transaction, lock the exact draft, confirm it remains eligible/non-archived, verify expected current pointer and draft version, and validate every referenced SetOps program/card/parallel/variation/scope ID against that draft/set. Confirm source classification/bytes, media grants/hash checks and the exact prior publication link. Bind the explicit new manifest review to an existing or newly inserted `SetApproval` for that exact draft version. The legacy approval hash keeps its original meaning.
5. Insert the immutable publication with server reviewer/time, read it back and recompute the complete hash. Only after exact equality may the current pointer move. Append the existing SetOps audit event containing publication ID/full hash and superseded ID. Commit all or none. Duplicate retries return only the exact prior result; same expected version with changed content conflicts.
6. A server-composed `loadAuthorizedPublication` resolves the pointer and existing authorization, then loads the exact immutable manifest and original review binding. The package independently verifies its pin, state, draft/version, full hash and shape. A missing/revoked/superseded or mismatched binding fails closed. Only a separately authorized audit read may expose historical revisions; ordinary lookup cannot select a newest/nearby/fallback record.

The host boundary is deliberate. Pure JavaScript cannot authenticate a database row, reviewer or original photo. The library accepts no request-supplied loader/authority and offers no JSON `approved=true` bypass; a host that fabricates its loader results violates the integration contract. HTTP consumers must authenticate the server/app transport and treat opaque media references as requiring their own authorization. A copied JSON `authority` label is not a signature or access grant.

## Lookup, evidence and contribution rules

- Preserve the existing SetOps set/program/card/parallel/variation/scope IDs. Printing IDs hash their exact category/set/program/parallel/variation/language/edition/format/channel identity, excluding mutable display labels. New language/edition/scope produces a different printing ID; revisions identify corrections without rewriting earlier evidence.
- Canonical hashing covers every field, ordered array, source and image, including all lineage and the previous revision pin. JSON object key order is irrelevant. No Unicode normalization, floating-point coercion or unknown-field omission occurs at this boundary.
- Lookup uses exact scope and minimal Unicode NFC/case/whitespace text comparison. Significant card-number prefixes, denominators, zeroes and punctuation remain. Only explicit source-backed aliases may change spelling; collisions remain multiple candidates. No nearest-product/name-only resolution certifies identity.
- Supported/excluded/unknown applicability is per exact card/printing. Missing relationships and incomplete query/printing dimensions remain unknown. A `not_applicable` dimension must be justified by the reviewed source and is never a wildcard. Returning one candidate, or fewer than the whole set, cannot establish identity by elimination.
- Text, applicability and image coverage carry independent complete/partial/truncated/unknown status. Response truncation reports total and returned counts separately. v1 supports no elimination logic even if full coverage is declared; positive diagnostics remain evidence for the consuming app's explicit identity review.
- Each image binds source and parent image identities, hash/dimensions/side, actual depicted card/printing, representative printing scope and reviewed visible diagnostics. A representative image may depict another card. Its existence does not create applicability, public permission, precision grading authority or automatic image promotion.
- Source graphs and image parent graphs must be acyclic. Roots include byte hashes and stable listing/physical-observation origin keys. Reused/cropped/syndicated evidence and the same listing-derived guess cannot be called independent corroboration. Distinct declared roots remain subject to external provenance review.
- Proposal producers/physical-card references are bound by each authenticated app, never accepted as proof from the body. Full-payload hash and unique input-revision key make retries exact; changed input produces a new observation. Submission never changes catalog, original photos, saved description, grade, costs, public comps or value.

## Integration and acceptance still required

1. Coordinator selects/implements the durable authority mechanism above; complete its reviewed migration chain, append-only, concurrency, rollback/read-back and exact-idempotency checks before enabling any publication. No migration or production write occurred in this contract task.
2. Prepare one real demanded sports product and one Pokémon set from actual accessible authoritative sources. Preserve source bytes/hashes, record partial coverage and card/program exceptions, and explicitly review useful reference images and look-alikes. The synthetic fixtures are not this pilot.
3. Add the Inventory adapter as optional after-save research only. Pin the exact publication in each existing research attempt/history; deliberate bounded affected-input reruns use existing writers/budgets. Preserve current intake/save/enqueue and price/grade authority. Do not add awaited catalog/media/provider work to intake.
4. Exchange a reviewed package delta and executable fixtures with exact base/result commits and file hashes. Atlas builds its own adapter and independently verifies original-image authorization, category mapping, paid work and grading boundaries. Fixture compatibility is distinct from both-direction reuse on different real physical cards.
5. Verify paired idle/saturated intake responsiveness before any additional background load/release. Package tests establish pure contract behavior only; they do not establish source coverage, physical accuracy, production authorization, Atlas parity or the all-card >90% result.

Local validation: `node --test packages/card-catalog-evidence/tests/*.test.mjs`. The suite covers sports/Pokémon hashing and binding, exact numbers and alias collisions, wrong scope, partial applicability/coverage, representative identity, circular/shared evidence, supersession, hostile fields, authorization boundary and proposal replay/conflicts. No external calls or business writes are made.

Observed local result: **25/25 passing on Node 22.23.2**. The compile-only self-package consumer fixture also passes TypeScript 5.5.4 strict NodeNext checking, including immutable result types and refusal of caller-authored approval fields. This checks the shared API only; it is not a production/app build or live performance acceptance.
