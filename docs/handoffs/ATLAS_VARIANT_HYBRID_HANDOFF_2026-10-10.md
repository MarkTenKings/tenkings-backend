# ATLAS variant photos — lead handoff, 2026-10-10

## Latest continuation checkpoint — October 10, 2026, 17:15 UTC

**Software installed; required real-photo screen acceptance is still unfinished.** This section supersedes the historical checkpoint below. Continue here; do not redeploy or restart the investigation.

- Worktree/branch remain exactly as documented below. App source `3927ba07827f4a40c0413cbdceb3e43ccfc0135a`; final docs-only commit may follow. All changes pushed; original dirty checkout untouched.
- Staff `dpl_GAbHcHQmGTxsz5GndbYPTyXCYpzD` / `atlas-grading-staff-1tdny4dlr-ten-kings.vercel.app`; public `dpl_E2m6UXHRhBfZ5oNmaTtFQ3k465ye` / `atlas-grading-public-q5rc539dw-ten-kings.vercel.app`; customer remains exact `dpl_HDCWyH27p4gMpNqHMoAYuBNmryXp` / `atlas-grading-customer-kqkvu4gtd-ten-kings.vercel.app`.
- Main `c1fb9c561d83cbc2a0b123b1c8beb063cffad07352b186a821abadd5a68859cf`, started `2026-10-10T17:09:57.3933189Z`; worker `b8cb14f330f9de3aa3848be7d2a8e3a6f45ced1fb08c493974b4c5d956a2a02d`, started `2026-10-10T17:12:23.103191066Z`. Both source3927/image `sha256:2ddf7a56756a1df3ba8a50569446838023d3760dbd8b9813dc0e6347461ef184`; zero restarts/OOM, `unless-stopped`. Main14CPU/28GiB, worker1CPU/1GiB/pool1/concurrency1 unchanged.
- Controls Staff79/Customer43/PublicReader52/STAFF SMS60/CUSTOMER SMS21. Schema79/121 unchanged. Final census all16activezero/all3priorityfalse; all protected history/ledgers/drafts exactly match pre-release. Four acceptance cards unchanged, zero variant confirmations, no actual listing source/image cache entries.

Implemented: exact `listing_photo` schema with listing `{id,title,url}`, `provenance.provider='ebay_sold_comps_v2'`, usage `provider_reference`; immutable raw/source/image evidence; canonical case/collector alias source identity; permanent dispatch journal in existing cache with advisory locks, no retry after uncertainty; separate worker-only SoldComps key copied from existing credential. Main reader has no listing credential or network capability. Explicit compatible photos attach to retained Scrydex names; ambiguous claims stay independent. Seller photos never feed the variant model or make a human decision. Total metadata timeout now falls back to partial discovery and continues the independent listing window, preserving cancellation. Exact already-live74 admission fix carried forward. UI shows seller attribution/side-by-side comparison, generic artwork once, missing-photo compact choices, preserved identity/grade and discard/refresh path. Automatic postapproval comps are unchanged and tested; no actual approval was manufactured.

Evidence packet `/Users/markthomas/.codex/atlas-handoffs/atlas-hybrid-photos-20261010-r2`:
- `release-checkpoint.json` indexes13 exact receipt hashes. Native279/279, source1248/native16/dependency29 checks; no native compilation/install. PostgreSQL21 groups in prior packet `atlas-visual-variant-review-20261009/hybrid-orchestration-postgres-r3/result.json`. UI/client50 tests and actual adapter-to-UI PNG path; browser synthetic desktop/mobile evidence in `atlas-hybrid-photos-20261010/ui`.
- `runtime/plan.json` SHA `fa8e148693ee6b4381267b442b0b198c7673372b9dce8d11f9103e05c8c8cac9`. All prepare/stage/fence/stop/main/restore/grants/worker/restart/public operations succeeded once. `web` route/promote succeeded once; canonical routing/assets/CSP passed.
- `read-smoke/result.json` SHA `3ad8a0b3225404d04362c1555c2bee3ede4be4377d2302699930011cef8113f2`:11 signed sessionless reads, no mutations. This is not authenticated photo proof.
- `runtime/final-controls.json` SHA `e900c447f972590e5242efffa5e12d14af7c915beef7a14078d1dacb97362d38`; `resource-baseline.json` verifies14CPU/28GiB and1CPU/1GiB and zero restarts/OOM. Local synthetic acquisition performance measured warm manual-read/commit p95 +3.57ms, not a production grading guarantee.
- `acceptance/{before,after-activation}.json`: all four target cards/revisions/identities preserved; zero sources/photos/confirmations; existing10 market jobs unchanged. `acceptance/observe.py <fresh-tag>` is read-only and captures job/source/image descriptors plus computed retained byte hashes; do not reuse output tags.
- Earlier `atlas-hybrid-photos-20261010` b61 image/staff candidate is superseded before activation, with no runtime/control/promotion or paid request. Preserve receipts; never replay old intents.

