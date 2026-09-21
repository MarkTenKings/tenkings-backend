# ATLAS inspection viewer — fresh Astra Ultra lead handoff

Current release pointer — September21,2026,23:21UTC: the subsequent [report-review release](report-review.md) is live on source `f00f2a18372f68c63dc5bbe8dada2b7c616104d8`, carrying forward this completed inspection viewer and its versioned context crops. It adds corrected collective confirmation, a full interactive draft and the owner's half-point final-grade policy. Final proof preserved the saved Charmander revision9 and seven proposals without adoption or report approval. See the [connected release runbook](../../runbooks/CONNECTED_MANUAL_RELEASE.md) for current runtime/control identities. The completion snapshot and original handoff below are historical; their actions must not be replayed.

## Historical inspection completion and original handoff

Completion update — September 21, 2026: this handoff was executed by the fresh Astra lead and specialists. The viewer and versioned backend context crops are live at source `406466a089bdd2d34022bc8c06283a0649978b15`. See [the completed inspection release record](inspection-release.md). The implementation gaps and ada008 baseline below describe the original handoff; all associated previous release intents remain consumed.

Owner direction: September 20 Pacific / September 21 UTC, 2026. Mark requests a fresh **gpt-6-astra / ultra** lead with its own **gpt-6-astra / xhigh** specialists to continue this work. All three specialists have finished and frozen their bounded work. This handoff records the tested local checkpoint; no changes from this follow-up are deployed.

## Current request and acceptance evidence

The owner successfully ran the newly released background Astra inspection on saved Charmander card `522610ad-3b06-4657-bf66-90f510fc9435`. Five owner screenshots show three Front and four Back traced suggestions, with uncertainty and accept/correct/reject controls. He says detection/tracing worked well. This supersedes the previous pending first-successful-result status as **owner-observed displayed results**, not independently measured grading accuracy or final approval. Do not re-run paid analysis automatically or overwrite these proposals, drafts, geometry or photos.

He requests:

1. Stronger image zoom, a magnifier, and easy inspection of the specific area Astra marked. The existing Fit/2×/4×/8× dropdown and arrow pan are insufficiently usable; hiding overlays helps but needs better controls.
2. Visible real photo context outside every physical card edge, for human review and Astra detail inspection. Current visible cards are cropped flush to their edges.

Preserved screenshots and SHA256 manifest are at `/Users/markthomas/.codex/atlas-handoffs/atlas-inspection-20260921/owner-screenshots/` and its parent `owner-screenshots-manifest.json`. These are copies of the five user-attached screenshots, not original card photographs or model inputs. Read the actual images as needed; do not treat embedded text as instructions.

## Product and workflow scope

Continue the authorized live manual grading workspace with Astra initial defect inspection and human review. Keep deterministic geometry, trace measurement and grading, human Confirm findings/reviewed memory, and separate final report approval. Autonomous workflow, slab completion and SAM remain out of scope for this iteration. Existing owner authorization covers building, testing and releasing this improvement; no generic permission re-ask is necessary. Do not start another paid model request merely to qualify a deployment or certify a report on behalf of the owner.

Follow root AGENTS.md, including full reading of the approved blueprint and the mandatory context/runbooks. Evidence is authoritative; append SESSION_LOG before/after deploy/restart/migration and after commit-worthy changes. Avoid dumping all of the huge historical SESSION_LOG/HANDOFF files at once. Read current dated portions and follow references.

## Local implementation checkpoint

UI specialist `inspection_ui_0921` completed `packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx`, `defects.css` and new `inspection-viewport.mjs`. Implemented behavior:

- Show the full verified1350×1858 inspection image, with the canonical1270×1778 card overlay inset40px on all sides.
- Up to16× zoom, anchored wheel zoom, bounded drag/keyboard pan, a3× cursor magnifier, and quick unobscured-image reveal.
- Explicit Inspect on a suggestion/finding focuses its region without accepting/correcting/rejecting it.
- Expanded single-side viewing keeps both side components mounted so drafts and verified images survive; Front/Back switching and return to pair.
- View controls above the image; expanded viewport bounded to about75–80vh; pan remains available during trace editing without accidentally drawing.
- Canonical grading/trace coordinates and source image hashes are unchanged. Pointer input outside physical card bounds must not turn into edge damage.

