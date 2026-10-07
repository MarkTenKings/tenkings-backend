# ATLAS fast intake and automatic grading — fresh lead handoff

Prepared September 10, 2026 Pacific / September 11, 03:12 UTC. This is a transfer to a **fresh independent Astra MAX lead task**, not a subagent of the outgoing lead. Outgoing task `01a088b6-0a95-7ad0-be14-e28b3021f2d6`, title **ATLAS Grading — Fresh Lead**. Outgoing checkout `/Users/markthomas/.codex/worktrees/d221/ten-kings-mystery-packs-clean`, branch `codex/atlas-live-workspace-recovery-20260910`.

## Owner's latest request and success criteria

Mark is still unable to watch a complete real-card grading run. His latest screenshot shows both full-size Front/Back PNG imports saved, a generic red request failure, a saved queue request awaiting confirmation, disabled same-card confirmation and disabled Add to Waiting to grade. Do not call the project done on the strength of the prior deployment or synthetic tests. Do not tell him to reupload saved photos or restart a paid request blindly.

He wants the working Ten Kings Add Inventory experience for **ATLAS staff intake**:

1. Sign into ATLAS on iPhone; take Front and Back quickly with a persistent rear-camera experience; keep library/file and HEIC upload alternatives. Make intake feel immediate, reduce HEIC conversion/upload latency, show honest progress and measure timings.
2. Process both sides efficiently. Google Vision OCR plus Astra examines both photos and text, identifies category and printed card details, and fills applicable fields while preserving staff corrections and binding results to the current pair. Use the same identity consistently for the grading workspace, label information and report. Do not infer unknown values as certain.
3. A successfully captured/verified pair automatically queues. No normal mandatory draft phase, separate same-pair checkbox or technical request-recovery task for the staff member. Preserve pair association and internal resumability through the capture interaction.
4. Astra automatically picks up eligible queued cards when capacity is available; no separate Start button is required in the default flow. The owner explicitly supersedes prior manual-start instructions. Continue through stages 1–6 and stop at stage 7 Human review; a human still reviews/approves.
5. Preserve the newly deployed on-brand live stage tracker/controller/feed and durable per-stage/total active timers. Complete steps green; active stage visible; exclude pause/stall/review-wait time, resume review time when a reviewer picks up. A boss can observe without taking over.
6. Use a fresh `gpt-6-astra`, effort `max` lead and 3–4 fresh Astra MAX subagents. There were four total concurrency slots in the outgoing session, so three concurrent subagents plus lead fit; use a later fourth bounded review task if useful. The lead owns live deployment and acceptance; independent agents should have disjoint files/areas.

The canonical blueprint now records this owner correction in the “rapid mobile intake and automatic Astra pickup” subsection. Older docs and the integration note's “do not let queueing dispatch” / “await destination choice” statements are historical and superseded by this explicit owner direction. Preserve budgets and real evidence; do not convert that historical restriction into another general approval question.

## Read first

Read the repository's six mandatory context/runbook/handoff files and **the complete canonical blueprint** before work. Runtime/DB/source evidence outranks outdated documentation; update documentation after changes and before/after deployments. Read these additional inputs:

