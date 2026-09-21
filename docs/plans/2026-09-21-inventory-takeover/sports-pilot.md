# Sports pilot takeover packet — September 21, 2026

Status: read-only audit and next-action packet. The narrow Big Kahuna pilot has qualified preparation code and retained real source evidence, but no actual staging or publication receipt. It can proceed without importing the 171 unnumbered entries or replacing any of the 379 numbered card identities. One small parent-page selection defect must be resolved for the intended UI path. Actual human source review remains required.

**Root follow-through, September 21:** the parent selection defect described below is now repaired locally, with separate catalog selection, late-import protection and visible target text. Seventeen focused UI checks, scoped lint and changed-file type checks pass; independent final re-review found no actionable issue. It is not deployed. The source audit and its original hashes below describe the handed-off `e286ea0a` application; use the [active delivery index](README.md) for the later local repair status.

Audit checkout: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, HEAD `297fd302b866286824fcea79b8f77c6d995ca3db`; application `e286ea0a190bfdc6807fe8ca58c47b34c94b55c1`. This lane changed only this file. No provider, DB, hosted API, UI, configuration, deployment, shared-host or ATLAS operation occurred; no test suite was rerun. Root owns SESSION_LOG and integration.

Required context was read, including the full 1,749-line approved blueprint in bounded chunks, both runbooks, current relevant handoff/log sections, and the September 21 lead handoff/state JSON. The September 16 blueprint amendments authorize the shared catalog work; they do not substitute for the explicit human publication boundary.

## Verified scope and preserved identities

Set `2023_Bowman_University_Chrome_Football`; existing draft `2e8b2265-edcb-4910-922f-40a6e926ac38`; latest clean version 6 `52de475c-ee6a-4abf-b148-fffde0ec93af`; legacy version hash `48314036838b6a481e87633c1b659541ca0a158ae91d7145e675fc5fb8292a1b`. Program `the-big-kahuna`, row `0f33785b-11d2-4abe-abb8-ad567a1a63ab`.

| Card | Existing canonical ID |
| --- | --- |
| TBK-1 Caleb Williams | `e5d38533-201e-4e4e-9d9b-11bc368050a7` |
| TBK-2 Drake Maye | `aa34c51c-adee-4272-bea0-d8f7ca3ab8a1` |
| TBK-3 JJ McCarthy | `d6dde801-2673-46e1-8830-5d810b0c9ade` |

The preparation preserves the complete 379-card, ten-program and six-version ID rosters. The retained September 17 count-accounted source reconciliation matched all 379 numbered rows by exact program, number and name. The 61 rows in version 6 are its `PARALLEL_DB` dataset, not a reduced card roster. There is no new 61-versus-379 blocker.

Selected vocabulary: ordinary `THE BIG KAHUNA` with unknown serial denominator; `Orange Refractor` with denominator 25; `Superfractor` with denominator 1. Nine selected card/printing relationships remain `unknown`, with no supporting or excluding source IDs. Language, edition, format and channel remain null/unknown. The odds source establishes program vocabulary and stated denominators, not card-level availability or inferred physical finish. All other cards and printings are omitted, not excluded.

The full 550-row transcription remains useful retained evidence: 379 numbered rows plus 171 unnumbered entries across five autograph heading groups. No borrowed base numbers, invented IDs, full-set replacement or unreviewed school correction belongs in this pilot. The four existing school fields containing a merged `1st` marker remain separate review work.

## Current corrections to historical pilot notes

Read these records chronologically; preserve their historical bytes:

- `catalog-pilot-20260916/README.md` and `sports-publication-pilot-review.unreviewed.md` still describe manufacturer license/permission as a blocker for factual checklist use. `source-fact-use-correction-review.md`, `sports-source-fact-use.proposed.json`, the current compiler and current host supersede that wording. Use the explicit V2 factual-use path; no blanket manufacturer license claim is required for this facts-only packet.
- `sports-preparation-service-review.unreviewed.md` retains a warning from before the parent Build Draft correction. The actual handler now rejects parser `catalog-sports-additive-preparation/v1` before resolving or mutating a draft (`frontend/nextjs-app/pages/api/admin/set-ops/drafts/build.ts:98`).
- The eight proposed taxonomy creates now have a qualified implementation that additionally creates two isolated source jobs and one immutable audit receipt. It is built in the Preview application, not already staged in the real database.
- Runtime/DB facts must still be refreshed at actual execution. Local artifact hashes prove retained bytes, not today's database eligibility, official source authority, human review or image permission.

