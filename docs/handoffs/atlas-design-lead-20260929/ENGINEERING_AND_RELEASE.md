# Engineering and production continuity

## Checkout and scope

Active checkout: `/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean`.
Branch: `codex/atlas-independent-lead-20260925`.
Clean HEAD at handoff start: `445b14c6` (documentation only).
Deployed app: `0989b13bd6234118587f3909bfbcf1508a143fb2`, tree `6cd52dce87b93731544df9bae0f785f1378d3b6e`.
Project primary `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean` has unrelated work: do not overwrite or use it accidentally. Do not push this branch casually; legacy linked deployment behavior is not the guarded ATLAS release process.

Node 20: `/opt/homebrew/opt/node@20/bin/node`; prepend that directory to PATH. Qualified local Python: `/Users/markthomas/.codex/atlas-handoffs/atlas-review-interaction-20260928/preview-cpu/bin/python`, used by ATLAS_FIXTURE_PYTHON and ATLAS_MEASUREMENT_PYTHON. Existing disk space is limited; avoid duplicate full builds or broad cache deletion unless needed.

## Source map

Under `packages/atlas-manual-workspace/src/`:
- `PublicEvidenceExplorer.jsx`: paired desktop/mobile navigation, category scopes, finite arrival/tour, grade-category callback.
- `ReportInspectionImage.jsx`: verified image binding, overview traces, camera and matched detail.
- `ReportSpatialOverlay.jsx`: individual outboard labels, spacing, leaders, direct selection; on-card number labels on hover/focus prevent adjacent5/6 tag collisions.
- `ReportPrecisionOverlay.jsx`: calibrated centering ruler readouts.
- `ReportFingerprint.jsx`, `report-fingerprint.mjs`, `report-fingerprint.css`: photo-backed evidence-derived contour display; deterministic method remains authoritative.
- `GradeCalculationStory.jsx`, `grade-calculation-story.mjs`, `grade-calculation-story.css`: real saved calculation and interruptible replayable timeline. Sequence counter fixes replay during an already-playing RAF sequence.
- `FinalReportReview.jsx`: report integration; gradeCalculation render callback connects category links to evidence navigator.
- `report-spatial-navigation.mjs`, `report-review-ui.mjs`, `inspection-viewport.mjs`: saved scopes/display helpers. Optional display gutter preserves prior default behavior.
- `public-evidence.css`, `report-spatial.css`, `report-review.css`: layout/motion/responsiveness.
- `FocusedGeometryWorkspace.jsx`, `focused-geometry.css`: large geometry stage, task/loupe inspector, guarded missing-outline placement.
- `DefectReviewWorkspace.jsx`, `defects.css`: findings stage, optional Compare and inspector.

Staff integration: `frontend/atlas-app/components/ManualCards.jsx` and `BatchGrading.module.css` (resolve the latter with rg if needed). Preserve actual reducer/server approval authorities. Key regression suites include `grade-calculation-story.test.mjs`, `final-report-component.test.mjs`, `focused-geometry-component.test.mjs`, `astra-review-component.test.mjs`, `inspection-viewport.test.mjs`, and manual-defect workspace integration. Use rg to locate exact test paths rather than inventing commands.

## Qualification already completed

Final source-bound Node20 suite: **1,630/1,630, zero skips/failures/cancellations**: staff764, workspace249, manual-server522, public/customer/router95. Both production builds and project boundary checks passed. Earlier243+6-environment-skip checkpoint is superseded.

Staff actual React/reducers and CPU preparation with synthetic photos/isolated transport verified Front→Back→Findings→Grade, failed-save retention/retry and seven viewport cases. Geometry stage692px at1440×900 and458px at390×844. No JS errors. Durable proof copy `artifacts/rapid-workflow-proof.json`; original screenshots `/tmp/atlas-staff-card-first-20260929`. This is not authenticated production approval.

Canonical live Abomasnow browser proof at2026-09-29T21:13:03Z: paired sides; all13Back findings; on-card click opens synchronized marked/clean detail; Next; Corners2/Edges11 saved memberships; Back3.80/3.20/3.65/3.35mm centering; photo-backed gold fingerprint; actual9.85→10 replay/pause/resume; visible keyboard focus;390px width without overflow; no console warnings/errors. Reduced-motion component regression passed; OS preference was not changed. See copied live proof and screenshots.