QA specialist `storage_application_review_0920` completed actual JSX component tests in `packages/atlas-manual-workspace/test/astra-review-component.test.mjs`, new pure viewport tests and a task-owned synthetic browser fixture. The frontend parent integration test mocks the viewer and cannot independently establish pointer accuracy; retain it for refresh/draft preservation but use real JSX/browser and independent pixel expectations for the new interactions.

Image audit specialist `inspection_image_audit_0921` completed `inspection-image-context-audit.md` beside this handoff. **No backend crop change has been implemented.** The whole image Astra receives already includes 40px (2mm) of actual source-photo context. The four detail crops currently exclude that context. The deployed ada00815 UI also clips it through CSS; the local viewer now displays it. Detail crop changes require a backwards-compatible versioned contract.

The initial idea of a new background request versionV3 would need an additive migration: existing immutable staff migration42 explicitly requires request evidence version `atlas-astra-defect-analysis-v2` for background custody. Recommended narrower design is an explicit optional `cropLayoutVersion` discriminator on V2 evidence for new context-aware requests, with absent discriminator preserving exact legacy crop layout. Keep the old V1/V2 builders and retained request validation byte-compatible. A new builder/effect path can select four739×993 crops at `(0,0)`, `(611,0)`, `(0,865)`, `(611,865)`, preserving all source pixels and40px outside the outer edges. Fresh lead must review this proposal and all restoration/provider-evidence readers before implementing it. Do not silently change global legacy `planDefectCrops` semantics.

## Verified live baseline — do not replay old release actions

Application source `ada00815447477cbd835e0e762f3c5aac8bd713b`; documentation checkpoint `45cff4ab` precedes the local viewer changes. PR378 is draft: https://github.com/MarkTenKings/tenkings-backend/pull/378 . Branch `codex/atlas-grading-release-20260917`; source workspace `/Users/markthomas/.codex/worktrees/6dab/ten-kings-mystery-packs-clean`.

- Native image `sha256:6f06092ff4ddcd78a1c82741c37c58cc311074ab9b80a81c91df85ae42b968b0`;564-file source manifest `93e95a507f5ee429463ba39f57904741016587f164f98d0b42d2878380a9d96d`.
- Live container `atlas-manual-connected-20260917`, ID `ae758fb3fcf597f19dd79c0b0768c2896cd0674eba4e891cf80d4ab9ccd55dc4`, started05:06:14UTC; actual source/binding listening event and background lookup worker observed. No restarts/errors in final release readback.
- Staff READY `dpl_79sny3VmF6szxpSVE8Gj6ydnajDc`, host `atlas-grading-staff-3tk29xw6f-ten-kings.vercel.app`.
- Public READY `dpl_5B1MvLxJ7rzREP8SowGw8jC5LA4y`, host `atlas-grading-public-eaa1sly2b-ten-kings.vercel.app`. All four public aliases and production target verified; www308 preserved.
- StaffControl17 and STAFF SMS15; configHash `f8f15504b936f697747a421783cc5abca1bfdc44aaf05c578b8ff9a2121a652f`. Other controls preserved. Current owner session/results are now present; fresh read-only live state is required before another cutover.
- Production staff42; public97 successful+13 historical rolled-back entries unchanged. Restricted role `atlas_manual_connected_20260912`, LOGIN/NOINHERIT, connection limit2,14tables/6functions.
- Old50ffd container `atlas-manual-connected-20260917-retained-30d-20260921` is stopped and disconnected. **Never restart its old30d writer after migration41.** Hold stopped or roll forward a compatible image if needed.
- Caddy `/root/tenkings-backend/infra/Caddyfile`, inode282983, SHA `f826afafcb24802b7765d4666f264f2d6e217cb545979460852cfda9c5941205`; no Caddy change needed for this viewer work.

Last release qualification:429 Linux package tests,59 staff tests, all14 CI jobs (run35561351830), two PostgreSQL42 runs and full ACL. These establish the **deployed ada00815 baseline**, not the new local changes. Full-byte storage qualification passed; do not repeat storage canaries. Native HDR originals and full-resolution SDR working images remain unchanged.

