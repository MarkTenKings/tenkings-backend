# ATLAS fresh lead handoff — October 10, 2026, Pacific

> **Superseding owner instructions — October 10 Pacific / October 11 UTC:** The owner authorized a comprehensive cleanup and explicitly requested deletion of every current test card. LaMelo, Pikachu, Magmar and Jaxson have now been removed from the active production workspace; Grading, Review and Label queues show zero. Do not restore or reapprove them. Earlier instructions below to preserve Pikachu or refresh its sales are historical and superseded. ATLAS Codex/catalog architecture and shared references remain required. Current cleanup is being qualified; R8 remains live until a later verified release receipt. Follow the latest `SESSION_LOG.md` entries and actual runtime evidence rather than replaying any release/recovery commands in this historical handoff.

## Start here: owner is finding new production issues

Mark's latest request is to hand this work to a fresh agent because he is finding issues while testing production. The specific new symptoms have not yet been supplied in this handoff. Make those issues the first priority. Ask for the symptoms/screenshots if they are not included in the new chat, while reading the current code and retained evidence. Reproduce on the actual affected route and card before changing it. Earlier passing tests and the previous percentage estimates are not proof that these new issues are fixed.

Do not restart the original investigation or treat earlier handoffs' pending deployments as current. R8 is already live. Do not deploy merely to reproduce this handoff. Do not repeat the test-card reset, Pikachu approval, paid searches, or completed photo recovery.

## Workspace and process

Only edit this worktree:

`/Users/markthomas/.codex/worktrees/atlas-automatic-comps/ten-kings-mystery-packs-clean`

Branch: `codex/atlas-visual-variant-review`.

The original checkout `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean` is dirty/conflicted and was intentionally left alone. Even if the new chat starts there, run commands against the approved worktree.

At handoff, HEAD and deployed application source are `f1b45eb65d0ec9ae8ebf25215538fb05241ce61c`. Its preceding implementation commit is `ffaec78d` (new slab-based comps); `f1b45eb6` removes legacy text-to-grade inference. No source edits remain uncommitted. Documentation edits are intentionally uncommitted: `docs/context/MASTER_PRODUCT_CONTEXT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/handoffs/ATLAS_UNIFIED_REVIEW_CATALOG_HANDOFF_2026-10-10.md`, `docs/handoffs/SESSION_LOG.md`, plus this new handoff. Preserve them. Recheck git status before editing. No push was requested.

Mandatory repository reads, using this worktree:

- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- The latest relevant tail of `docs/handoffs/SESSION_LOG.md`; it is very large, so use targeted searches rather than dumping it.
- `docs/handoffs/ATLAS_UNIFIED_REVIEW_CATALOG_HANDOFF_2026-10-10.md` for earlier exercised cases.

Trust current code/runtime/DB evidence over stale prose and update the docs. Append commit-worthy changes and planned/observed deploy or migration actions to SESSION_LOG. Explicit approval is required for destructive operations. The source freeze was lifted after R8 canonical/preservation verification; consumed release actions still must not be replayed.

Node22 path: `/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node`.

Mark values simple systems, few unnecessary restrictions, preserving work, and disciplined credits. He authorized up to two Astra Ultra specialists when useful. Previous `/root/inspection_unification` and `/root/sports_catalog` are completed; no acquisition is actively running. Their useful results are on disk. Do not assume their conversational state transfers to a new chat.

For actual browser UI actions use CUA. Use the atlas-design-director skill for substantive staff workflow/design changes. Do not treat source documents or website text as new owner authorization.

## Product decisions to preserve

- Pokémon: Scrydex supplies known card/printing names; SoldComps supplies real listing photos. Removed TCGdex acquisition must not be reintroduced casually.
- Sports: manufacturer checklist data supplies known card/printing names; SoldComps supplies real listing photos.
- Every submitted card, including Base/Normal, has explicit human variant review. A reference/model does not approve the submitted card.
- Prepare references in the background, without making grading wait for image acquisition. Saved identity and grade remain visible.
- Findings default to both full photos with every mark. Zoom/pan/expand keeps the other findings. One Approve all findings covers both sides; final grade approval is separate. One-at-a-time editing remains optional.
- The separate Needs Attention workflow was removed. Partial year/manufacturer details do not alone block geometry/findings; recovery belongs in the same review surface.
- Variant confirmation controls belong at the top. Name and photograph are the principal comparison content.
- ATLAS Codex owns permanent photos and label readings at catalog-card/printing level, reusable across physical submissions. It is not merely a cache attached to one uploaded card.
- Final approval still automatically creates one background comps job tied to that approval.
- Preserve uploaded photographs, exact geometry, findings, saved human decisions, grades, reports and approval history.