## One newly found UI integration defect

At the audited application, the intended first real sports UI preparation is not reachable from an existing set with no pending jobs:

1. `SetCatalogEvidenceReview` is passed `selectedSetId` at `frontend/nextjs-app/pages/admin/set-ops-review.tsx:2099`.
2. Selecting an existing Set ID in `selectSetIdOption` updates `setIdInput`, but never `selectedSetId` (lines 766–789).
3. The ingestion table always requests `statusGroup=pending` (lines 701–715). Its row-click handler can set `selectedSetId`, but the retained real sports snapshot has six APPROVED and two FAILED jobs, zero pending jobs.
4. The other setters are successful generic Build Draft or the Pokémon prepared import; neither is an appropriate sports bootstrap. There is no query-string set-ID hydration.
5. `SetCatalogSportsPreparation` returns null unless its `setId` is the exact sports key. Consequently the sports panel remains hidden and taxonomy download remains disabled after ordinary existing-set selection in that state.

This is a source-level finding against the retained real initial state, not a fresh hosted reproduction. It is independent of the default-off feature gate. Root should make a small reviewed parent-page selection fix and a focused regression for selecting the existing sports set with an empty pending queue. Preserve draft/editor context on set changes; do not queue a fake job, rebuild the existing draft, inject browser state or fabricate a live import to reveal the panel. Existing child-mounted tests pass a set ID directly and do not cover this parent selection path. The seven PostgreSQL tests need not be repeated for a parent-only selection fix.

Recommended fix: a distinct explicit `catalogSetId` updated by a verified existing-set dropdown choice, existing job selection and successful prepared import, and cleared on create-new selection, manual set-text edits and Clear Selected Job. Pass that selection to the catalog panel without changing legacy `selectedSetId`, version or draft/editor bindings. Do not derive it from `activeQueueSetId`, which prefers an old selected draft over newly entered set text. The regression should also start with another legacy draft/version already loaded, choose Bowman with no pending jobs, and verify that only the catalog target changes while legacy mutation bindings remain intact. Root owns this implementation; this audit makes no code change.

## Exact next preparation, review and publication sequence

The work is already authorized by the approved delivery plan. These are concrete execution conditions and human evidence decisions, not a request to reapprove that plan.

