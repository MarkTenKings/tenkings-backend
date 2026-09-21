# Ten Kings Inventory — Astra Ultra lead handoff

Prepared September 21, 2026, America/Los_Angeles. This is the entry point for the new owner-facing lead, replacing the context-full Inventory task. It does not deploy application code or broaden the approved product scope.

## 1. Ownership and the owner's latest instruction

Mark asked to package everything and transfer the **Ten Kings Inventory project** to a fresh **gpt-6-astra / ultra lead**, with its own fleet of subagents, so he can work directly with that task. Ten Kings Inventory is the primary project. **ATLAS Grading is a separate project with its own lead, release branches, UI, grading work, and physical-card records.** Shared recognition and catalog knowledge do not transfer ATLAS project ownership to Inventory.

Mark already authorized implementing the reviewed Updated Plan, protecting fast Add Inventory, preparing the new tenkings.co site in the existing GitHub/Vercel application, and replacing the unused Wix marketing content. Continue that authorized work; do not ask him to reapprove the plan. Coordinate material shared infrastructure changes with the ATLAS lead. Do not edit its checkout or release its application.

Owner priorities:

1. Keep the successful sports photo-identification flow working. Pokémon must receive equally useful, accurate details.
2. Photos, cost, sales channel, save must stay responsive. Extra catalog/comp research belongs after save.
3. Identify the exact card/variant and attach correct eBay sold comps on more than 90% of **all encountered cards**. Finding any listing is not this metric. Do not exclude hard cards from the denominator or claim the target is reached.
4. Grow one reviewed shared catalog incrementally from real sports and Pokémon demand. Shared card facts and approved reference images may serve both apps. Individual physical cards, ownership, cost, condition, grades, and private original images remain separate.
5. Use tenkings.co as the clean main public/staff entry, while preserving required collect routes and existing customer/card/NFC links. Old admin tools are not universally obsolete; SetOps and other specialist functions still matter.

## 2. Start here: verified state and next decisions

| Surface | State at handoff | What it proves / what remains |
| --- | --- | --- |
| Production collect.tenkings.co | Existing Pokémon/photo-recovery release 38c95335; deployment dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj still READY with production aliases on September 21 | No new production promotion by this task. Source association comes from release records; Vercel metadata does not expose this deployment's git SHA. |
| Integrated main Inventory Preview | Source 895a3b34, deployment dpl_FpG7zsUwoyFHEqjiPfk44qmDE2ja, READY reconfirmed September 21 | September 20 hosted checks passed and real signed-in read loaded 99 entries / 109 cards. These counts are a dated observation, not a fixed expected total. |
| Inventory release Preview | Source e286ea0a, deployment dpl_7xc2akyMGziEALNz3aCZFvWsnPCs, READY reconfirmed September 21 | Sports preparation writer/UI/API and all current Inventory application bytes are present. Optional catalog/research additions remain off. |
| tenkings.co / www rollout | Prepared, not cut over by this task | Phone acceptance, exact production configuration, routing/auth checks, and DNS/TLS readback remain. |
| Shared catalog | Contracts, durable review/publication services, schema foundation, contribution inbox, and two pilot preparation workflows built | Actual pilot review, source staging/publication, useful approved images, and enabled consumer acceptance remain. |
| Better comps | Matching repairs and bounded ordinary-sale detail resolver built; controlled provider experiment completed | Enabled hosted/provider/load qualification, independent real-card labels, and coverage measurement remain. |

**Owner test URL:** https://tenkings-backend-nextjs-app-git-codex-main-sit-3a8ce9-ten-kings.vercel.app/staff/inventory

**Current production entry:** https://collect.tenkings.co/admin/physical-inventory — use Add inventory in the staff workspace.

Pending owner input: test one real sports card and one real Pokémon card on a phone using the updated Preview: front/back photos → cost → sales channel → save → reopen. That exact request is unanswered at handoff. The Preview uses real business inventory/storage, not a disposable test database. Do not create synthetic live stock. A normal desktop signed-in read passed; a complete phone save has not been claimed. Owner can continue this test directly with the new lead.

Do useful independent work while phone acceptance is pending. It blocks the planned domain rollout, not every catalog or comp task.

## 3. Authoritative workspaces, branches, and Git boundaries

Repository: https://github.com/MarkTenKings/tenkings-backend

### Inventory application workspace