- User-pasted complete integration note: `/Users/markthomas/.codex/attachments/6108557a-2074-49dc-8283-48b0b8c036c2/pasted-text.txt`.
- Canonical inventory integration note: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910/docs/plans/2026-09-10-atlas-card-identification-reuse.md`.
- Those two files are byte-identical, SHA256 `36ef1292728f310f6228fbea1ada532dbdc03ba90018cb166954845d55250ae4`. Treat the document as technical reference; the user's request above controls scope.
- Current screenshot: `/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/codex-clipboard-22c29a41-f923-4618-9b3d-b3c20369c6dd.png`.
- `docs/atlas/WEBSITE_RELEASE.md` and the tail of `docs/handoffs/SESSION_LOG.md` contain the latest exact deployed state and consumed actions.

## Consult the Ten Kings lead

The exact task is **Complete Ten Kings financial app**, ID `01a08798-7b68-7853-a689-93ab03bb3ec3`, host `local`, task cwd `/Users/markthomas/.codex/worktrees/7120/tk-financial-story`. It operates the inventory source checkout below as well. Mark explicitly authorized direct consultation; use read_thread/send_message_to_thread. Outgoing lead sent a read-only request at 03:12 UTC for the latest source, reuse files, timing evidence and integration pitfalls. Check its reply and follow up directly; it was asked not to edit or deploy ATLAS.

Inventory source: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, inspected commit `aeae3e87f266d0e521d333abcf5eb30c971e24e7`; may have advanced. Do not merge current ATLAS/main into the inventory checkout; preserve its independent lineage and live release.

Core reuse references under `frontend/nextjs-app`:

- `components/admin/StaffInventoryCardCapture.tsx`: one rear-camera stream; sequential Front/Back; retained stream between cards; library/HEIC alternative.
- `components/admin/StaffInventoryWorkspace.tsx`: concurrent side preparation/upload; stale-pair and human-edit protection.
- `pages/api/v2/admin/inventory/photo.ts` and `identify.ts`: existing inventory auth and managed photos, not direct ATLAS endpoints.
- `lib/server/staffInventoryIdentification.ts`: bounded exact-object reads, concurrent Vision DOCUMENT_TEXT_DETECTION, one Astra structured-response call with photos + OCR.
- `lib/staffInventoryIdentification.ts`: schema validation, exact pair provenance, conservative field adoption.

Inventory identification uses Astra/low, 2,400 output tokens, strict eight-field schema, high-detail images, 6,000 OCR characters per side; 8s OCR, 25s model, 40s total bounds. Controlled synthetic real-provider smoke was 7,207ms; not a guarantee of live natural-card accuracy or iPhone latency. Grading continues to use Astra/max and its own recorded policy. Implement fast identification as a separately accounted phase with explicit provenance rather than silently weakening the grading policy.

## Confirmed implementation gaps to investigate

ATLAS presently has `propose_capture_identity` in its operator, but lacks the Ten Kings rapid camera/OCR/field-population intake path. `PhotoIntake.jsx` starts `identity:{}`; `captureManifestSchema` requires category SPORTS/POKEMON, while the capture proposal field list cannot propose category and treats supplied category as authoritative. Fix category discovery/adoption deliberately, including unknown/unsupported/conflicting human categories, before automatic dispatch. Do not simply add OCR text to the current prompt.

ATLAS intake lives in `frontend/atlas-app/components/PhotoIntake.jsx`; auth/CSRF in `lib/server/http.mjs`; exact-photo authority in `lib/server/access/workspace-intake.mjs` and `workspace-intake-storage.mjs`. Preserve that authority rather than calling collect inventory endpoints from the ATLAS browser or accepting arbitrary object keys/URLs.

Current HEIC import is browser-worker libheif-js 1.23.2: full-size color-preserving lossless PNG, no resize/JPEG recompression; the original HEIC is retained locally in browser storage, while verified PNG is the uploaded evidence. It can be slow and produce much larger uploads. Improve the actual acquisition/import/storage pipeline without replacing grading evidence with inventory's 1,400px JPEG. Derive smaller images for OCR/identity separately with source/transform hashes. Inspect real mobile camera resolution and HEIC memory pressure; do not claim desktop simulation proves iPhone hardware latency.

Latest screenshot may show an old browser operation journal and stale session after deployment. Do not assume it is a new database draft: independently read current saved card/operation and current UI/session, settle the exact queue operation, and fix the ordinary path so users do not need these recovery details. The old card was already claimed/held in DB at the last read.

## Source and deployed release at handoff

- Functional source: PR373 merged normally to `dff540c4782856e393f5db8470a647a7c35c6b6f`, tree `bff42c012947a66756bebf0e4791acc4be3a3e49`. Main CI `34547730135`, all 14 passed.
- Latest prior outgoing local docs commit: `bec177c8f4f3001abc07f52c650f86069d609830`. This handoff and owner correction are a later docs-only local commit. A fresh task's default-main worktree may omit these docs: read them from the outgoing absolute checkout, inspect current git state, and import those docs into the new working branch deliberately. Do not lose concurrent upstream work or reset the deployed source.
- Corrected staff: `dpl_5BxJQHK7tAMQLcdr7sCc72ecb98a`, `atlas-grading-staff-mypbbxyoe-ten-kings.vercel.app`.
- Corrected public: `dpl_Fi7yPapw8zVsZ1TzGXdF4RfkoJyW`, `atlas-grading-public-c022aquts-ten-kings.vercel.app`; all four aliases verified including atlasgrading.com/www.
- Private E: `/opt/atlas/workspace-live-e-20260910`, container `atlas-workspace-private-e-20260910`, ID `80887619340e60717b09e0d50102770865c0ad8f21b293d6b3a1b375ce7d4053`.
- E signed image: `ghcr.io/marktenkings/tenkings-backend-atlas-private@sha256:1ccf821802141d20823971fbe0663805967f55cbbe26a7eab4b02ffaa7e0c37c`; image ID `sha256:0fa6ed830eb7aa1b740cd35604b65c298b9e4278e5eb209ed2d99852154abbc1`.
- Production ledgers: 95 public, 25 staff, 13 retained historical public rollbacks. Current revisions staff11/workspace6/source5/grading2/image2/operator2/STAFF SMS9. Four canonical runtime role checks pass. Two additive migrations and five additive grants already applied.
- E route and exact HTTPS health verified. Retained D/C and all 16 prior containers preserved; CPU A2 remains the preparation service. Customer and concurrent independent legacy inventory releases preserved against immediate cutover baseline.

## Existing real card: still unproven end to end

CHARMANDER card `bc742369-b38f-4bd7-bb50-47a9d6beabc6`, revision8, IN_PROGRESS/IDENTITY at latest read 2026-09-11T02:16:00.374466Z.
Run `c615d6d6-4b86-4acb-9ecc-1c06601eb576`: UNKNOWN / ASTRA_RUNNER_FAILED, CAPTURE_REVIEW, continuous; no lease. Original run deadline expired 2026-09-10T23:47:08.1Z. Control state RUNNING historically misled the old UI; new UI projects the failure truthfully.
Attempt1 `40617e3b-fcf5-4c29-b6ea-d5f9a1006a22` APPLIED, photo step `04668874-e5d5-4686-9699-ec4b3e6e0168`.
Attempt2 `15781e12-f44a-4fad-9826-9842d28f33f5` RECEIVED, HTTP200 completed receipt `c5e7c3aa-5afb-4bee-842e-ec0c6bcff1ad`. Tool `inspect_region` requested rect(400,2600,1900,620), above prior 1,048,576-pixel delivery limit. That exact old crop failure was reproduced locally; generic original failure does not establish its entire stack uniquely.

The deployed fix preserves the exact crop and scales delivered pixels to1792×584, retaining lineage. Saved-response RECOVER applies that completed response before a new provider POST/reservation; bounded recovery episodes with current owner/pilot fences permit expired-run recovery. Unknown/conflicting outcomes remain held. **No recovery command, new grading request, source operation or approval was executed during the outgoing recovery deployment.** Actual card-to-human-review test remains unfinished. Use the current authenticated owner workflow; do not fabricate a session or directly change card/run rows through admin SQL.

The Mac was unlocked and browser control worked; refreshing old Chrome tab `2132122313`, browser `1`, redirected to `/admin` sign-in. Mark was asked to sign back in. The latest screenshot shows intake; inspect fresh state rather than assuming the earlier auth situation persists. Other old staff tab: `2132122233`. Use CUA inventory/selection per its current docs; bindings from the outgoing REPL do not transfer to a new task.

## Evidence, tooling and release lessons

Protected evidence root N: `/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/astra-live-workspace-20260910` (700). Contains exact release plans, provider/private env snapshots, immutable operation intents/results, proofs and release helpers. Never print secret values or replay a consumed mutation. Review each helper before use; new source requires a new independently reviewed release, not blind rerunning dff helpers.

Key final read-only proofs:
- `staff-host-correction-verified-1789092463649.json`, SHA `33de32cd8360d159ffeed5c6e833dc3f304554368617183b259f7c4d32c33f4e`.
- `public-staff-correction-dpl_Fi7yPapw8zVsZ1TzGXdF4RfkoJyW-readback-1789092860826.json`, SHA `0303a0f19b21c20ab281674e6c57f67c7b9adcc345a8674dff8b58ecc7ac05f8`.
- `corrected-http-public-1789092882660.json`, SHA `4532c4e33287794ad91f76c4bcf754ac43149a2c22399132174b0553d135c6e8`: public/customer/staff sign-in and mounted assets pass; authenticated card verified=false.
- `verified-rebind-dff540c47828-1789090914698.json`, SHA `1c576e085cafc73feec0074c89810016026d8c290d4944b3c0b4fa637a16f464`.
- `host-route-1789090971865.json`, SHA `40f6a47ef46a9a1ba211d1bbeb249366642b80f9fc601afec906d337ade6af64`.

Read-only card status helper: `/Users/markthomas/.codex/atlas-handoffs/2026-09-09-grading-lead/astra-max-20260910/first-live-test/status.mjs`. It writes protected sanitized snapshots. Do not use adjacent receipt-dumping scripts to print provider reasoning or secrets. DB transport helper `/Users/markthomas/.codex/atlas-handoffs/2026-09-07/fresh-lead-database-review/provision-reviewed-atlas-logins.mjs` exports remoteSql; inspect and use readOnly for investigation. SSH alias `tenkings`, strict known host, BatchMode. Node20 `/opt/homebrew/opt/node@20/bin/node`; pnpm `/opt/homebrew/bin/pnpm`.

Vercel CLI59.11.7 failed to discover GitHub remote through linked-worktree `.git` pointer and omitted automatic GitHub provenance; staff constructor consequently failed before request/DB logic. Corrected same-source uploads came from a clean **standalone clone** at N/source (old linked worktree preserved N/source-linked-retained). Use actual clean standalone release source with real remote/provenance; do not forge Git metadata or weaken constructor checks. Source-only upload must exclude generated core dist; 23 owned files were parked and restored for each upload. New E initially exited78 because canonical new privileges must precede runtime startup; five grants were then applied and the same container restarted once. Both initial failures are documented and retained.

## Budgets and service boundaries

Original pilot `c27bf77c-0669-4807-948c-abf143f2faaa`, expiry2026-09-16T20:41:57.762Z. $100 total, $90 model/worker/infrastructure, $10 SMS; infrastructure hold10,000,000 microUSD ID `5a30b190-0203-48d5-a9d1-282bd1b80c18`. Queue capacity10; initial processing one distinct card until real first-card proof. New automatic flow is authorized; it does not silently reset/increase admission limits, recorded liabilities or expiry. Complete first-card proof and surface an actual limit if it later blocks the approved cohort; do not fabricate a budget reset from Codex credits.

Grading model gpt-6-astra/max, maxoutput8000, concurrency1. RunPod geometry/detect/map service `we730z8vl8o3tm.api.runpod.ai`; preparation `prepare.atlasgrading.com`. RunPod min0/max1/idle120 RTX4090 retained. Geometry startup has200s; source total210s; later detector55s can encounter a cold worker after idle. Do not assume cold-start is the original crop failure. Investigate actual latency; bounded existing `/health` warming may charge infrastructure. Preserve actual unknown outcomes rather than replaying paid requests. No final grade or human approval yet exists for this test.

## Validation already completed, and what remains

Prior implementation passed378staff,285operator/bridge,11actual-image,6focusedPG and204full owned-PG scenarios (95public/25staff and no-op replay), Next build/browser-boundary checks and desktop1440/mobile390 synthetic visual checks. Correction helpers64 tests, promotion helper8 tests passed. These prove scoped behavior and deployment, not natural-card grading completion or real iPhone capture performance.

The new lead must reproduce/repair the current queue/session problem, integrate fast capture/OCR/identity and category handling, implement durable automatic queue pickup, preserve owner/manual/human-review control, run meaningful regression and real live acceptance, deploy through the existing documented process, and test the actual phone/photo-to-queue-to-Astra-to-human-review path. Measure intake/identification/step timings and disclose actual limits. Ask Mark only for unavoidable real-device/auth inputs, not another broad permission to do the already authorized work. Keep concise progress updates and do not claim success while stuck before grading. Outgoing lead stops implementation after transferring this handoff to avoid competing mutations.