1. **Root resolves the UI issue and qualifies the actual target.** Use the legacy specialist route `/admin/set-ops-review` on the qualified Inventory deployment, whose recorded immutable origin is `https://tenkings-backend-nextjs-61fqqazwp-ten-kings.vercel.app`. The stable main hostname intentionally hides specialist SetOps routes. If the small fix creates a newer deployment, use its verified exact source/origin instead. Require normal human sign-in, current `reviewer` authority for staging/preview and `approver` authority for publication. Static operator keys and service sessions cannot authorize this workflow. `SET_CATALOG_EVIDENCE_ENABLED` was false at handoff; root must qualify its deliberate activation on the intended artifact/environment, including compatible live schema and the immutable catalog audit trigger. A past disposable 96-migration run is not a claim about the current live migration ledger. Keep optional research/consumer flags separate. No new cron owner or auth-token transfer is needed.
2. **Coordinate the narrow staging window.** Exclude card/program populate scripts, draft import/replacement and competing set maintenance while staging. The service locks `SetTaxonomySource`, `SetParallel` and `SetParallelScope` tables plus the exact draft row; it does not universally serialize direct card-only maintenance. Its table locks span sets, allow ordinary reads, and fail within the 750 ms lock timeout rather than waiting indefinitely. Any shared-host maintenance coordination belongs to root; this lane does not claim a current exclusive window.
3. **Select the existing exact sports set and expand “Reviewed shared catalog evidence.”** After the parent fix, confirm the panel actually receives that exact key. Do not create a new set. Under “Stage source / image files,” choose the two retained PDFs listed below. Upload only those exact files. Each is below the actual browser limit of 3 MiB; the host artifact reader limit is 4 MiB. Record returned `catalog:sha256:<hash>` refs. File staging stores private bytes but is neither factual approval nor catalog publication.
4. **Use “Preview missing mappings.”** Its GET `/api/admin/set-ops/catalog/sports-preparation` independently verifies both staged source bytes before starting the read-only snapshot. Require exact preserved rosters, active APPROVED/unarchived draft, exact latest clean version, no publication, no active seed/replacement and unoccupied proposed keys/URLs. The expected creates are two pending jobs, two sources, three parallels and three scopes. Capture the proposal/snapshot hashes and all nine unknown relationships. A changed identity/version/occupied target stops for reconciliation, never upsert or repair.
5. **Use “Prepare pending mappings” once.** The UI retains exact UUID/request bytes before POST; its acknowledgement is `PREPARE PENDING SPORTS CATALOG MAPPINGS`. The fixed proposal digest is `4484129eabafbad247c8be01bde777b389ee2071cc28e64de4834e1b8796db04`. Successful stage returns ten created IDs and one immutable receipt audit, with no card/program/version/image/applicability/approval/publication writes. Download “Download preparation receipt.” New jobs remain `REVIEW_REQUIRED`, `draftId=null`, with null `parsedAt`/`reviewedAt`; every new source has a real non-null job binding. This deliberately keeps them outside legacy bulk approval and legacy approved-source readers.
6. **Handle uncertainty by exact replay.** Use “Retry same preparation” with the original reviewer and preserved request, including after same-tab reload. Do not clear pending storage, change accounts/keys or automatically restage. Only typed 409 `SPORTS_PREPARATION_SNAPSHOT_STALE`, echoing the exact rejected key and expected snapshot hash, permits a new manual preview; the UI preserves the rejected bytes separately. Other conflicts/timeouts keep the original request. Replay verifies existing created rows and refuses to repair drift.
7. **Download the fresh taxonomy mapping.** Use “Download taxonomy mapping” after stage. Preserve its exact `setops-catalog-taxonomy-export/v1` bytes/hash outside Git and reconcile the receipt IDs to its exact source URL/classification, parallel and scope entries. Do not use the older raw SQL observation as a forged compiler export. Do not run ordinary “Approve” or “Build Draft From Selected Job” for the two preparation jobs. The separate publication transaction is the review authority and does not promote these ingestion jobs.
8. **Compile the unreviewed V2 packet locally.** Run `prepare-pilot.mjs --pilot sports --taxonomy <fresh-export> --out <new-private-directory>` to obtain `selection.template.json`; fill its exact keys from the real export: `programRowId`, `cards.TBK-1/TBK-2/TBK-3`, `printings.ordinary/orange/superfractor.parallelRowId` and `.scopeRowId`, and `sources.sports-checklist/sports-odds-round2`. Use the known preserved card/program IDs above only after export equality is confirmed, and the new source/printing/scope IDs only from the genuine export/receipt. Then run the command below with a second unused output directory. It emits `candidate-manifest.unreviewed.json` and the exact `{manifest, reviewEvidence}` UI packet. The compiler verifies all three retained source PDFs, including the unrelated Pokémon pin, but the sports packet contains only its two sources. Keep all existing source files intact.
9. **Load and validate the packet.** “Load review packet JSON” → choose `review-packet.unreviewed.json` → “Validate and prepare full review.” The latter is a non-publication POST to `/api/admin/set-ops/catalog/preview`; the host rechecks staged bytes, all canonical IDs, classification/URLs, latest clean version and current/history pins. Review coverage separately: text partial, applicability partial with all nine exact relationships unknown, images unknown with no images. Inspect both displayed full manifest and verification hashes.
10. **Actual human evidence review.** The approver must inspect the full original sources using “Download full source” (binary PDFs are not rendered as text), including checklist page 10 and Round2 odds page 2; inspect the complete set/program/card/printing/applicability/alias sections and the “Source classification, fact use and image reuse grants” section. The V2 source entries must bind each exact source hash, `purpose=catalog_facts`, its scoped `detail`, and intended consumers `inventory` and `atlas`. This is internal factual use, not PDF distribution, image ownership or a legal attestation. Leave images empty and all unknowns honest. The human then checks the actual UI acknowledgement quoted below. Automation must not claim it performed that human judgment.
11. **Publish once through the separate button.** “Publish reviewed catalog evidence” sends the complete manifest/reviewEvidence, preview `manifestSha256`, `verificationSha256`, `expectedCurrent`, `expectedHistory`, and acknowledgement `PUBLISH REVIEWED CATALOG EVIDENCE`. The server binds its current human approver and atomically persists approval, immutable publication, hash readback, audit and current pointer. There is no approval through the legacy version hash alone. If pins change, prepare and review again; do not force an old packet current. Preserve the response and both hashes outside Git. The server supports exact same-reviewer revision replay; the review component does not retain a pending publish body across reload, so keep the exact packet/preview evidence and inspect current publication after an uncertain outcome before any retry.
12. **Verify the limited outcome.** “Load current publication” and a bounded authorized lookup should return the exact new current publication and the intended selected candidates with unknown effective applicability, no images and no exclusion by omission. Compare the existing identity rosters and preparation receipt, confirm pending source jobs remain isolated, and record observed readback in SESSION_LOG. Keep V2-capable verification readers after any V2 record exists; flag-off does not rewrite old publications. Enabled Inventory research behavior and different-physical-card ATLAS reuse remain separate acceptance work, coordinated through the respective leads.