## Exact current comps instructions and implementation

Mark explicitly chose this Pikachu query, with `grade`, not `graded`:

`2023 Scarlet & Violet 151 Pikachu Cosmo Holo 25/165 grade 8.5`

Order: year, full set name, card/player name, common variant wording, collector number without `#`/leading zeros, then `grade` and the actual ATLAS grade. Do not translate8.5 into PSA9. Retained Scrydex metadata provides Scarlet & Violet plus151 while preserving the saved identity itself.

The NEW postapproval ATLAS pool uses `ATLAS_SLAB_V1`, asks SoldComps for240, retains all rows actually returned even if more than240, and does not apply the old title/URL/separate-ID parser exclusions. Missing/long titles, absent IDs, conflicting IDs, or malformed listing links do not by themselves discard the record. There is no fixed45second application search timeout on this new path. Raw acquisition is saved before label reading.

The label reader looks at photographed slabs from any grading company, keeps literal label text, accommodates abbreviations such as Holo/C.Holo, and reads the actual overall numerical card grade. It does not infer grade from an autograph/subgrade text regex. It does not use seller titles to establish identity. MATCH and UNCERTAIN readings with a readable grade within1point of the approved grade are eligible; explicitly DIFFERENT identities are excluded. Sales are sorted newest first, with grade distance as a tie-breaker. Unknown price or missing listing link may remain visible. The original photo/response/readings are retained.

The one-point definition of close grade was the lead's stated implementation choice, not a separately supplied numerical owner requirement. If Mark reports that it should behave differently, follow his direction.

Important separation: the new postapproval market path and the earlier variant-reference acquisition path are different. Do not assume these market relaxations removed every restriction in the older reference provider. If blank references or excessive filtering are reported, inspect the exact path responsible. Legacy engine/title contracts remain for historical saved receipts and the separate research service. Dead interim experiments were removed, but historical evidence compatibility remains intentional.

## Current deployed release — already completed

Private evidence root:

`/Users/markthomas/.codex/atlas-handoffs/atlas-unified-review-20261010/release-r8`

- Source: `f1b45eb65d0ec9ae8ebf25215538fb05241ce61c`.
- Native image: `sha256:d5aa4ef7b82718dc4e138951206568dc95db3e91e74f1e5fca13076c49d2e5dc`.
- Main container: `8d6ca2e23aa3bfb54925bc68a985db4475207990121519f4cc13caacc9038347`; started `2026-10-11T01:53:16.287203603Z`.
- Worker: `a4a5f5cc2b2e9f766e08da3d004d98f3d029db10295892d10c6858e9d6acd847`; started `2026-10-11T01:56:28.660709049Z`.
- Staff: `dpl_BxWfK42zDy7W9x3fCBiAk6VVaXa7` / `atlas-grading-staff-1yv4fnicg-ten-kings.vercel.app`.
- Public: `dpl_2pnP6P3Lheogn1aCKYwpAuuTPNuv` / `atlas-grading-public-kzqmoo01j-ten-kings.vercel.app`.
- Customer retained: `dpl_HDCWyH27p4gMpNqHMoAYuBNmryXp` / `atlas-grading-customer-kqkvu4gtd-ten-kings.vercel.app`, source `546fd382d51ec42674d54114cbfcad83c574b79f`.
- Canonical: `https://atlasgrading.com`; staff entry `https://atlasgrading.com/admin`.

Both runtime roles were ready, restart policy unless-stopped, zero restarts/OOM. Main14CPU/28GiB; variant worker1CPU/1GiB, pool1/concurrency1. No schema migration. The existing main DB role received only INSERT on existing `atlas_manual_connected.variant_catalog_cache`; SELECT already existed. UPDATE/DELETE/TRUNCATE and other privileges were not added.

R8 passed820/820 native checks with reproducible generated bundles. Canonical routing/CSP verified. Postflight at `2026-10-11T01:57:42Z` (October10,6:57p.m.Pacific) proved all55saved card records,10historical approvals, protected history, and migration ledgers exactly unchanged. These are historical-inclusive database counts, not55active cards. All16active counters were0 at that observation. Obtain a fresh baseline before future mutations because Mark is now testing.