- Path: /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
- Branch: codex/staff-inventory-release-20260910
- Local HEAD before this handoff: 596f9dfb107793d287b06c4cae0f2a46dd5423f7 (documentation-only closeout).
- Remote/deployed HEAD, freshly checked with git ls-remote September 21: e286ea0a190bfdc6807fe8ca58c47b34c94b55c1.
- This handoff and its state snapshot will be a further local documentation-only commit. The receiving lead can inspect git log for that commit. No push/deploy is required just to transfer the task.
- Preserve unrelated untracked docs/plans/2026-09-10-atlas-staff-intake-reuse-update.md. Its SHA256 is 6166a6332e32cb380247358ef9040c0ad2e04a6a46f0448c632c42658fcfdb2d. Do not absorb it accidentally with git add .

### Integrated main-site release workspace

- Path: /Users/markthomas/tenkings/codex-main-site-release-20260916
- Branch: codex/main-site-release-20260916
- Local HEAD: 6e507b390f98823c9b7027d55ef9f9134d44c43d (documentation-only closeout).
- Remote/deployed HEAD: 895a3b34cc9cd7c8f6d2267ad4d763fb2ff0949d (normal merge of main badaa8c1 with Inventory e286ea0a).
- **Every non-documentation blob at 895a3b34 equals Inventory e286ea0a.** Rechecked September 21; only SESSION_LOG.md and the main release plan differ.
- Existing main Preview origin, widget/auth configuration, and human session were preserved. No ATLAS branch merge.

### Do not confuse these with the application authority

- Old attached task cwd: /Users/markthomas/.codex/worktrees/c487/ten-kings-mystery-packs-clean, stale HEAD 89c55d91. Do not build/deploy it as Inventory.
- Saved Codex project: /Users/markthomas/tenkings/ten-kings-mystery-packs-clean, project ID local-a099185bcc24467e8caeef5d5da895a7. A newly created task worktree may start from the project's default branch, which is not necessarily the Inventory release lineage. Inspect it before any edit. Read the canonical Inventory files above; either explicitly assume ownership of those existing release workspaces or create an isolated codex/ continuation from their verified current commits. Do not merge unrelated main/ATLAS work merely to make the task worktree current.

There is no active old-lead implementation work to race with. Its completed subagents do not automatically belong to the new task; create a fresh fleet with bounded assignments and disjoint paths.

## 4. Required context and document reading order

Follow AGENTS.md in the workspace. The predecessor already read the required context; the new lead and new agents must do their own required reading. In particular read the approved blueprint **in full** before beginning implementation:

- docs/context/MASTER_PRODUCT_CONTEXT.md
- docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md
- docs/runbooks/DEPLOY_RUNBOOK.md
- docs/runbooks/SET_OPS_RUNBOOK.md
- docs/HANDOFF_SET_OPS.md
- docs/handoffs/SESSION_LOG.md

The September 15–16 owner amendments cover the approved Inventory/recognition/shared-catalog extension and main-site work. Blueprint controls intended product scope; code/runtime/DB evidence controls what exists today. Do not silently broaden it. Preserve dated historical records and add corrections when evidence supersedes them. SESSION_LOG is large; its latest Inventory entries provide the execution index. Many older plan headings say local/uncommitted/pending and are historical, not current release status.

Then read these relative to the Inventory workspace:

- docs/plans/2026-09-15-variant-and-sold-comps-improvement.md — canonical Updated Plan; September 20 progress supersedes its retained historical tables.
- docs/plans/2026-09-16-inventory-research-implementation.md
- docs/plans/2026-09-16-next-delivery-workstreams.md
- docs/plans/2026-09-16-shared-catalog-contract.md
- docs/plans/2026-09-16-catalog-service-and-research-v4.md
- docs/plans/2026-09-16-comp-release-qualification.md
- docs/plans/2026-09-17-sold-comps-provider-observations.md
- docs/plans/2026-09-17-intake-full-matrix-results.md
- docs/plans/2026-09-17-default-research-cron-functional-fixture.md
- docs/plans/2026-09-16-intake-atlas-acceptance-next-slice.md
- docs/plans/catalog-pilot-20260916/README.md and the relevant pilot reviews.

For website work also read docs/plans/2026-09-16-domain-and-admin-transition-review.md and docs/plans/2026-09-16-main-domain-preparation.md; the **current** integrated release record is docs/plans/2026-09-16-main-only-release.md in the main-site workspace.