Compiler command, from the authoritative repository and with genuine locally saved paths:

```sh
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node \
  docs/plans/catalog-pilot-20260916/prepare-pilot.mjs \
  --pilot sports \
  --taxonomy /absolute/private/fresh-setops-catalog-taxonomy.json \
  --selection /absolute/private/exact-sports-selection.json \
  --source-fact-use docs/plans/catalog-pilot-20260916/sports-source-fact-use.proposed.json \
  --out /absolute/private/new-unused-sports-review-output
```

The human acknowledgement label is exactly:

> I reviewed the complete identities, aliases, applicability and unknowns, original sources, intended fact use or recorded source grants, and image identities, diagnostics and reuse grants.

The UI has no general source-fact editor: correct the local unreviewed packet, reload and validate it when a factual-scope decision changes. The reviewer must not set `humanReviewed=true` in source metadata as a substitute for this server-owned approval.

## Image permission gaps versus factual gaps

Facts-only publication can be useful vocabulary, but it will not establish reliable finish recognition. An identity-only manifest with no printings yields no lookup candidates; the selected three real printing scopes are therefore useful. No reference images have been acquired, reviewed or published for this pilot.

| Gap | What is actually needed | What does not fill it |
| --- | --- | --- |
| Source-fact review | Human review of pinned names/numbers/program vocabulary and V2 factual-use consumers/scope | Manufacturer license language invented for factual names; a hash alone; model agreement |
| Exact card/printing applicability | Independent affirmative evidence for any relation promoted to `supported`; otherwise retain all nine `unknown` | Program odds, missing alternatives, title similarity, or a guessed Cartesian product |
| Image identity and diagnostics | Exact original image bytes/provenance; actual depicted card and printing; supported depicted relationship; reviewed representative printing scope; genuinely visible diagnostic features | Naming an image “Orange,” screenshotting the PDF, or a same-listing guess treated as independent corroboration |
| Image permission | Real `grant.basis` (`owned_original`, `licensed`, or `permission`), specific `detail`, and explicit `consumers` roster for each proposed image | The source `factUse` roster, publicly visible marketplace photos, or possession of a manufacturer PDF |

The current manifest validator requires each image's depicted card/printing pair to have explicit `supported` applicability. Thus an image cannot simply be attached to this all-unknown packet, even after permission is obtained. A useful follow-up image revision needs separate evidence for the depicted relationship; other relations may remain unknown. If the photo depicts another card, include that real canonical card with its supported depicted relation in a separately reviewed revision rather than mislabeling it as TBK-1/2/3. No exact-image expansion across the whole set is needed.

Required image fields are `imageId`, checksum `mediaRef`, `sha256`, MIME type, decoded width/height, role, source IDs, parent-image lineage, `depicted.cardId/printingId`, `representsPrintingIds`, and `visibleDiagnosticIds`. Diagnostics must belong to the relevant printing and cite source evidence. The UI separately displays actual depicted identity versus representative finish and blocks review if any proposed image fails to render. The factual compiler currently emits no images; an image-enabled packet is additional explicitly reviewed preparation, not a flag on the existing recipe.

An owner-original photo can address permission only when its ownership/reuse scope is actually documented; it does not automatically prove card identity or printing applicability. Inventory originals, ATLAS originals and their physical cards remain private, distinct app records. Do not copy either app's photos into shared reference authority merely because they are accessible. Shared references are not ATLAS grading/defect-memory or precision centering authority.

## Retained artifacts verified in this audit

Private root: `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations`. Source URLs below are the exact recorded provenance URLs; no network fetch or current availability claim was made.

