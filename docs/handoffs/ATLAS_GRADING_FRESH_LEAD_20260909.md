# Fresh ATLAS grading lead handoff — September 9, 2026 Pacific

Mark explicitly requested a **new independent lead task using GPT-6 Astra with MAX reasoning**, with multiple **new subagents** doing parallel implementation. This is a transfer of lead ownership, not a child assignment under the outgoing lead. Start working after reading the handoff; do not stop at another plan or a general permission request. The outgoing lead will stop implementation and deployment work after delivery.

## Start from the right repository state

- Outgoing task: `01a0873d-cbbe-7781-90cd-3433787751d7`.
- Outgoing checkout: `/Users/markthomas/.codex/worktrees/b487/ten-kings-mystery-packs-clean`.
- Outgoing branch: `codex/atlas-activation-lead-20260909`.
- Last application source, currently live: `c5ba35fb5e638ff3ba508605dbe9e70a191a0ba0`.
- Prior documentation checkpoint: `08f85c22c0252d98f72d379f7e274e263133f982`. This handoff and the fresh-workflow requirements are committed after it. Use the exact handoff commit in the new task's bootstrap file, not the saved project's default checkout or an older ATLAS branch.
- The saved project is `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`. It shares Git objects with these worktrees, but its default checkout does not contain the current ATLAS application. In your new clean worktree create a new `codex/` branch from the supplied handoff commit. Do not reset or edit the saved project's checkout, the outgoing branch or unrelated worktrees.
- Private bootstrap/operational snapshot: `/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/START_HERE.md`. It contains the exact handoff commit and source/access pointers without credential values. Read it first if your starting worktree lacks this file.

Read the AGENTS-required files: `docs/context/MASTER_PRODUCT_CONTEXT.md`, **all of** `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, and `docs/handoffs/SESSION_LOG.md`. Then prioritize `docs/atlas/GRADING_WORKSPACE.md`, `COMPLETION.md`, `WEBSITE_RELEASE.md`, `WEBSITE_DEPLOYMENT.md`, `CONTRACTS.md` and `APP_EXTRACTION.md`. Runtime/DB/code evidence supersedes stale prose. Record corrections in the same session. Append SESSION_LOG for commit-worthy changes and before/after each deployment, restart or migration.

## Owner's current product direction

Build the complete private grading workflow at `https://atlasgrading.com/admin`, operated from Mark's MacBook browser. The current screen is the final human review queue with zero cards. Mark needs the beginning and middle of grading too.

**Human adds new card photos → Waiting to grade → Astra or human grades → Final human review → Approved report → Label/NFC/slab finishing.**

- Humans photograph physical cards. Let them add many cards upfront, explicitly pairing Front/Back images for each physical card. Save recoverable drafts; incomplete or unverified uploads cannot enter the ready queue. Do not silently guess photo pairing.
- A shared **Waiting to grade** queue feeds Astra or human graders. One exact card/evidence revision has one active operator. Show waiting, current operator, in-progress stage, needs attention, human review and approved states from durable records. Prevent competing human/Astra claims and duplicate paid work.
- Humans can operate the **entire** grading path manually. Astra must not be a prerequisite for manual grading.
- Humans can **watch Astra work**, including actual image/region inspections, observations/proposals, finding changes and calculated report changes. Display recorded actions/evidence, not private model reasoning or fabricated progress.
- Support observing without taking control and safe pause, supervised step-through and human takeover. Before changing operator, handle in-flight/unknown work explicitly. Never let a late machine result overwrite human edits or drop budget holds.
- Keep Astra's original proposals and subsequent human corrections for comparison and evaluation. Correcting a card does not silently fine-tune the model or update trusted learning.
- Every completed draft goes to a **separate final human review queue**. Humans explicitly correct and approve the exact report. Astra cannot certify or publish its own result.
- Preserve deterministic measurements, the original grading formulas, evidence/trace history, existing report URLs and separate approval/learning authority.

The pilot remains **exactly ten real cards, all using brand-new photographs**. Mark's initial answer choosing saved Speedster captures was explicitly superseded. No cards or new photos have been supplied/selected in this task. Build the product entry flow so Mark can add them there. He can fill all ten queue entries upfront; validate the first processing path before running the remaining batch. Fresh photos for this cohort are mandatory; historical real captures are not substitutes for this pilot.

Admin grading/Astra is the current priority. Further customer-submission iteration follows it. Physical finishing is still required for full completion but can follow the supervised browser-grading pilot.