Remaining work is concrete: normal staff sign-in, then one authorized reference-library refresh for existing Mewtwo and one Drake draft. No approval, variant selection, grading step or new card needed. Browser Chrome ATLAS profile has a separate tab opened for acceptance; original saved manual tab stays untouched. At17:13 a cached queue showed “Your session ended”; navigation to `/admin` returned normal Staff sign-in. User was asked asynchronously to sign in and reply “signed in”; no reply yet. Do not extract cookies, synthesize sessions/private browser API calls, impersonate human approval or re-run completed grading work.

After sign-in use real UI and confirm current3927 screen, then refresh references, observe actual worker acquisition, verify byte hashes using fresh read-only observation, and visibly inspect real photo rendering/comparison for Pokémon and sports. Same canonical identity must buy at most one source request; retained sources survive TTL/refresh. If photos are missing, inspect retained response without repurchasing. Capture actual screen evidence and compare saved history. Measure queue/resource/read behavior during acquisition honestly; do not promise zero grading slowdown. This required acceptance remains open and the feature must not be described as fully working based on automated tests.

The completed release freeze is lifted for documentation and any evidence-backed follow-up fixes. Sealed release helpers require the exact3927 source and will refuse a changed HEAD; they are historical after the completed cutover. Create a fresh narrow successor only if an actual bug requires one. No additional restart or deployment is currently needed.

## Historical takeover checkpoint (superseded by continuation above)

## Start here

The user requests a fresh Astra lead. Finish the approved feature; do not restart the investigation or describe it as complete. User is frustrated by hidden identity, empty variant references and credit consumption. Communicate simply, keep work bounded, and prove actual photos on the staff screen. All specialist agents have stopped; no production cutover is in flight.

Latest approved direction: **Pokémon: Scrydex for available variant names, existing SoldComps API for actual eBay listing photos. Sports: existing SoldComps API for actual listing photos and observed variant claims.** Scrydex and listings cannot promise exhaustive variant coverage. Do not buy another service. Human staff compare photos and explicitly confirm the variant at final grading review; Astra suggests only. Background preparation must be independent of grading and post-approval comps. Automatic graded comps should continue after actual human approval.

The user has approved implementation, subagents (Astra Ultra), existing Scrydex account, separate OpenAI worker key, and production repairs. No credential permission is pending. Do not ask again for already-approved work. Do not manufacture staff confirmations or approve real cards to make a test pass.

## Workspaces and process

- WORK HERE: `/Users/markthomas/.codex/worktrees/atlas-automatic-comps/ten-kings-mystery-packs-clean`, branch `codex/atlas-visual-variant-review`. Released app source is `fe64c49e61a046104845451c36bfe2b434bd7c1e`; a docs-only commit follows it for this handoff.
- DO NOT MODIFY the original dirty/conflicted checkout `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`.
- Shared host worktree: `/Users/markthomas/.codex/worktrees/shared-variant-catalog/ten-kings-mystery-packs-clean`, branch `codex/shared-variant-catalog-demand`, deployed source `f02c430bd4cee3958ac4b56182c59c64dccbc840`.
- Worker-specific prior worktree: `/Users/markthomas/.codex/worktrees/atlas-variant-admission-fix/ten-kings-mystery-packs-clean`, source `74ffc12f99cb5ba7135473e66d7481d54f2a4e9d`.
- Read required AGENTS context/runbooks and recent SESSION_LOG entries. These docs are huge: targeted reads, not a whole-history dump. Runtime/code evidence overrides stale documents; journal code and planned/observed deploy actions in the same session.
- Apply `/Users/markthomas/.codex/skills/atlas-design-director/SKILL.md` for staff UI. Preserve evidence pixels, readable dark text and straightforward operator actions.
- **The fe64 source freeze is explicitly lifted after the completed release and final checks below.** Prior sealed release helpers are historical and will intentionally reject a changed working tree. Create a narrowly scoped successor plan; never replay their consumed mutations.