Receipts: `native/qualified.json`, `web/canonical-result.json`, `runtime/restart-result.json`, `runtime/market-cache-grant-result.json`, `readonly/postflight-final-comparison.json` and accompanying census/runtime files.

Runtime plan file SHA: `9e3eb1ab76f30a78b8b64582c94743654848b5c9d562c136fe4e877db81bb9f2`; canonical plan hash `edb7df46bacb413383cd5d44b6e5cb2efa645fbdd42e0634162c33d285a30337`.

Every R8 mutation intent is consumed. `runtime/phase.py`, `rebind.py`, recovery drivers and web publish scripts are historical execution evidence, NOT commands to run again. A future fix needs a new exact-source release packet and fresh observations. The first R8 ready-main read was merely early during the retained125second boot fence; reconciliation showed healthy running state, then readiness passed after the fence. Do not mistake that historical receipt for a current production failure.

Private SSH transport configuration is referenced by the reviewed helpers at `/Users/markthomas/.codex/atlas-handoffs/atlas-scalable-pipeline-20260925/runtime-move-86bb1ed4/ssh-config.execution.json`. Runtime host161.35.178.144; DB transport alias`tenkings`. Reuse narrow reviewed transport rather than dumping environment or credentials. Never print secret values.

## Test cards and preserved decisions

Pikachu card: `94f77926-b937-4d7f-8938-7c23970af481`.

- Last verified: Completed, revision10, ATLAS8.5,11included findings, human-confirmed English Cosmos Holofoil.
- One final approval action and old automatic market job: `16cb94c8-9155-4321-9843-76d536c1f91a`.
- Label queued: `ATLAS-EF7F8C305855`.
- Report: `https://atlasgrading.com/reports/ar_xUfBd-DhVxM3H3HantxweT8L?v=1`.
- Approved content hash: `e7455f25e05070ecc7bc18e5f7e60b87a01d363ae1a9c2f5f6b72bc70ea1e5d2`.
- Old query: `2023 151 Pikachu English Cosmos Holofoil #025/165`.
- Old saved normalized candidates:0. The historical raw provider count is UNKNOWN; do not say SoldComps returned0raw rows based on that result.
- Canonical Cosmos printing: `atlas-codex-printing:v1:90b4bb96c99718c3e1b6f0bcf63962372be12a796eb0e68b1d28e0ac7e32da43`.

Mark explicitly authorized the prior lead to click final approval during testing while he was away. It was done once and succeeded. Do not repeat it. Future tests should preserve his saved selection/grade/findings and respect the scope of his current instructions.

LaMelo card: `edad09da-be99-4ccf-9331-b2cc618b5694`. Saved identity2025ToppsChrome—BallofDuty,BD-13 resolves the official2025–26BALL OF DUTY row. Geometry remains unfinished; reference viewing was tested without approving it. Do not invent a sports final approval merely to test market retrieval.

Another known catalog gap: Jaxson Dart saved `DTBH-JDT` is unmatched; the official2025DonrussOpticThreads row uses number3 and does not supply a verified alias. Do not silently change that saved identity.

The old45-card reset is complete. It retired the authorized fixed test-card set through existing discard/tombstone visibility, not a hard purge. Verified empty active queues and retired report404s at that time. Do not repeat it or delete cards uploaded afterward.

## Photo recovery: complete, not a pending action

Two reference jobs failed because the old parser rejected literal multiline grading-label text. The fix is live. Exact retained paid responses were projected through two ordinary fresh refresh-generation jobs, with their exact saved catalogs seeded atomically. No trigger/schema bypass occurred; original FAILED rows remain immutable.

- Original Pikachu key: `c15f1533aa51ffae7b8fbb30e7222db91a105ed561dcbd7c5849415128c67dad`.
- Recovered Pikachu key: `b5c921ecd71e180039b272a10cc2b9404ee1822e9ed108580306969971cd4498`.
- Original LaMelo key: `8ef356e06854ecfc0a092678755952d1f2601d62471acef564c35f18f0f8d192`.
- Recovered LaMelo key: `a6b50b875b47e967359e143917fac560d758461fdd4bb47fe506755e34379675`.

At01:59:55Z both successors were READY, attempts0, codeNULL. Pikachu:5known choices,3retainedphotos,1canonical association and2unmatched. LaMelo:1known choice,2retainedphotos,bothassociated. All5photo byte hashes, saved readings and library links verified. Paid journals remained22listingreservations/22responses and2labelreservations/2responses; every delta0. Current card rows and original failed rows were exact.