## What is actually live and verified

- Three isolated Next15.5.25 ATLAS projects: staff `frontend/atlas-app`, customer `frontend/atlas-customer`, public/router `frontend/atlas-public`. The apex serves the restored gold/black marketing homepage. `/admin` is private staff and `/account` is customer; preserve the routing, sessions, nonce/CSP, CSRF and asset boundaries.
- DNS, managed TLS and www-to-apex308 are live. Original marketing Site version21 was preserved and ported into the public app. Do not replace the design with the former sparse pilot landing page or repoint the whole domain.
- Customer phone signup/sign-in and staff roster phone sign-in work. Both accept ordinary U.S. ten-digit numbers and common formatting, adding `+1` through the strict Verify provider handoff. Explicit international codes remain supported subject to current admission.
- Source c5ba35fb fixed `frontend/atlas-app/lib/server/access/auth.mjs` to call `provider.start(phone)`, using the normalized value. Its actual-adapter regression catches raw-ten-digit failure and canonical replay. Do not undo this repair.
- Sixteen additive ATLAS migrations are installed in the managed PostgreSQL target. Existing public migration bytes/history are preserved. Staff/customer serving credentials are separate and restricted; no broad public-schema access is granted to staff serving code.
- Live c5ba35fb checks passed:46 bounded HTTPS GETs covering alias/TLS, www308, restored homepage, authenticated bootstrap boundaries, direct-deployment proof denials, forged-header replacement, mounted assets/data and original artwork/font hashes. Staff build/native-engine boundary and62 focused authentication tests pass. The prior homepage revision passed252 combined app/router tests and all three app builds. These test counts are dated evidence, not a replacement for testing changed code.
- Mark confirmed the repairs work and signed back into staff. At2026-09-10T00:06:06.105128Z readback: one current revision6 staff session, fresh challenge consumed00:02:21.012UTC after one check, one staff identity and one customer account. Current-revision customer sessions were0. His screenshot shows the empty Review queue. Do not send another code merely because an older tab is stale.
- Login controls are enabled at revision6; SMS policies enabled at revision4. They bind the c5ba35fb deployments. Changing source/deployment requires coordinated exact bindings and incrementing control revisions, which invalidate old sessions.
- No real-card grading, live Astra evaluation, paid image/model pilot, approved live grading report, real print or completed production NFC/slab/weld acceptance has been performed by this lead.

## Critical missing work and source map

The last clarification turns changed **documentation only**. There is no new Add cards UI, intake queue service, full manual workspace, live activity view, pause/takeover implementation or queue runner yet. Do not report these as delivered.

