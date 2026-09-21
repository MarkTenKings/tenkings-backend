# Pokémon pilot takeover: ingestion, review and publication packet

Prepared September 21, 2026. Read-only source/artifact audit at Inventory HEAD `297fd302b866286824fcea79b8f77c6d995ca3db`; application source `e286ea0a190bfdc6807fe8ca58c47b34c94b55c1`. The difference is documentation only. This packet creates no catalog authority, source import, review, publication, image permission or live inventory.

## Decision

The complete Legendary Treasures worksheet is prepared for a carefully observed **unreviewed** import. Actual current-key reconciliation and target-runtime checks must precede its one queue submission. Publication is not ready: the worksheet adapter creates cards/program only, and there is no qualified Pokémon preparation path for the two required marker/parallel rows and scopes. The current shared publication recipe covers **four cards**, not the entire 138-row roster.

No provider, database, application UI, storage, deployment, configuration, shared-host or ATLAS operation was performed. No tests, benchmarks or builds were rerun. Local work consisted of source reads, checksum/JSON comparisons, one PDF render, visual review and independent PDF coordinate extraction. The original source and retained evidence were unchanged. Root owns integration and SESSION_LOG.

## Verified identities and bytes

| Item | Verified value |
| --- | --- |
| Category / year / language | `POKEMON` / `2013` / `en` in the prepared recipe; year is present in the source copyright |
| Display/source label | `Black & White—Legendary Treasures` |
| Proposed exact SetOps key and parent program label | `Black & White-Legendary Treasures` |
| Normalized program key | `black-white-legendary-treasures`; a normalized key is not a database row ID |
| Publisher / manufacturer | `Pokémon` / null in the shared manifest recipe |
| Complete worksheet | 138 distinct printed numbers: `1`–`113`, then `RC1`–`RC25` |
| Shared-publication selection | `6` Snivy, `7` Servine, `RC1` Snivy, `RC2` Servine |
| Separate Radiant Collection program | Not established by this page; none is proposed |
| Current real draft/program/card/source/printing/scope/publication IDs | Not established in this audit; prepared wrapper retains null IDs |

The pinned original is [the retained Pokémon PDF](</Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260916-catalog-pilot-sources/pokemon-checklist.pdf>), acquired September 16 from `https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/bw11_web_cardlist_en.pdf`. This audit verified one page and the exact local byte stream; it did not reacquire or attest the current remote URL.

| Artifact in `docs/plans/catalog-pilot-20260916` unless stated otherwise | Bytes | SHA-256 rechecked September 21 |
| --- | ---: | --- |
| Retained `pokemon-checklist.pdf` | 2,227,474 | `d597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923` |
| `source-manifest.draft.json` | 2,852 | `32d69d353d106ce7fb909ec13ebce68c7448bcf7c29fa5fdd81c5689f567780a` |
| `pokemon-complete-checklist.unreviewed.json` | 47,364 | `e318dad8f283abb15c8d0a65736c81f1744a9d681c9bc3375836481c4d6345c1` |
| `pokemon-complete-import.unreviewed.json` | 211,681 | `a36171566277e391764aae473df273a3c5fe26e54d4faa53d7802c2843d65a21` |
| `pokemon-source-fact-use.proposed.json` | 607 | `815affeb960ee607937b999cda2fdb06d2e1c61e4eded81f22148f02b2df9c4b` |

Independent coordinate extraction from the retained PDF matched all **138/138 number/name/source-column tuples**, with zero mismatches. Full-page visual review confirms the marker legend, the distinct RC-number roster and RC11's filled rare star. All 138 wrapper rows match the transcription's names, numbers, markers, rarity and source columns; all retain null rookie, physical finish, collector denominator, edition, format and channel values.

Recomputed transcription totals are 81 `standard set`, 57 `standard set foil`, and 101 `parallel set` observations; rarity counts are common 37, uncommon 41, rare 13, rare Holo 30, rare Holo EX 12 and rare Ultra 5. Markers overlap. Sixteen repeated-name groups remain separate numbered identities, including Snivy `6`/`RC1`, Servine `7`/`RC2`, and Meloetta-EX `RC11`/`RC25`.