Proof: `release-r8/recovery/postflight-first-result.json`, `postflight-first-observation.json`, `result.json`. The recovery execution-plan SHA was `9439f28f893ba990b7100c09c2deeb52037dbfaef19e8492e24e0af7cc403c33`; it is consumed. Do not run `recover-forward.py --execute`, reopen FAILED rows, create replacement generations, or click Refresh reference library merely to repeat this recovery.

## What has and has not been proved

Previously exercised in production: actual Pokémon/sports listing photos; named variant selection; all-finding zoom/pan with marks retained; Return staying in Findings; one findings approval then Grade; Pikachu final approval with no geometry loop/error; automatic approval-origin comps job creation/completion.

R8 storage/recovery is verified. New slab market UI passed real-component local browser fixtures at1440/1024/390/320 widths. Isolated PostgreSQL tests proved durable paid-response recovery and separate physical cards reusing canonical photos/readings without new calls. Synthetic provider stubs were used in those database tests; do not call them production provider/OCR accuracy proof.

Still outstanding at handoff:

1. Mark's newly discovered production issues: symptoms not yet recorded; reproduce and fix first.
2. Visually inspect the latest recovered slab photos and literal labels on actual production staff screens.
3. Run ONE new Pikachu Refresh sales with the exact new query, then report raw returned count, label readings, eligible/shown count and reasons for differences. No new `ATLAS_SLAB_V1` job had been dispatched at the latest read-only baseline. If the exact query truly returns0raw rows, report that faithfully; do not secretly substitute another query. Mark wants deliberate query experiments afterward.
4. Prove a second physical submission reuses Codex references in production with no new acquisition/label calls. The prior production proof is paid-response recovery, not this second-copy test.
5. Finish expanded sports import and historical coverage work after immediate product issues.

Latest browser state was the ordinary sign-in screen after R8 invalidated the release-bound session. One asynchronous sign-in request was pending; no reply had arrived before the status/handoff request. Chrome profile `tenkings.co`, group `🔎 ATLAS review`; prior Pikachu tab2132132083, sports tab2132132088. Discover fresh state rather than assuming these handles or login survive a new chat. Reuse an already signed-in tab if available; do not repeatedly ask to log in without checking. Do not bypass authentication. No browser/account mutation was performed to prepare this handoff.

Read-only market monitor:

`/Users/markthomas/.codex/atlas-handoffs/atlas-unified-review-20261010/release-r8/readonly/monitor-pikachu-market.py --snapshot UNIQUE-NAME`

Invoke with python3 and a fresh filename label. It only reads the card's jobs and retained photo/label receipts; no enqueue/provider calls. It distinguishes `rawReturned` for the new pool from `normalizedCandidates` for legacy data. It does not fetch the preview artifact, so obtain actual displayed/shown counts separately from the saved preview or staff UI. The original baseline receipt is preserved and its older generic returned field must not be misinterpreted.

## Code map

Paths below are relative to the approved worktree.

- Query/context/preview projection: `packages/atlas-connected-manual/src/presentation-market.mjs`.
- New provider: `presentation-market-provider.mjs`; saved job lifecycle: `market-worker.mjs`, `market-job-store.mjs`; authorized preview/photo reads: `presentation-market-service.mjs` in the same directory.
- Slab OCR and durable per-image market readings: `market-slab-labels.mjs`.
- Permanent reference identities/library: `variant-codex.mjs`; reference model/projector: `variant-photo-provider.mjs`; listing acquisition/cache: `variant-listing-provider.mjs`, `variant-source-photos.mjs`.
- Reference jobs/services: `variant-worker.mjs`, `variant-job-store.mjs`, `variant-service.mjs`, `variant-catalog.mjs`, `variant-recheck.mjs`.
- New unfiltered pool and old compatibility engine: `packages/ebay-sold-comps-v2/src/index.ts`.
- Catalog: `packages/card-catalog-evidence/src/manufacturer-checklist.mjs`, `variant-review.mjs`; serving data/manifest/coverage under `packages/card-catalog-evidence/data/`.
- Staff UI: `frontend/atlas-app/components/ManualCards.jsx`, `RapidReviewControls.jsx`, `VariantIdentityReview.jsx` and CSS, `ReportMarketPicker.jsx`, `MarketReferencePicker.jsx` and CSS; clients under `frontend/atlas-app/lib/variant-review-client.mjs` and `report-market-client.mjs`.
- Tests beside those modules. `frontend/atlas-app/scripts/market-slab-display-browser.mjs` is a synthetic sale/layout fixture, not live acceptance. `packages/atlas-connected-manual/scripts/variant-codex-postgres.mjs` exercises shared reference persistence in an owned fixture.