## Production checkpoint: finished and verified

Canonical `https://atlasgrading.com` now serves the fe64 staff/public UI repair. Staff and customer admission enabled; main and separate variant worker ready, restart policies enabled. Final revisions: Staff77 / Customer41 / PublicReader51 / STAFF SMS59 / CUSTOMER SMS21. Staff schema79/public schema121 unchanged.

Web:
- Staff `dpl_5UDwxthB2VKjavmncXoj83J7bXkk`, `atlas-grading-staff-ktx04zo8u-ten-kings.vercel.app`, fe64; config `a309987001ba78b4e473ffe375c8e0ce64b9b661e45922ad3b25c4a25851c54f`.
- Public `dpl_BWWoQ8m1nPWiHTpVqetqVQEUC8AU`, `atlas-grading-public-f85zkp9ip-ten-kings.vercel.app`, fe64; config `cc3c81e9c8541fb3a2c9c0c8c01e54298a22f04522714561743051d4d331c1c8`.
- Customer retained `dpl_HDCWyH27p4gMpNqHMoAYuBNmryXp`, `atlas-grading-customer-kqkvu4gtd-ten-kings.vercel.app`, source `546fd382d51ec42674d54114cbfcad83c574b79f`, config `a16194cda97d081b2b878bb59343f68ba30e6e56085dfdaa064c32f7e6ea1563`.

Native images were not rebuilt. Only two staff-web binding environment fields changed:
- Main container `204593d2f378b5ed46ee931b25831d3d1489bb01fad84a6a35836137ba838a1b`, started `2026-10-10T16:18:49.834441699Z`, source `c16fa61e0c10439ad858a0f380b9d28876fbdf63`, image `sha256:fc8302681ef5dd5f885ae62a9e6c6cc85a04c73b1db30f8174bc11542e456d45`.
- Variant worker `24e5985c3f8cf6318a12ec55e4458070969ea661a4df91c187a42b9508a1ad24`, started `2026-10-10T16:26:15.536247362Z`, source `74ffc12f99cb5ba7135473e66d7481d54f2a4e9d`, image `sha256:e947c73294eccbcbf8e74401c6f13f594d00b47959832394eea3162f5c5381ae`.
- Worker remains 1CPU/1GiB, pool1/concurrency1, no HTTP/ports. Main resources and grading priority unchanged. Separation limits interference but does not prove literally zero shared-resource slowdown.

Evidence packet `/Users/markthomas/.codex/atlas-handoffs/atlas-variant-ui-rebind-20261010-r3`:
- plan file SHA `75ded0ec60ec20a85ee16c4171234b49dd362e3af472c530e9da664beb019e66`.
- Main and worker readiness receipts, restart result and final controls retained.
- `read-smoke/result.json`: 11/11 signed read-only requests passed; 8 unauthorized staff reads denied, 2 retained customer reads and immutable public report passed; no actual staff sessions, confirmations, approvals, provider/model requests or writes. SHA `ce231f0887198f653005f7ff0129ec89c73a34a3b4ee91d73bddec005c7bbb44`.
- `final-controls.json`: SHA `3cb6c79ef053af9fa01c2ee4dea45fbbf85d2704a8c0adb35f04f7406e9ec3d5`; all16 active counters zero, all3 priority predicates false. Ledgers, protected card/action/approval/variant/market histories and saved drafts exactly match pre-cutover baseline.
- Public control CAS succeeded once; initial postflight verify refused. No retry occurred. Fresh read-only census passes original unmodified policy and matches the successful command's controls/history exactly. Independent agent receipt confirms. `public-reader-result.json` explicitly records this read-only reconciliation, SHA `35a1cfbe0777976c4f264fc93efe7857eb9fa5b06fb01076490da19dd798ec6e`. Original transient failure cause was not retained and is not claimed.