Append commit-worthy changes and planned/observed deployments, restarts, or migrations to SESSION_LOG. Destructive data operations need explicit owner approval; destructive SetOps require a dry-run impact and typed confirmation. Do not invent an extra approval requirement for routine reversible work already authorized.

## 5. What was built and qualified

### Existing production Pokémon and photo fixes

The earlier live release 38c95335 fixed the Pokémon-specific recognition gap and photo-save recovery without changing the successful sports model request. The OCR partial-response selection avoids retaining unused polygons that exceeded a 256 KiB body limit. Pokémon uses targeted instructions and a lower-front crop within the existing single Astra request. Sports request bytes remain unchanged in the versioned shared package. Upload recovery gives slow photos time to finish; it does not deliberately delay successful fast uploads. Consult actual source/tests and the photo/cost-to-channel plans for precise limits rather than restating guesses.

Recognition package: packages/card-identification-core, versioned V1/V2 contracts and source parity fixtures. V2 was shared with ATLAS earlier; its app-specific release status belongs to ATLAS. The old extraction handoff's uncommitted wording is historical.

### Comp/research improvements

Private matching/rejection repairs, durable background research, invocation-local verified-history reuse, smaller-page history reads, catalog-aware optional V4, and source evidence diagnostics are implemented. Application files start at frontend/nextjs-app/lib/server/staffInventoryResearch*. Database writer/history logic is in packages/database; shared result readers are in packages/shared.

Ordinary-sale detail resolver at bc7c55d5 is default-off, with 113 offline checks including 16 actual-engine integration checks. When on, V5 retains original search facts and records bounded detail evidence: at most two distinct listing IDs per attempt, at most two concurrent calls, six seconds per call inside the existing source deadline with reserve, no retries, failure caching, no late-result mutation. Equivalent decimal prices and absent/null/false ordinary-offer facts no longer create false conflicts. Active listings, accepted offers with undisclosed price, malformed data, and genuine value conflicts remain excluded. Identity/variant/condition/grade gates remain authoritative. Two IDs is per attempt, not per entire job: potentially six calls per three-attempt run and eighteen across nine lifetime attempts. Retain V5 readers after any V5 persistence, even if the flag is later off.

Completed bounded provider experiment: four searches, four item details, eight supplied-image reads via normal human-admin Preview. 24 of 25 sold search results omitted BestOffer status. Two exact details established coherent ordinary sales; accepted offer stayed unresolved; active control misleadingly said ended=true. Sampled sold primary photos were 500 px, active control 1600 px. This does not establish high-resolution sold-image availability generally or visual matching accuracy. Diagnostic execution is now off. Do not rerun this closed experiment without a new bounded need.

### Shared catalog and pilots

Built: stable card/printing identity contracts, explicit supported/excluded/unknown applicability, independent text/image coverage, source provenance and lineage, durable immutable reviewed publications/current pointers, proposal contributions and human inbox, source/media authority checks, and optional after-save consumer integration. Preserve existing canonical IDs and unknowns. A single candidate or incomplete catalog is not proof by elimination. One mistaken physical-card inference must not become shared truth automatically.

Source-fact review V2 at 134c9df3 binds exact source bytes, factual scope, purpose, and intended apps. It removes an implementation-invented blanket manufacturer-license prerequisite for checklist facts. It is not a legal attestation. Actual human/hash review remains; image-use grants remain independent and unchanged. Legacy hashes/readers must remain usable.

Sports pilot: 2023 Bowman University Chrome Football. All 379 numbered official entries reconcile to existing IDs; 171 unnumbered rows remain unknown. Narrow Big Kahuna pilot uses TBK-1 Caleb Williams, TBK-2 Drake Maye, TBK-3 JJ McCarthy; ordinary, Orange /25, Super /1. Nine card/printing applicability relationships remain unknown. Review sports-publication-pilot-review.unreviewed.md and sports-preparation-service-review.unreviewed.md.