Existing `variant_catalog_cache` stores permanent source responses, retained image bytes, per-image OCR readings and per-printing libraries. Shared keys exclude the physical submission. Populated printings load shared references before searching. Explicit missing-reference Refresh can create a new generation for missing printings. Retained unknown outcomes and paid receipts are not automatically repurchased. Staff market images are served cache-only through the existing authenticated market GET path, bound to preview/image SHA, with authorization rechecked after the image read. Do not put implementation-only messages throughout the operator UI.

## Sports catalog status and exact private inputs

LIVE:618official source entries /1,131,964explicit card/printing rows. This is partial coverage, not a unique-card count or all1990–present sets. The bounded-shard reader is qualified; the large expanded private data has NOT been exported/deployed. The older monolithic data fallback still exists until the final expanded import is qualified; deleting it prematurely would remove current serving data.

Private root: `/Users/markthomas/.codex/atlas-handoffs/sports-checklists-20261010`.

- Panini:1,057/1,213queued products attempted;1,056usable products plus one changed-version export,6,022,658explicit rows.156remain (49baseball,107football).87.1% refers only to this inventoried queue. Read `panini-acquisition-queue.json`, `panini-compact-receipts.jsonl`, `panini-export-receipts.json`.
- Topps:60newPDFs downloaded,42parsed,18unsupported;31older gaps reviewed,15recovered,16unresolved. Combined reviewed supplement57uniquePDFs→62sport-specific source entries/25,389rows. Five downloads unavailable;12pending indexed candidates unacquired. Read `topps-expansion/PRIVATE_NORMALIZATION_HANDOFF.md` and `normalization-final-receipt.json`. Final inputs: `no-team-supplement-v1.json`, `prior-column-supplement-v1.json.gz`, `common-column-supplement-final.json.gz`; oldv1/v2iterations are not final input. `load_topps_supplement.py` verifies receipt/source/reparse consistency.
- Upper Deck:20complete retained tables,15parsed→42sport-specific source entries/14,118rows. Five retained tables remain unparsed/excluded and need classification review; do not assume every unparsed table contains requested-sport cards. One2023–24Metal Universe table failed complete capture. Final private supplement `root-upperdeck-supplement-final.json`; captures under `upperdeck-expansion/capture-receipts.json`. Older supplement is historical.
- Leaf:41problematic sources audited;24recovered sources yield238,571rows in `root-leaf-v2-supplement.json`. Other gaps remain.
- Expanded export helper: `export-private-shards.py`; final use requires complete Panini queue and disk reserve. Review its current arguments and final receipts before execution.

Do not sum these overlapping private/live counts into a unique-card total. Topps says pre2018checklists unavailable; observed Upper Deck selectors cover2015–2026; Panini has large unexposed early-year ranges. Historical Fleer/SkyBox,Pacific,PressPass,SAGE and predecessorScore/Donruss are incomplete. No defensible all-manufacturer1990–present completion percentage exists.

Local disk was critically low (hundreds of MiB). Acquisition paused before the next request and large export; nothing is running. The export reserve is1GiB plus64MiB headroom. A reproducible worktree Next cache and owned disposable PostgreSQL data were removed; original checklist bytes/receipts were preserved. A request to remove two old Docker installer caches outside the workspace had no affirmative answer. Do not delete them on assumed permission. Inspect current disk space before resuming imports/installing dependencies. Do not redownload already retained files or rebuild the archive from scratch.

## Immediate continuation order

1. Read this handoff, required context and git status; get Mark's new production symptoms. Inspect the actual current browser/DB state read-only.
2. Trace each reported failure through its actual UI path and saved request. Prefer a small root-cause correction; preserve grading and paid evidence. Do not add speculative blockers/fallback branches to mask the problem.
3. Implement and run meaningful focused tests, then deploy a fresh reviewed release only if needed. Existing authorization covers this feature/fix work; do not re-ask routine permissions already granted. Any new destructive scope still needs explicit approval.
4. Verify the affected production screen, then finish the pending fresh-search counts, slab-photo UI, and repeat-card reuse proof. Report what was actually observed, including failures or unavailable photos.
5. Resume sports acquisition/export after disk capacity is resolved. Keep unproven catalog coverage explicit.

No automation or goal was created. No background agent is still handling the remaining work. This handoff does not claim Mark's newly observed production issues are solved.