Web packet `/Users/markthomas/.codex/atlas-handoffs/atlas-visual-variant-review-20261009/release/identity-visibility-fix-r2-20261010` contains single successful routing/PROMOTE intents and `canonical-result.json` / `provider-after.json`: exact aliases, retained customer, assets/routing and Scrydex/TCGdex image-only CSP verified. Do not replay route/promote or old r1/r2/r3 mutations.

## What the live repair does (and does not)

- Restores visible saved name/year/manufacturer/set/card number/parallel above variant choices. Missing variant references no longer say the entire card is unidentified.
- Shows the current saved grade above the large variant panel; stale grades remain suppressed.
- Empty reference results directly expose the existing physical-variant verification fields. Still requires a real staff decision and observed details.
- Unsaved “not shown” choices can be explicitly discarded before refreshing references; uncertain pending saves remain protected.
- Prior release allowed `images.scrydex.com` and `assets.tcgdex.net` in image CSP, correcting blocked reference artwork, and fixed white-panel heading contrast.
- Relevant local suites: preceding identity/grade repair140/140; final variant UI/client suite45/45. A real browser synthetic empty-result fixture was checked. **Authenticated current production screen and actual real variant photo selection are not proven by these tests.** Staff may need normal re-login after release binding changed. Do not approve a card on their behalf.

## Root causes and remaining user problem

Both Drake drafts still have their original saved identity: 2025/Panini/Donruss Optic Football — Donruss Threads/DTBH-DME, parallel null. IDs `181f749c-50fb-4c4e-8921-aff9101f06e5` (rev10), `4d0d0eae-f44e-42b5-9844-abd03a06bb7b` (rev6). They had no approval, market job or variant confirmation and READY variant jobs with zero candidates. New UI hid saved identity; required variant confirmation prevented approval, so post-approval comps never started. This is not evidence the original card identity was deleted.

Sports reference-photo sourcing from SoldComps was never connected. The pipeline used shared catalog/checklist discovery. A real parent-product/insert all-token filter bug was fixed on the shared host (f02c430): search parent product, retain exact insert row filtering and full original identity. This is live, qualified with28 tests+13 guards and27 canonical probes. It does NOT establish sports photo coverage. Historical unavailable responses lost detailed statuses; do not claim this filter was their sole cause. Earlier TCDB URL-guard bug hypothesis was retracted as false.

Scrydex: one real Mewtwo detail request returned HTTP200 with five empty variant image arrays and generic front artwork only. Proof `release/acceptance/mewtwo-scrydex-detail-proof.json`, source body SHA `a2df16d2889eb942d4844ee95ec507bbdd3b83eec4503930aa8b10fbbd6683e1`. Image loading fix is live, but distinct finish/stamp photo selection is unfinished. Never treat five copies of generic art as five diagnostic variant photos. Existing initial worker run had10 READY jobs/20 cache records;4 cards14 generic artwork entries,6 cards no choices,0 diagnostic photos/0 model dispatches.

## Hybrid implementation checkpoint — NOT LIVE

Read these external specialist handoffs under `/Users/markthomas/.codex/atlas-handoffs/atlas-visual-variant-review-20261009/`:
1. `HYBRID_PROVIDER_HANDOFF.md` — implemented isolated prototype, exact source/test hashes and13/13 offline tests (real Sharp decoding, injected source data, zero live calls).
2. `HYBRID_ORCHESTRATION_HANDOFF.md` — design only; journal/cache/worker integration, no migration or PG proof yet.
3. `HYBRID_UI_HANDOFF.md` — design only; exact schema naming requires reconciliation with adapter/backend.

Two prototype files live OUTSIDE repo in `hybrid-provider-draft/packages/atlas-connected-manual/{src/variant-listing-provider.mjs,test/variant-listing-provider.test.mjs}`. Source freeze is now lifted; next lead may review/copy them in. They are not committed, integrated or deployed. Preserve before editing. All specialist agents stopped at this checkpoint.