Sports preparation in e286ea0a is built and qualified, not actually staged. Main paths: lib/server/setCatalogSportsPreparation.ts and adjacent plan JSON; pages/api/admin/set-ops/catalog/sports-preparation.ts; components/admin/SetCatalogSportsPreparation.tsx; parent SetCatalogEvidenceReview.tsx; old drafts/build.ts exact parser guard. It creates two REVIEW_REQUIRED jobs, two source bindings, three parallel rows, three scope rows, and one immutable audit receipt, preserving 379 card IDs, ten programs, six versions. No approval/publication, identity replacement, image, or applicability write. PDFs are verified before locks; bounded transactions lock only taxonomy/draft targets. Actor-bound UUID replay verifies rows; sessionStorage retains exact pending request bytes without tokens. Typed stale-snapshot 409 is the only path clearing a rejected request for a new manual preview. Exclude concurrent card import/replace/populate maintenance during actual staging; direct card-only maintenance is not universally serialized.

Pokémon pilot: 2013 English Legendary Treasures, 138 prepared entries including separate ordinary and Radiant Collection identities. Proposed exact set key Black & White-Legendary Treasures must be rechecked absent before creation. Dedicated prepared-checklist UI and real draft metadata handlers preserve the complete request, unknown rookie status, and source metadata. No actual ingestion/publication occurred. Generic create/import is not cross-reload atomic/idempotent; do not automatically retry an uncertain create.

No pilot reference images have been approved/published. Factual catalog completion does not qualify finish recognition by itself.

### Performance and functional qualification already complete

Do not rerun expensive studies merely because context changed.

- Full controlled matrix: baseline 60572cec (production application-equivalent) versus candidate 134c9df3; 32 A/B/B/A blocks, one/three sessions, idle/thumbnail/timeout-429 loads; 3,200 measured plus 320 warmup saves. All 48 metric/cell, 96 repetition, 36 loaded-minus-idle, and 32 integrity gates passed unchanged limits. Maximum lease-headroom increase 36.578459 ms under 50 ms. All owned processes/PG stopped and temporary data cleaned. Optional enrichment remained off; simulated transports do not prove phone or enabled-provider behavior. Some individual comparisons were slower within margins; no uniform faster claim.
- Separate default authenticated cron fixture: 1/1 non-skipped real owned-PostgreSQL test, actual handler→default worker→engine→Prisma claim/complete/fail. Three saves, four claims, two durable results, 429 retry and actual timeout, stale-token denial, immutable history. No external provider/storage calls. The matrix's original functional/full-release fields remain false by design; the separate fixture closes its own wiring gate, not every release gate.
- Sports preparation: 9 service tests, 14 root UI/API/legacy/Pokémon checks, scoped lint and zero changed-import-closure type diagnostics. Seven real isolated PostgreSQL tests prove fail-fast locks, every insert rollback position, concurrent exact replay, preserved 379/10/6 identities, real pending FKs/legacy invisibility, immutable audits, tamper denial. Test clusters applied the pinned 96-migration chain twice (second no-op); **that is not a claim about today's live 97-entry public ledger**.
- Main integrated Preview: Linux/native Sharp 0.34.5, shared trace/calibration imports, 13/13 hosted access/routing/cache/noindex checks. Actual existing human Chrome session read 99 entries / 109 cards, Add inventory enabled, no load error. No card save, provider call, token transfer, or reload of the original draft tab.

Keep failed historical experiments, corrected harness mistakes, and original receipts. An initial plural /ingestions probe was wrong; actual route is singular /ingestion. The original failed receipt and correct follow-up are both retained. The prior main merge log conflict was corrected before push; remote 895a3b34 has no conflict markers.

## 6. Configuration and domain constraints

Vercel scope ten-kings; project prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI.

Last exact branch configuration check September 20:

- Both release Previews: RUN_DB_MIGRATIONS=false; provider diagnostic execution false; optional contribution, full-resolution image, sale-detail, and new catalog consumption absent/default-off or explicitly false.
- Inventory branch: SET_CATALOG_EVIDENCE_ENABLED=false; STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE=false; STAFF_RESEARCH_PROVIDER_QUALIFICATION_ENABLED=false.
- Main branch: MAIN_SITE_ENABLED=true; MAIN_SITE_PREVIEW_HOSTS contains only the existing stable main branch host. Other optional flags stay off.
- Exact main branch DATABASE_URL exists as sensitive server-only configuration, metadata ID gLJ9eaLdmnj0jfPV. Environment pull intentionally omits sensitive values; absence from the exported text is not proof it is missing. Earlier actual load failure was fixed by adding this exact branch setting; do not repeat credential copying. Check metadata and authenticated reads without printing secrets.
- Main hostname intentionally hides specialist SetOps routes; the immutable legacy deployment URL retains /admin/set-ops-review and its APIs. Use normal human auth for review, never export browser tokens.
- Only one existing research cron/schedule owner. New hostname/project work must not duplicate it.