The last managed absence observation is **September 17 at 04:10:36.594Z**, receipt SHA `9c1a77a7993b8fd49f360e7d4ea82285845a83d80cd03ae5f102c22d70c55495`. It enumerated 242 set keys and scoped draft/job/source/card/legacy/reference/publication aliases, finding no Pokémon match. It is dated evidence, not today's absence proof. The earlier auth-database receipt with missing tables must never be substituted.

## What the evidence does and does not establish

The adapter matches declared source pins and validates every original input row before normalization can deduplicate it. It explicitly records `sourceBytesVerifiedByAdapter=false`, `transcriptionVerified=false`, `humanReviewed=false`, and `rightsVerified=false`. Browser parsing is a bounded shape/consistency check only. The fresh local hash and extraction above strengthen preparation evidence; they do not turn those unreviewed persisted claims into human authority.

For the existing four-card publication recipe:

| Card | `standard set` marker relationship | `parallel set` marker relationship |
| --- | --- | --- |
| 6 Snivy | supported literal marker | supported literal marker |
| 7 Servine | supported literal marker | supported literal marker |
| RC1 Snivy | supported literal marker | unknown |
| RC2 Servine | supported literal marker | unknown |

These six positive and two unknown relations concern the printed checklist markers. They are not physical finish confirmation. Missing RC parallel markers are not exclusions. No `6/113`, `RC1/RC25`, Reverse Holo, edition, format, channel or odds fact is introduced. `standard set foil` remains in the complete worksheet metadata but is outside this two-marker publication recipe.

The lookup implementation computes effective applicability as `unknown` while a printing's edition/format/channel is null, even when a literal relation is recorded as supported. Omitting language from a query also leaves language unresolved. It returns no candidate images unless effective applicability is supported. Adding photos alone therefore cannot qualify finish recognition. Explicit evidence must resolve those dimensions; never fill `not_applicable` merely to unlock images.

**Source facts and image permission are separate.** Current source-fact review V2 requires exact source hashes, factual purpose/scope, intended Inventory/Atlas consumers and actual human review; it does not require an invented blanket manufacturer license. The older grant-only wording in the pilot README, mapping and initial ingestion review is superseded by `source-fact-use-correction-review.md` and the current implementation. Preserve those historical files; this packet records the correction rather than treating them as a new owner-approval requirement.

The existing Pokémon fact-use proposal names card names, printed numbers and program membership. Before reviewing marker/applicability publication, explicitly include the literal marker vocabulary and positive row-marker relations in the proposed factual-scope detail. This is still an unreviewed proposal, not a legal attestation, PDF-distribution authority or image-use grant.

No pilot image was acquired or approved. A useful image addition requires separately documented `owned_original`, `licensed` or `permission` evidence, intended consumers, exact bytes/hash/MIME/dimensions, actual depicted card/printing identity, representative printing scope, visible source-supported diagnostics, and parent/source lineage. Model agreement, a selected comp, public accessibility, a PDF header graphic or a private intake image is insufficient. The same listing/image and its crop are not independent corroboration. Precision grading references remain separate.

## Exact operational sequence

These are next actions for the coordinating implementation/operator lane, not actions performed by this audit. Existing owner implementation authority remains in place; the genuine human evidence-review boundary remains required.