1. `frontend/atlas-app/pages/grading.jsx` is an assigned review queue. `components/Shell.jsx` exposes Review queue/Operations only. `pages/cards/[cardId].jsx` has review/report, trace corrections, proposal decisions, identity corrections, approval and finishing components. They are a reuse base, not a complete new-photo workflow.
2. `components/OperationsWorkspace.jsx` currently uses technical source IDs/owner IDs, hashes and manual pilot forms. `lib/server/access/operations-runtime.mjs` returns null unless separate operations configuration is enabled. Merely granting Mark operations access does not create the requested photo intake screens.
3. `lib/server/access/intake.mjs` and `frontend/nextjs-app/lib/server/atlasIntake.ts` admit an existing exact `SPEEDSTER` source. The source must be `CAPTURED`, with verified preparation/head/map/identity authority. It does not create or upload a new card.
4. New-photo reuse starts at `frontend/nextjs-app/components/ai-grader-v2/CaptureWorkspace.tsx`, `PhotoUploadPair`, `GeometryAssist`, `CenteringAssist`, `ReviewWorkspace`, and neutral `lib/ai-grader-v2` modules. CaptureWorkspace is about3,149 lines and imports `buildAdminHeaders` and legacy routes. Extract explicit ports; never import legacy pages/API handlers, admin auth, wallet shell, broad Prisma or generic signing authority into the staff app.
5. Existing source creation/upload handlers are `frontend/nextjs-app/pages/api/admin/ai-grader-v2/sessions/index.ts`, `upload-plan.ts`, `image/[action].ts`, `sessions/[sessionId]/preparation.ts`, `prepared-image.ts` and `original-image.ts`. `lib/server/storage.ts` preserves exact object/size/MIME/SHA integrity. New ATLAS ownership/source mapping has not been chosen. Decide the minimum scoped adapter, preserving one authoritative evidence/grade implementation; do not invent a client-selected legacy owner or copy whole historical sessions.
6. `packages/database/prisma/schema.prisma` has authoritative `AiGraderV2Session` with scalar `createdByUserId`, identity/capture/report and preparation heads/manifests. Staff's own schema has specimens, assignments, revisions, initialization/operator/attempt/step/outbox ledgers. It has no complete new-photo draft/queue path today. Any additive policy/schema work needs meaningful restricted-role, concurrency, idempotency and recovery validation; never edit historic migrations.
7. **Preparation blocker:** `frontend/nextjs-app/lib/server/speedsterPreparationRelease.ts` has `approvedPreparationRelease = null`. The older admitted detector is not a compatible preparation release. Do not remove the gate, fake a manifest or treat an environment/tag claim as worker acceptance. Build/verify the actual compatible preparation service and exact CPU contract before admitting new evidence.
8. Private adapters exist in `frontend/nextjs-app/lib/server/atlas*.ts` and `pages/api/internal/atlas/`. There is no `frontend/atlas-private` app. Private grading/storage/worker dependencies and their hosting are not connected to the current three website projects. Inspect before proposing deployment; do not deploy the unrelated Ten Kings application just to obtain these routes.
9. `atlasMachineInitialization.ts` admits one signed exact job, executes current original initialization/fresh detection, then enqueues an Astra run only after confirmed success. `frontend/atlas-app/lib/server/access/machine.mjs` signs admission, not execution. Unknown outcomes do not retry automatically.
10. `packages/atlas-operator/src/runtime.mjs` exposes only `read_card_report`, `inspect_region`, `propose_identity`, `propose_finding_change`, `submit_for_human_review`. It is a bounded report/crop/proposal operator, not yet a complete capture/geometry/manual-equivalent workflow. Extend with reviewed concrete tools and evidence/authority, not model-generated grades.
11. Existing `StaffOperatorStep` records and immutable proposals can support a restricted activity projection. `lib/server/access/operator.mjs` currently exposes only a pending count. Never return private continuation, raw provider responses or execution credentials to the human browser. Existing machine/human locks and unresolved operations must survive the new controls.
12. `packages/atlas-operator/README.runtime.md` supports an exact native **Darwin arm64 Node22.23.2** artifact, not the HomebrewNode20 executable or a Linux artifact. Current packages are explicitly synthetic/inactive and no production runner host is selected. Linux needs its own reviewed native closure. Choose the smallest supported real pilot runtime; do not invent hosting readiness.

## Parallel execution

Mark explicitly authorized and requested new subagents. After a bounded initial review, agree a small shared contract and start **three fresh independent implementation lanes** where available. Use inherited Astra/MAX settings; do not revive the outgoing lead's historical subagents.

1. **Capture and queue:** reusable photo intake/storage ports, saved drafts, Front/Back pairing/readiness, queue records, exclusive claims and appropriate restricted-role/concurrency tests.
2. **Human workspace:** complete manual photo/preparation/centering/inspection/report UI, stage navigation and front-end transport ports. Preserve the existing ATLAS visual language and all current correction/recovery behavior.
3. **Astra operation and observation:** concrete full-workflow tools where missing, safe recorded activity projection, pause/step/takeover/continuation and queue consumption through existing bounded run controls. Include stale/in-flight/budget tests.

The lead owns the API/DTO agreement, shared schema/migration integration, architecture decisions, original-formula/evidence preservation, provider/storage/worker readiness, release choreography and end-to-end browser acceptance. Assign disjoint file ownership, sequence shared schema edits and integrate small changes often. If a lane depends on another, give it independent useful work while the contract is finalized. Do not create three competing implementations or turn all agents into open-ended reviewers. Provider/production writes stay with one lead.

First deliver a usable new-photo card entry/queue and manual grading path. Then prove an observed Astra run, take over safely, compare corrections and finish exact human approval. Keep screenshots/trace evidence for actual acceptance and clearly distinguish local fixtures from real cards. Let Mark use the built flow to supply his photos; do not ask him to work around missing UI by pasting source IDs/hashes in Operations.

## Existing authorization and constraints

