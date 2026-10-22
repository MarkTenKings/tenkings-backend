# Workspace entry and missing review findings

## Owner report and confirmed cause

The owner tested the live original-photo Workspace gallery and reported that Nick Bosa opened geometry successfully but showed zero Front findings, blue dashed traces and three additional suggestions. The normal Review Queue path worked for TreVeyon Henderson Thrillers, which the owner completed. The owner otherwise reported that the new surfaces look good. Public Marketplace navigation is still pending with public listings and commerce; its absence is expected.

The deployed gallery links to the existing `/admin/manual/<cardId>` route. That route mounts ManualWorkspace without the batch context supplied by Review Queue. `recoverManualReview` therefore skips `BEGIN_FINAL_REVIEW`, leaving the saved machine findings outside the editable roster. The dashed blue traces are proposals; they do not establish a flawless card or an approved defect. The gallery preview is display-only and is not substituted for grading evidence.

## Read-only production evidence

A bounded read-only repeatable-read transaction at `2026-10-22T02:09:08.080Z` inspected only Nick and Henderson's card, batch, action and approval rows, then rolled back. Private snapshot SHA256 `858857112045e00f244c8fb80a9d81f1252c0be12943de9cfb5bf3ec18852132` is under `~/.codex/atlas-handoffs/atlas-workspace-review-entry-20261021/read-01/`.

- Nick `e9b03f81-aa29-4530-b444-7d07797bec08`: current revision2, no finalReview, sole saved action CONFIRM_GEOMETRY from revision1. Current hash `02cc3fb6095894725fc5ea23a30afc5c769261e1de5e23cc0430dad080d9ece2` differs from batch base revision1/hash `4e1757ba851416dba9e2538db765959e7086f3dc17e441116a8f0996d47b6730`. No approval exists.
- Exact Nick BATCH_REPORT `56e6c84a08a402264bbf3d2d2db82b4bf2f9ed547c611e97bf3f1f22deb312fc` contains three measured Front findings and three corresponding proposals, zero unmeasurable proposals. They describe upper-left whitening, a top-right pale mark and bottom-right exposed stock. These are machine observations awaiting human decisions, not certified defects.
- Three bounded immutable-object GETs at `2026-10-22T02:15:43.311Z` verified expected keys, metadata, byte counts and SHA256 for that report and current defects/geometry. Current defects contain zero findings on both sides; both current measurement frames exactly equal the report frames. Both human geometry confirmations are retained.
- Henderson `2fb615a4-f683-42de-b99c-d2dbe1709306`: first saved action BEGIN_FINAL_REVIEW, then geometry/inspection/findings/identity and APPROVE_REPORT. Current revision8; approval at `2026-10-22T01:58:08.203Z` binds report `4e897b339f73364afc44d52dcc2c7e9103610baad70461fb41d2573104494d07`. This corroborates the owner's successful normal-queue test.

No card, approval, artifact, configuration or production process was changed. No provider inference was dispatched. Private records remain outside the repository.

## Correction and qualification

Implemented locally: expose exact authenticated current-card/current-source batch context in the existing workspace view, then use the same bounded final-review startup before geometry edits. Preserve current approvals, human edits, pending/unknown commands and all stale source/revision/report checks. A failed startup must not expose an intermediate geometry editor.

Separately correct the suggestion wording: rapid findings confirmation applies to the saved roster and does not automatically import blue suggestions. Explicit Add/Correct/Dismiss remains the human decision path. Do not auto-accept observations or weaken stale report checks.

A subsequent read-only transaction at `2026-10-22T02:18:08.075Z` found exactly one Nick analysis run, no refusals, and its RESPONSE receipt READY; card revision2/hash stayed unchanged. Private snapshot SHA256 `4b7045dff712f9c25bea7bc6da89590f9f04fa8d6b6595c2f2d3c79297417cf0`. Independent offline comparison of the actual parsers and geometry helper verified report/current source, identity/profile, both full prepared frames, centering and the three valid proposal-to-measurement associations. The nested proposal-result hash and full artifact byte hash describe different payloads. The normal suggestion action still validates the result artifact and current authority at use time.

Nick's already-saved geometry makes the old batch base stale. The preventive fix must not overwrite it. Existing exact-frame proposal review retains the current human geometry and requires explicit Add/Correct/Dismiss decisions. Independent source review passed. Fresh isolated release remains pending. The live source remains c1815115.

Root local qualification so far:209 focused startup/ManualCards/defect/rapid-review checks pass; broader staff/batch/connected suite passes1,916 with2pre-existing native environment skips (1,918total). Node22 staff production build/boundary passes35browser chunks/15server traces/2,030files. Actual PG and browser checks remain pending; no correction is live. Logs are under the incident evidence root.

Actual-component browser qualification passed the nine combinations of1440/390/320px and zero saved+three suggestions/one saved+three suggestions/empty, with correct separate counts and no horizontal overflow. Help remains visible outside the collapsed suggestion list. At320px, ordinary keyboard focus scrolls the first Add suggestion control above the fixed footer; Back clears Front suggestions. Settled zero/saved screenshots verified both synthetic1350px images. This mounts actual DefectReviewWorkspace/CSS with synthetic host/data/actions, not the complete production route. Receipt90a6389f949ae6975c6ac6e47cb846103f0b38377d7240f439e801361313b58a. All45source and8asset pins verified; exact preview server stopped, port58671closed, temporary browser viewports reset and preview tabs closed.

Owned PostgreSQL17 qualification passed seven groups with15-table preservation each,251 unrelated queue jobs, actual synthetic authenticated handles and source/editor/session fences. Receipt`ff1383686663beea6c20d15906d24b5662c43f29d735726c195dad206a498e93`; exact cluster stoppedVerified. This covers sequential revocation and stale views, not a concurrent ACL lock-wait test. Final affected source tests160pass/1existing native-measurement skip; independent broader focused162total161pass/1skip. Native Linux qualification remains pending. No production action has occurred.