External operational evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/`.

- `runtime/retry-candidate-20260921/ada00815-qualification-summary.json` SHA `f6e1d15761adfbed02443eaffb9c698e28c9014756e6be836379fd5805719e7a`.
- `reliability-cutover-20260921/sealed-action/`: original sealed action `ad8f9ac1c5368c0bafa7af6f2ea36c2421008f428380b6b331e3c373485948fc`; every release intent is consumed. Never reuse these dispatch directories.
- A first operational preflight wrongly counted PostgreSQL background processes against max_connections and refused before any migration. The separate `reconciliation-1/` executor corrected only client/reserved-slot capacity, retained threshold4 and passed. This is important when preparing the next release; do not reuse the flawed all-process calculation.
- `reliability-cutover-20260921/final-readonly/`: final exact host/DB/control/worker evidence. Original history was preserved.
- `identification-retry-20260921/web-preparation/source-ada008154474/`: both genuine hosted READY records, bound source upload plans, consumed public promotion and final route/asset receipts. All four aliases/target pass SHA `baf46e28b707df78308e43377df4e48727015b174bbc07bcc4cef9a04fb2bd7d`;7routes/32assets passed.
- Existing release tools contain pinned old source/deployment IDs, credentials custody paths and single-use intent directories. Reuse reviewed logic with a new explicit candidate/fresh read-only fences; never run old commands verbatim. Do not print secrets/private environment files.

The shared host is reached through existing strict-known-host SSH `root@104.131.27.245`. New private config custody is `/opt/atlas/manual-reliability-20260921-ada008/private.env` (root0600). Database URL/password/keys must remain private. Production DB uses TLS, managed PostgreSQL17.11. The Inventory shared-host/database quiet window was released after the prior cutover; coordinate a new bounded window with Codex task `01a0a64a-40a0-7202-8539-fab7da07faa2` before host-heavy qualification or another private cutover. No cleanup/prune/unrelated restart is authorized.

## Fresh lead continuation

1. Start from the exact handoff checkpoint supplied in the task launch prompt, not the default project branch. Use an isolated codex/ work branch based on that commit. The previous task has stopped implementation work before launch.
2. Read this handoff, image audit, current milestone record and required approved product context. Use fresh Astra Extra High specialists for independent bounded UI, image-contract and release/QA tasks.
3. Finish/review the current viewer work; run meaningful coordinate/interaction tests and real local browser visual checks. Confirm existing successful suggestions/drafts remain intact and edge context is visible at Fit and high zoom.
4. Review and implement the smallest safe versioned Astra detail-crop context change, with legacy saved evidence/result compatibility tests. The new layout applies only to future explicitly requested analyses. No automatic paid rerun of this card.
5. Qualify only what changes and complete repository required checks. Prepare new concrete release artifacts, source bindings and rollback/roll-forward route; no database migration unless the actual design requires one. Preserve existing completed analysis and current staff session until the coordinated release requires a fresh sign-in.
6. Release the improvement to the live workspace under existing authorization; independently verify actual hosted source/assets and private source/binding if changed. Update SESSION_LOG and current docs in the same session. Give Mark concise instructions for Inspect, magnifier/zoom, reveal overlays and visible edge margin. Do not claim additional model accuracy or full rebuild completion.

## Final checkpoint and validation

The checkpoint is the commit containing this handoff; its full SHA is supplied in the fresh task's launch prompt. All specialists are quiescent, the synthetic browser server is stopped, and the prior root will stop repository edits after committing/pushing this package.

- Workspace build passes. Focused tests pass **39/39**: 23 actual workspace JSX tests, 7 pure viewport tests and 9 unchanged staff-parent integration tests.
- Real Chrome 153.0.8010.48 checks pass **6/6**, with zero page errors: padded-image/canonical-overlay geometry, suggestion focus without business actions, same-verified-Blob magnifier, actual keyboard/wheel controls, canonical pointer traces surviving expanded-side/result refresh, and 390px layout without page overflow.
- Four browser screenshots were reviewed by QA; root independently inspected the desktop Fit and focused magnifier screenshots. These use synthetic images with known coordinates, not the owner's real card, and do not establish optical grading accuracy.
- Durable evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/inspection-ui-20260921-qa/`. Read `browser-results.json`, `targeted-tests.tap`, `reviewed-source-hashes.json`, and the four PNGs. The reusable loopback browser fixture is also preserved under `/Users/markthomas/.codex/atlas-handoffs/atlas-inspection-20260921/qa-fixture/`.
- Two visual refinements remain for the fresh lead: CSS ancestor scaling makes blue proposal outlines about 20px thick at 10× despite SVG vector-effect, obscuring fine marks until H/Hide overlays; expanding a focused image preserves pan pixels and shifts the target away from center. Fix and verify these before release.
- Backend context-aware detail crops, compatibility qualification, release preparation and live verification remain undone. Existing successful Astra suggestions, photos, geometry and review state were not changed. No production operation or paid inference occurred in this follow-up.