- Mark already authorized provider access, live website activation, approved staff phone, Twilio name warranty and **$100 TOTAL for SMS/images/Astra pilot**. Current SMS partition is at most$10 combined; remaining worker/Astra maximum is$90 before actual resource pricing/reservations. This is not a new budget for each task or worker.
- Current SMS pilot is owner-phone-only and uses the original seven-day window ending **2026-09-16T20:41:57Z**. At latest readback, seven retained claims reserve$3.50: staff five/$2.50, customer two/$1. Amounts are conservative exposure, not invoices. Preserve unknown/superseded claims, cap, fee evidence, identity and window; never reactivate as a fresh pilot or reset reservations.
- Continue authorized build/fix/read-only work autonomously. Resolve actual resource inputs and prepare concrete reviewed release actions; do not ask Mark to re-authorize the entire already approved project. Actual payment/resource or irreversible steps beyond existing scope still require their specific authority, after preparation.
- **Do not Git push or trigger legacy preview deployments.** There is a documented legacy preview credential hazard. Recent ATLAS releases used clean exact-commit uploads to the three isolated Vercel projects. A local commit is not a deploy. Keep unrelated Ten Kings projects/roles/services/DNS/mail untouched.
- Append planned actions before deploy/restart/migration and observed results afterward. Use additive migrations only. No destructive data/set operations without explicit approval; destructive set operations also require dry-run impact and typed confirmation.
- Preserve existing grading formulas, history, maps/Memory authority and issued report/QR/NFC URLs. No legacy `complete-label` HOUSE inventory writer for ATLAS issuance. Report approval remains trained human; trusted learning is separately approved and not automatically applied to the bank.
- Full finishing target is MacBook + ACS ACR1552U + FEIJU F8215. A designated test URI write/readback and phone scan passed; permanent-lock qualification/integrated automatic finishing are unfinished. Reserved production tag untouched. Do not revive Windows as the grading requirement or permanently lock a tag as an incidental test.
- Never print or commit credentials, phone numbers/codes, provider tokens or signed image URLs. Keep private release data at0700/0600. Preserve unknown/outstanding requests instead of blind retries.

## Operations and evidence pointers

Private base: `/Users/markthomas/.codex/atlas-handoffs/2026-09-07/`. Current details are in the new bootstrap and these files; older FRESH/NEXT_ACTIONS/RELEASE_PLAN records contain stale earlier hosts, branches and permissions, so use them selectively as history.

- `fresh-lead-hosting-review/activation-helper.mjs`: reviewed provider read helpers, private file handling, exact constructors/manifests and gateway bindings. Many later one-shot scripts require HEAD atc5ba35fb or reject existing output; do not blindly rerun them on a new source.
- `fresh-lead-hosting-review/read-current-signin-status.mjs`: target-guarded read-only current-control/session/SMS metadata. Counts session validity against current control/browser/access revisions; it does not expose phone/code/token values. Current receipt: `fresh-lead-provider-activation/canonical-phone-repair-20260909/current-signin-status-1788998766113.json`.
- `fresh-lead-provider-activation/canonical-phone-repair-20260909/`: exact c5ba35fb clean manifests, deployments, bindings, guarded SQL dry-run/apply/promotion evidence and46 live checks. Earlier homepage-phone/document-render directories retain older checkpoints.
- `fresh-lead-database-review/provision-reviewed-atlas-logins.mjs`: `remoteSql` helper with read-only default and narrow target guarding. SSH alias `tenkings` keeps credentials in the remote process/container; never print them. Inspect its actual implementation and result handling before use.
- Node for normal website builds: `/opt/homebrew/opt/node@20/bin/node`. Repository pnpm9.12.0, Prisma5.22.0. New worktree dependencies/generated clients are not committed; install from locked/offline artifacts where available, then generate/build the shared core and app client normally. Do not indiscriminately rerun root operational scripts.
- Existing exact operator package examples: `RELEASE_ARTIFACT_INITIALIZATION_V2_M13` and `_REPEAT`; these are synthetic native-closure examples, not selected live worker manifests.
- The existing `frontend/atlas-app/README.md` has useful fixture commands but many older acceptance counts. Current deployment and readiness authority is WEBSITE_RELEASE/COMPLETION plus actual code/DB, not the original fixture narrative.

User's browser screenshot is Chrome at `/admin/grading`. IAB has older DO, Namecheap and ATLAS login/customer tabs; inventory current surfaces before acting. Do not confuse an expired older tab with the owner's current session. No new photos have been uploaded, and no current code-entry request is waiting on Mark. Only contact Mark for concrete missing inputs when the corresponding flow is ready.

The outgoing lead's last changes before this handoff are requirements/readiness documentation. They do not alter the selected application deployment. Maintain that distinction throughout the new task.