## Production identities — recorded verified baseline, recheck before future changes

- Staff `dpl_D4uFpiy13uFgqgD1NfSKhMsVqQEy`, `atlas-grading-staff-61jn7u9u6-ten-kings.vercel.app`.
- Public `dpl_6khPhWb4HDhsvuBeKzZbR5NjVbG9`, `atlas-grading-public-kl69zb0zf-ten-kings.vercel.app`.
- All four aliases select public: atlasgrading.com, www.atlasgrading.com, atlas-grading-public.vercel.app, atlas-grading-public-ten-kings.vercel.app. Canonical promotion2026-09-29T21:10:32.587Z.
- Private source unchanged `47559353af0803186c724ea37f032ce306397157`; immutable image unchanged `sha256:224e41e9efce5c9b5a80558bcc1c83f906ca4d91120311e3757564de25b91c90`.
- Runtime `5ea7c654b9c0462a59313ebe1dba0287c60935a63e4164e49e172460e6b354d3`, started21:07:51.679382129Z, zero restarts. Previous6870ef0601360fc521e4e45542f7d66309064bc45fdd82d0fefb5a287274f788 retained stopped/disconnected.
- Only runtime env fields ATLAS_MANUAL_WEB_DEPLOYMENT and ATLAS_MANUAL_WEB_RELEASE_SHA changed. Protected config `/opt/atlas/paired-design-release-20260929/candidate.docker.env`, SHA256cfa27d2c246530b92a0be45fafeec6672e07adea5e162ada98557f427cd189ff. Never print credentials/config contents.
- Controls Staff50 / STAFF SMS48 / Public30. Customer15/13 unchanged; customer deployment `dpl_2bUeFNMvvdkEDXjpJcWYRSpiHMmG`, source d4a unchanged.
- Exact three-row CAS used unchanged125-second boot fence;115812ms conservative allowance remained. Signed TLS reads401staff/no-session,404unknownreport,200customer passed.
-1049private source files,16native artifacts,32history fingerprints,68jobs,61/112migration ledgers preserved. Frozen229485b homepage unchanged. No scoring/schema/core/modelrequest/learningactivation/realapproval change.

Full authoritative audit: `docs/atlas/audits/2026-09-29/paired-report-and-review-release.md`. Older `review-design-release.md` is the prior29e919/6870 release, not current.

Private receipts: `/Users/markthomas/.codex/atlas-handoffs/atlas-paired-design-release-20260929/release`. Read `final-result.json`, `canonical.result.json`, `live-browser-proof.json`, independent review receipts, qualification/source-0989b13bd623/result.json and web-0989b13bd623/result.json as needed. `RELEASE_SEQUENCE.md` and rollback-plan.md describe completed work; **all mutation intents are consumed, never replay them**. Any future release/recovery requires a fresh state-bound reviewed transition with forward control revisions. No need to deploy a documentation handoff.

## Remaining work and boundaries

Mark can now test the live design. Wait for feedback rather than invent a redesign. Authenticated staff end-to-end real-card approval is owner acceptance, not yet claimed. Existing unmeasurable-observation correction lacks a backend resolution decision; false rejection is not a workaround. A future requested correction must define a real server decision contract with appropriate evidence and regression validation.

The latest localhost4186 screenshot URL is historical; that listener was unavailable. Task-owned4176QA helper was stopped successfully.59500 was an earlier fingerprint study. Production URLs are the testing deliverables. To revisit approved mockups use copied HTML files; to rebuild actual component previews use `/Users/markthomas/.codex/atlas-handoffs/atlas-design-preview-20260928/{build.mjs,serve.mjs}` and provenance as necessary, logging starts/stops. Do not restart merely for this handoff.

Read-only production/source evidence may evolve with ordinary owner use. Treat these numbers as the verified handoff baseline, not a promise of future immutability; fresh runtime/DB evidence wins and must be documented before a future release.