Existing reusable code:
- `packages/ebay-sold-comps-v2/src/index.ts`: `searchEbaySoldCompsV2` works without approval. Approval dependency is current ATLAS orchestration, not SoldComps itself. One bounded provider GET; results contain title/listing URL/thumbnail.
- `packages/card-research-core/src/evidence.mjs`: `researchImageOptions(raw,true)` preserves actual fullResThumbnailUrl with thumbnail fallback. Do not invoke the entire approval-bound research service (can trigger extra models/searches).
- Separate preapproval `variant-worker.mjs`, catalog/cache, authenticated retained SHA image route, `VariantIdentityReview.jsx` comparison dialog already exist. Do not embed postapproval MarketReferencePicker, which is a price/publication flow.

Next concrete steps:
1. Review prototype and agree strict `listing_photo` metadata shape (backend `listing:{id,title,url}` vs earlier UI proposal listingId/title/listingUrl). Extend `packages/card-catalog-evidence/src/variant-review.mjs` narrowly. Preserve old snapshots; seller photos are unreviewed evidence, not exact/reviewed catalog authority.
2. Implement durable paid source request reservation/response storage BEFORE HTTP, shared across physical cards/refreshes with same public identity. **Known prototype issue: requestKey still changes with display capitalization; normalize identity case and safe collector-number aliases before reserving a paid request, with equivalent-identity tests.** Existing job dispatch/response fields belong to photo-model requests and cannot be reused. Proposed immutable-cache+advisory-lock scheme avoids migration but needs real restricted-role PostgreSQL concurrency/crash proof. A TTL miss or refresh must not silently repurchase an uncertain request. Keep this bounded; do not invent a giant new release framework.
3. Compose Scrydex candidate names with compatible listing photographs; for sports use identity-compatible listing photos/observed variants. Strictly reject wrong year/set/name/number/language, lots, ambiguous claims; never infer Base from absent wording. Keep coverage honest and human choice final.
4. Wire bounded photo acquisition and retained byte serving; main GET reads cannot search or charge. Worker alone receives existing SoldComps credential after review. Current worker allowlist may strip it. Main and worker reader/schema compatibility likely require both native images plus UI update; don't assume worker-only release.
5. UI: uploaded photo beside real listing photo, exact title/source link, useful variant names, short “eBay listing photo” label, generic art once as context, no prices, no auto-choice, no repetitive technical warning walls. Saved identity/grade remain visible and physical fallback remains reachable.
6. Test focused failure/concurrency/stale/pending paths, then bounded real acceptance for Mewtwo and Drake: actual provider response → cached photos → authenticated screen → human review available. No synthetic confirmation/approval. Measure grading latency/queue behavior before and under background acquisition; report evidence rather than promising zero impact.

## Access and practical details

- Existing Vercel CLI authentication works; no new OAuth requirement. Node22 `/Users/markthomas/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`; CLI `/opt/homebrew/bin/vercel`.
- Provider helper `/Users/markthomas/.codex/atlas-handoffs/atlas-automatic-comps-20261008/provider.mjs` exports client/snapshot. Vercel auth protected at `/Users/markthomas/Library/Application Support/com.vercel.cli/auth.json`; never output tokens.
- Private Scrydex/OpenAI/catalog credentials in visual-variant packet `private/`; dedicated worker project `proj_pH8SILJuhjVIsbC8ePOlMdzt`, role `atlas_variant_review_20261010` cap1. Secret values stay out of handoff/console. Existing OpenAI capacity proof is time-limited; validate if needed for successor activation.
- Read-only DB transport and observation SQL in r3 packet. Production droplet161.35.178.144. Use bounded read-only queries and exact evidence; no manual DB resets, fake human actions or destructive operations.
- User's intended ATLAS Chrome profile was last frontmost on Easyship. Browser extension profile2 is TenKings, not the intended ATLAS session. Inspect surfaces carefully; don't disrupt unrelated shipping. Reinitialize CUA documentation in a fresh session. Never extract session cookies or synthesize private browser API calls.
- Old synthetic fixture process on port55887/session18831 was stopped by root before handoff; it is not production evidence.

Do not tell the user the hybrid feature is live or fixed until the actual staff photo selection is demonstrated. The live release at this checkpoint repairs workflow visibility and reference refresh; it does not solve absent photos.