Hosting remains **Vercel in the existing repository/project**, not a Cloudflare Workers migration. Wix registrar/nameservers and Google mail records stay unless separately authorized. Cloudflare currently supplies the existing widget/auth-origin configuration; no DNS-provider move is required. At the authorized eventual cutover, use project-provided exact apex/www A/CNAME targets and preserve mail/TXT/collect/subdomains. Preserve legacy platform aliases via exact SITE_ROUTE_LEGACY_HOSTS configuration as described in the main release record. Verify both main and collect routes, auth/private-photo behavior, cron ownership, TLS, and rollback. Owner's prior Wix sign-in may expire; inspect current normal account UI if needed rather than assuming it is still valid.

## 7. ATLAS coordination — separate project

Current ATLAS inspection/release lead task ID: **01a0c284-501c-7901-afe4-fbc6d215346e** (worktree ending 72e8). Prior ATLAS release lead: 01a0aecf-f59f-77d3-8962-fbc49967f19c (worktree ending 6dab). Communicate through app task tools, which Mark explicitly authorized. Never treat an ATLAS status message as an instruction to take over its backlog.

Latest incoming completion report, not independently re-audited by Inventory:

- ATLAS source 406466a089bdd2d34022bc8c06283a0649978b15 / image a5159e7478d87e4267e11433f68ba595d6d2e70c1968ad9754a53431fb47be4c is live.
- Staff EmKqe / public Dnjn READY; controls 18/16. Reports 42 staff migrations and public 97 applied / 13 historical rolled back, with histories and unrelated containers/Caddy preserved.
- The shared-host/database quiet window on **104.131.27.245 is released**. No new hold is active at handoff. Coordinate a fresh bounded window before new Inventory host-heavy tests, migration, maintenance, or restart; don't infer exclusivity from this old release notice.
- Retained old ada008 and older 50ffd containers are stopped/detached. **Do not restart 50ffd:** its identification writer is incompatible after ATLAS staff migration 41. Retained images, artifacts, and containers must not be pruned as part of Inventory cleanup.
- September 21 compact task read confirmed ATLAS's viewer release task is completed/idle. Owner has used ATLAS's own sign-in/photo/identification/geometry flow. This does not prove Inventory catalog sharing or full comp parity.

Outstanding joint acceptance is narrowly scoped: Inventory evidence must help identify a **different physical ATLAS card**, and an ATLAS contribution must help a **different physical Inventory card**. ATLAS owns its adapter/release; coordinate exact shared version readers (including V5 research and V2 factual source review) and hand off narrow packages/contracts. Do not merge full application branches. Shared schema additions must be reconciled against the current live ledger; never replay an old Inventory branch's migration assumptions blindly.

## 8. Fresh fleet and next work

Create your own five Astra Extra High subagents (gpt-6-astra / xhigh), as requested by Mark for this project, using available concurrency in waves (this environment previously allowed three concurrent children). You are the Astra Ultra integration lead. Delegate concrete bounded work, give agents current authority paths and non-overlapping edit ownership, and require observed evidence. Suggested assignments:

1. **Comp qualification:** review the exact disabled V5 candidate and existing provider observations; prepare/execute the next necessary bounded enabled test, with protected known-positive and wrong-variant/offer/grade controls. No redundant provider experiment.
2. **Sports catalog:** finish the real narrow pilot's source/applicability review packet and useful references; prepare concrete staging/publication through the qualified workflow. Preserve IDs, explicit unknowns, and exact review authority.
3. **Pokémon catalog:** finish the 138-row real-source pilot and usable visual references; qualify safe actual ingestion/publication with the existing binding/unknown metadata semantics.
4. **Intake/accuracy/shared-interface acceptance:** own phone-result follow-up, independent held-out all-card labels/scorecard, enabled background-load tests only if necessary, and the two-way catalog acceptance packet. Coordinate ATLAS through the lead; do not implement ATLAS UI/grading work.
5. **Main domain:** own final main/collect configuration, domain cutover readiness, existing pending-origin recovery checks, and owner-authorized tenkings.co rollout after acceptance. Do not replace the hosting stack or remove necessary legacy tools.