| Artifact | Exact bytes / SHA-256 | Review use |
| --- | --- | --- |
| `20260916-catalog-pilot-sources/sports-checklist.pdf` | 529104 / `bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca` | [Recorded manufacturer checklist](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf), page 10, source ordinals 506–508 |
| `20260916-catalog-pilot-sources/sports-odds-round2.pdf` | 265208 / `72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5` | [Recorded Round2 odds](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFootballRound2Odds.pdf), page 2 |
| `20260917-sports-reconciliation/managed-snapshot.json` | 112666 / `c042a3fd5b1c5fb25c8bc218f7125663fca49ab29382d8a97d4fdce9b0523bdc` | September 17 real read-only snapshot, including 379 IDs and zero pending sports jobs |
| `20260917-sports-reconciliation/version-shape.json` | 1448 / `678c9398d4b96c938b18c52f6246eed1281f5616e9ec7e9f1b770378f63d0af1` | Derived-only version 4/6 PARALLEL_DB count receipt |
| `20260920-sports-cron-qualification/manifest.json` | 9339 / `8b315aa08c5a9c232c62318abef35d11cb262a35da0350748ad6bfdcca473b7c` | All 44 members rehashed, zero mismatches |
| `20260920-sports-cron-qualification/tenkings-sports-preparation-run-20260917-01/launch-seal.json` | 77853 / `3697f8189ea45a526fa6aaba098285e58c593659b5866c14494359150eadf9f6` | All 415 sealed repository source files rehashed, zero mismatches |

The retained run summary records seven passing real owned-PostgreSQL TAP entries, actual fail-fast table locks, all eleven rollback insertion positions, same-key concurrent replay, unchanged 379/10/6 identities, pending source FKs/legacy invisibility, immutable audit and tamper denial. `functional_integration_pass=true`; `release_pass=false`; `performance_pass=false`. Cleanup records all five owned process groups/PostgreSQL stopped and owned temporary data removed with no errors. This audit read those receipts; it did not start PostgreSQL, rerun the sports suite or repeat the completed timing matrix.

Current repository pins rehashed:

- `frontend/nextjs-app/lib/server/setCatalogSportsPreparation.ts`: `1dbef7813581f6d81d27813804a438d011b40f8c30816f95988f9a7777974c0e`.
- Adjacent `setCatalogSportsPreparationPlan.json`: `a55049f53594d67b25bf3752db4664b7741e72aec8392d03cb6cda619d88699d`.
- `docs/plans/catalog-pilot-20260916/sports-publication-pilot.unsubmitted.json`: `3b27da05143c281ca3bf1905b22d19bb4c57e306caeefdea7582fb6be07c6664`.
- `docs/plans/catalog-pilot-20260916/sports-source-fact-use.proposed.json`: `684f017645b5cd2ed237e5d0b442c9c809e3d5932ab50862fcc1c392ad726bb7`.
- Unrelated untracked `docs/plans/2026-09-10-atlas-staff-intake-reuse-update.md`: `6166a6332e32cb380247358ef9040c0ad2e04a6a46f0448c632c42658fcfdb2d`, unchanged. Do not absorb it into this task's commit.

Implementation sources inspected include the preparation service/plan, actual stage API, sports child and parent evidence-review UI, enclosing SetOps page, generic Build Draft guard, taxonomy exporter, compiler, V2 media/fact-use schemas, actual publication transaction, manifest/lookup image contract, preparation/API/PostgreSQL tests and retained run summaries. Current application source supports the sequence and limits above; passing child tests do not close the parent-page defect.

## Work that can proceed now

- Root can fix and narrowly verify existing-set selection while phone acceptance remains pending. This does not need another broad plan approval or rerun of the seven SQL tests/performance matrix.
- Prepare the human's source-reading packet from the already retained files and the exact page/row references; collect concrete factual-use feedback without claiming approval.
- Prepare an image acquisition specification that separates actual depicted identity, diagnostic evidence and documented reuse scope. Obtain real candidate evidence only within an explicitly bounded assigned action; no new provider research occurred here.
- Independently review the four school-field discrepancies and investigate the 171 source-only rows later; neither blocks the three-card pilot.
- After actual staging supplies real source/printing/scope IDs, compile the complete unreviewed packet immediately. Final human review then concerns exact reviewable content, not hypothetical future mappings.

Completion still means actual reviewed publication and the separately qualified consumer/image acceptance. This packet does not claim production activation, a useful image, a confirmed finish, ATLAS parity or the greater-than-90-percent all-card comp target.