1. **Verify the actual target.** Use the qualified Inventory legacy Preview route `/admin/set-ops-review` on the exact deployment `tenkings-backend-nextjs-61fqqazwp-ten-kings.vercel.app` only after current deployment/configuration and normal human reviewer access are confirmed. The main-site host intentionally hides specialist SetOps. Handoff metadata records `SET_CATALOG_EVIDENCE_ENABLED=false`; do not claim the evidence APIs are usable or activate flags from this packet. Check taxonomy ingest separately: `TAXONOMY_V2_FORCE_LEGACY`, `TAXONOMY_V2_DEFAULT_ON` and `TAXONOMY_V2_INGEST` govern draft taxonomy creation, independently of the shared-catalog flag. Reconcile the current schema with the live ledger rather than assuming the old 96-migration fixture is today's schema.
2. **Take a fresh, bounded, read-only exact-key/alias snapshot.** Check drafts, every job status, source/program/card/parallel/scope rows, versions, approvals, legacy identity/reference matches and published aliases. Account for row limits; a signed-out response, missing schema, cap or 404 from the wrong route is not absence. Exclude concurrent imports/replacement/populate work on this set through create/build. If any matching identity exists, stop the new-set path and reconcile it; do not overwrite or delete it.
3. **Load the complete wrapper into Prepared checklist import.** Select `pokemon-complete-import.unreviewed.json`, not the original transcription or historical four-row request. Check set key, source URL/provider and 138 rows. The dedicated parser limits files to 768 KiB and sends exactly its serialized `requestDraft`. Generic upload intentionally rejects the envelope because it would rebuild source metadata.
4. **Queue once.** Use **Queue prepared checklist for review**, which sends `POST /api/admin/set-ops/ingestion`. Preserve the exact request body privately, its hash, target origin, time, actor reference, returned draft/job IDs and receipt. Do not preserve tokens. Expect one `QUEUED` job and one new `DRAFT` set before build. See uncertain-create recovery below before doing anything if the receipt is missing.
5. **Build once for the recovered exact job.** Use **Build Draft From Selected Job**, sending `{ingestionJobId}` to `POST /api/admin/set-ops/drafts/build`. Read the persisted result, not just HTTP status: require `taxonomyIngest.applied=true`, adapter `pinned-pilot-checklist-v1`, official checklist source bound to that job, one program, 138 cards, and zero variations/parallels/scopes/odds/conflicts/ambiguities/bridges. Require latest version row count 138, no blocking errors, draft and job `REVIEW_REQUIRED`, and no approved version.
6. **Capture a real postflight.** The current build response omits `taxonomyIngest`; ingestion GET returns selected source metadata but also omits it. A bounded read-only DB receipt must inspect `SetIngestionJob.parseSummaryJson`, exact source linkage and persisted row metadata, or a separately implemented narrow result/read surface must supply those facts. The build handler catches taxonomy errors and can still return HTTP 200 with a review version. A null/failed taxonomy result is not success. Build's `reviewedAt` timestamp is machine bookkeeping, not human review.
7. **Review the complete worksheet against the original source.** Use the full roster review and raw metadata alongside the visible worksheet; the table does not display every marker. If a factual correction is needed, use **Save New Draft Version** and retain prior version/hash plus the correction reason. The serializer preserves source metadata and unknown rookie values. It does not update previously created canonical cards/source rows; any visible correction that changes canonical identity needs explicit reconciliation before publication. Legacy `versionHash` excludes raw metadata and cannot approve its provenance.
8. **Close the printing/scope implementation gap before claiming publish readiness.** The desired narrow preparation adds only real `standard set` and `parallel set` rows plus two scopes against the source-backed parent program, with null variation/serial/format/channel. It preserves all 138 cards and source observations and grants no per-card/physical-finish authority. There is no qualified Pokémon endpoint for this today. The generic two-row marker input remains unsuitable; its earlier score was 53.85 below the unchanged 70 threshold, and the pinned adapter is worksheet-only. Do not pad rows, invent odds, select Topps as provider, reuse the sports stage endpoint or directly fabricate IDs.
9. **Complete ordinary human SetOps approval deliberately.** After worksheet/taxonomy reconciliation and inspection of every pending job attached to the draft, use the exact clean latest version. Existing `POST /api/admin/set-ops/approval` runs variant synchronization before approval and bulk-updates pending jobs for that draft; it is not a review-only checkbox. Preserve seed receipt/status and verify no active seed/replacement remains. A failed or ambiguous approval requires inspection of jobs, side effects and approval records before another action.
10. **Download current taxonomy and compile the narrow publication.** With the catalog feature deliberately qualified/enabled, use **Download taxonomy mapping** (`GET /api/admin/set-ops/catalog/taxonomy?setId=...`). It is a read-only snapshot, not approval. Run `prepare-pilot.mjs --pilot pokemon --taxonomy <real-export> --selection <exact-selection> --source-fact-use <reviewed-proposal-file> --out <new-private-directory>`. Fill selection with the exact real program, four card, two parallel, two scope and source IDs. No fuzzy mappings or synthetic IDs. Preserve export hash, latest clean draft/version/hash and predecessor/current pins. The compiler still publishes partial four-card coverage, no aliases and no images.
11. **Stage, validate, inspect, then publish.** Load `{manifest,reviewEvidence}` into **Reviewed shared catalog evidence**. Stage the exact retained PDF through **Stage source / image files**; 2,227,474 bytes fits the 3 MiB browser bound. Validate with `/catalog/preview`. The server rereads private checksum-addressed bytes, verifies full manifest/taxonomy/source/current-history authority and emits manifest and verification hashes. The authorized human inspects the complete original, all identities/relations/unknowns and intended uses, then deliberately selects the acknowledgement and **Publish reviewed catalog evidence**. Its request binds both hashes, expected current/history and `PUBLISH REVIEWED CATALOG EVIDENCE`. It is a separate publication approval, not the legacy draft hash.
12. **Verify the actual publication and its limits.** Record publication/revision/hash, verification V2/hash, approval/reviewer record, current pointer and immutable predecessor; load current publication through the normal API. Run bounded read-only Inventory and ATLAS-consumer lookup checks against that exact publication pin, including same-name/different-number controls and unresolved scopes. This is factual catalog availability, not full visual coverage, 138-card shared publication, enabled research qualification, >90% accuracy or different-physical-card cross-app acceptance. The latter still requires the separate ATLAS lead and real card evidence.