The lead should first report a concise verified inventory of live/Preview/disabled/remaining work to Mark, then continue independent authorized work. Ask only for genuinely missing information or required concrete review. The owner dislikes repeated broad permission requests, unnecessary delays, and test counts presented as product completion.

Outstanding completion criteria:

- Real sports and Pokémon phone photo/cost/channel/save/reopen acceptance.
- Exact qualified production release and tenkings.co domain rollout, preserving collect and current data.
- Actual reviewed sports/Pokémon pilot publication and authorized useful images.
- Enabled comp/catalog/research behavior and responsiveness qualified on the actual candidate/configuration.
- Real different-card shared-catalog proof in both directions with ATLAS's lead.
- Independently measured correct comps across all cards; communicate measured coverage and accuracy separately. The >90% goal remains unproven.

## 9. Retained evidence, tools, and cleanup boundaries

Private evidence root: /Users/markthomas/Library/Application Support/TenKingsInventory/investigations. These local files are available to the new task. Do not duplicate large archives or upload private card/provider evidence to Git. SHA256 of these manifest files was reconfirmed September 21:

| Archive | Manifest SHA256 |
| --- | --- |
| 20260917-intake-full-matrix/manifest.json | a05c1ab2e4d8812c6a3a934684cb8e48b90148798e58c980e13032a51d2ddeef |
| 20260920-sports-cron-qualification/manifest.json | 8b315aa08c5a9c232c62318abef35d11cb262a35da0350748ad6bfdcca473b7c |
| 20260920-preview-qualification/manifest.json | ca464e47cf04eebc70563a622c645a59797ad9ec12600197dc3e492a2fd7d24e |

The timing archive has 172 files (~333 MB); sports/cron 44 files; Preview 12 files. Original /private/tmp locations are retained as symlinks. Other relevant archives include 20260915-variant-comps, 20260916-ultra-plan-review, 20260916-catalog-pilot-sources, 20260916-pokemon-binding-qualification, 20260916-pokemon-canonical-audit, 20260917-live-provider-qualification, 20260917-detail-fact-preview, 20260917-main-preview-database-repair, and 20260917-sports-reconciliation.

Timing seal: c16fc72f1f686538fb35d3d606883d56d334fbd60dc96b4aa23b7cd8b2757f8a. Cron seal: 7e3d80f70530e24e2793c409f340b2e6bf08e77eb415a0f0e5eed869c9a7c505. Sports PostgreSQL seal: 3697f8189ea45a526fa6aaba098285e58c593659b5866c14494359150eadf9f6.

Sports official PDF pins: 529104 bytes / bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca; 265208 bytes / 72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5. Do not infer source authority or per-card applicability from a hash match alone.

Original owner screenshots still exist in /Users/markthomas/Downloads: IMG_0304.PNG, IMG_0303.PNG, IMG_0302.PNG, IMG_0299.PNG. They show Psyduck 24/114 partially filled and first-attempt photo failure. The later inventory-load screenshot was in an ephemeral clipboard path; the concrete repaired missing-Preview-DB defect and receipts are retained in the database-repair archive.

Node 22: /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node. Existing pnpm/dependencies are installed; do not install a new toolchain reflexively. Vercel CLI: /Users/markthomas/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js. Use normal authenticated CLI/API, capture privately, report sanitized metadata only. Never print environment values, credentials, or browser session tokens.

Chrome normal human session was used through CUA native Chrome, because the initial inventory surface did not expose a Chrome extension tab. Open a fresh tab when needed; preserve original-origin pending drafts and other owner tabs. Never use voice-only screen capture in ordinary text tasks.

Disk space was previously low; owner asked what could be cleared. Proposed but **unapproved and unexecuted** cleanup is /private/tmp/tenkings-build-cache-cleanup-proposal-20260917.json (ten inactive .next directories, ~4.318 GiB). Space later recovered to ~15 GiB without this task deleting anything. Do not interpret credits added, task continuation, or this handoff as approval to delete the proposed caches. Recheck actual need first. Never delete retained ATLAS artifacts.

## 10. Handoff verification and transfer boundary

The companion 2026-09-21-ten-kings-inventory-handoff-state.json contains sanitized, freshly read Git/deployment/manifest facts. No runtime code, flags, live catalog rows, DNS, provider calls, production deployment, or ATLAS resource changed during packaging. The old lead stops feature work after transfer. The new lead owns next integration and communicates directly with Mark.