## Uncertain-create and partial-build recovery

The prepared UI synchronously latches the exact request within its mounted workspace, including failures. That latch is a React ref, not cross-reload durable idempotency. The backend performs draft upsert, job creation and audit sequentially without one transaction or request key. A timeout/error can leave nothing, a draft only, or a completed job without its client receipt. Reloading or reopening must not become a retry mechanism.

- Preserve the original request and attempt time. Read all jobs for the exact key using the singular `/api/admin/set-ops/ingestion`, including non-pending statuses; its `total` is returned length, not a full database count, and the maximum is 500. Match source/provider/parser/fetch metadata and then verify full persisted raw payload privately through scoped read-only evidence. The queue DTO alone cannot prove exact raw-payload equality.
- If exactly one matching job exists, recover its ID and continue from its actual state. Do not create another job. If it already has a version/taxonomy result, inspect that result before Build.
- If there is only a draft, zero/multiple candidates, an unmatched payload, concurrent changes or incomplete reads, preserve the state and report the exact ambiguity. A manual new submission is appropriate only after the coordinator establishes the prior attempt cannot still commit and reconciles any partial state. Do not auto-retry, delete, relabel or infer success from an empty UI list.
- Build is also a multi-step operation. Taxonomy may commit before version/job/audit updates; another Build may create another version. After an uncertain build, inspect the original job summary, linked sources/taxonomy, all recent versions, source links and audit records. Recover the persisted result; do not automatically requeue or rebuild.
- Shared publication has a different contract: same draft/revision, both hashes and same reviewer can return an exact replay; differing evidence or changed pins fail. Preserve that request and inspect current/history before any deliberate replay. Never generate a fresh revision merely to hide an uncertain publication.

## Next independent work and human inputs

| Owner/lane | Concrete useful next task | Completion evidence |
| --- | --- | --- |
| Root / catalog implementation | Implement a bounded Pokémon marker/scope preparation operation, following the existing sole taxonomy ownership and review lifecycle. Bind exact source bytes, job/source, program, draft/version and expected snapshot; use atomic writes, explicit request identity/replay, stale-state rejection and no publication. | Reviewable plan and focused tests for wrong pins, duplicate/stale state, rollback, exact replay, preserved 138 identities/metadata and pending-source visibility. No repeat performance matrix required for this initial admin-only task. |
| Root / API review | Expose or document the actual build taxonomy outcome and distinguish successful review-version creation from failed/skipped taxonomy. | Actual-handler case with HTTP success plus taxonomy failure cannot be mistaken for applied taxonomy; safe postflight includes adapter/counts/source/skipped reason. |
| Catalog preparer | Prepare the exact two-marker scope/source-fact packet from the retained PDF; keep selected four-card coverage and unknown dimensions explicit. | No synthetic IDs, broadened finish labels or implied RC exclusions. Explicit factual-scope wording includes the marker relations being reviewed. |
| Human catalog reviewer/approver | Inspect the original one-page source and complete 138-row draft, resolve actual alias/correction questions, then review the complete narrow publication and intended consumers. | Real authenticated approvals bound to the exact versions and full evidence hashes. An agent's transcription check is not this input. |
| Owner/reference contributor + catalog reviewer | Supply or identify useful genuinely permitted images and evidence resolving depicted identity, finish diagnostics and scope dimensions. | Separate image grant and byte/lineage review; original private intake media stays private unless explicitly authorized for this use. No generic request for a manufacturer license is needed for factual names/numbers. |
| Lead + ATLAS lead | Arrange later different-physical-card use in each direction once actual evidence is published and compatible readers are released. | Inventory evidence helps another ATLAS card, and an ATLAS contribution helps another Inventory card; original physical-card/accounting/grading authority stays separate. |

Standing qualification is retained: source adapter/compiler checks, the metadata-preserving actual-handler workflow, prepared-input mounted UI checks, private ingestion cache fix and e286ea0a hosted qualification. Their counts overlap and must not be summed into a new test total. This audit adds source-byte/roster verification and the concrete gaps above, not managed-database or real-human acceptance.

## Implementation references

- `frontend/nextjs-app/lib/preparedChecklistImport.ts`; `pages/admin/set-ops-review.tsx:1073` — prepared envelope and attempt latch.
- `frontend/nextjs-app/pages/api/admin/set-ops/ingestion/index.ts:188` — separate draft upsert/job/audit writes and bounded queue DTO.
- `frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:108` — original-input validation; `:191` taxonomy result; `:227` version/status writes.
- `frontend/nextjs-app/lib/server/taxonomyV2PilotChecklistAdapter.ts` — exact pins, original-input checks and cards/program-only output.
- `frontend/nextjs-app/lib/setOpsDraftEditor.ts`; `pages/api/admin/set-ops/drafts/version.ts`; `lib/server/setOpsDrafts.ts:735` — metadata preservation, immutable version creation and legacy hash boundary.
- `frontend/nextjs-app/pages/api/admin/set-ops/approval.ts:174` — automatic seed before ordinary approval; `:349` pending-job status updates.
- `frontend/nextjs-app/lib/server/setCatalogEvidence.ts:188`; `setCatalogEvidenceMedia.ts`; `setCatalogEvidenceAuth.ts` — full preview/publication, source-fact V2, independent image grants and human authority.
- `frontend/nextjs-app/components/admin/SetCatalogEvidenceReview.tsx`; `lib/server/setCatalogTaxonomyExport.ts` — real review UI, taxonomy export and staging controls.
- `docs/plans/catalog-pilot-20260916/prepare-pilot.mjs:40`; `packages/card-catalog-evidence/src/index.mjs:325` — four-card recipe and unresolved-scope lookup behavior.
- `docs/plans/catalog-pilot-20260916/source-fact-use-correction-review.md` supersedes historical grant-only factual-source prerequisites.
