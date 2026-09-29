# ATLAS staff review — local preview qualification

Date: 2026-09-29. Engineering chat: 01a0e63d-8bfd-7dd2-948f-383e9d867dbd. Design lead: 01a0eba4-cb58-7bf0-9065-92ec50274d2a.

Owner design acceptance: Mark approved the staff workflow and specifically praised the geometry magnifier. His subsequent local edited-save test exposed a missing synthetic preparation adapter; it is now corrected and verified through actual native preparation and browser save/reload/progression. This does not change the approved visual design.

Production release status: the complete report/reviewer design and gold fingerprint were deployed on September 29, 2026 from `29e9192080d7d7a95644316a417dc6171eef3bbb`. All 1,614 exact-source tests passed with zero skips; staff/public production builds and boundaries passed. Canonical routes, signed private reads and database/runtime preservation checks passed. Final live browser checks verified all 13 individual Abomasnow Back findings, exact gold, reversible fingerprint, unchanged photograph, paired evidence views, centering and 390px phone layout with no console errors. See `docs/atlas/audits/2026-09-29/review-design-release.md` for serving identities and evidence. Live customer report: https://atlasgrading.com/reports/ar_x01RP8d3VZS0Gk9rREW0DwkR?v=1; staff: https://atlasgrading.com/admin. Deployment qualification does not claim a new real-card approval or physical-device operator acceptance.

The sections below retain the historical local-preview qualification and its limits.

## Review the experience

Local staff preview: http://127.0.0.1:4191
Local customer report: http://127.0.0.1:4186/?card=abomasnow

The staff fixture uses actual shared React ManualWorkspace and CSS, synthetic card pixels, in-memory transport and real geometry/defect reducers. This is a local design and interaction preview, not a production card. Front and Back each open a large editable photograph with simultaneous physical/printed outlines. One green Approve advances to the next step. Findings expose a named exact trace, calibrated saved measurements, Add/Edit/Reject, clean comparison and bounded navigation. The final grade remains an explicit separate approval.

Visible Front/Back/Findings/Grade navigation supports Alt+1–4. Browsing does not approve. Unsaved edits and pending saves block navigation; a delayed grade preview cannot discard a newer draft. Exact geometry receipts support review in either order. Completion components expose the existing label, NFC and market-reference paths with truthful readiness states; they do not trigger paid lookups or hardware writes automatically.

## Qualification

- 163 targeted staff tests passed, zero failed/skipped: actual defect and geometry components; rapid-review state; parent integration; recovery; completion; finishing; market-reference behavior.
- Small shared workspace build and git diff --check passed after final source edits. Full Next production builds were not run in this design pass because local disk space is constrained.
- CUA browser checks: 390×844 phone, 1440×900 desktop, 844×390 short landscape. No horizontal overflow. Phone finding image340×334; desktop paired panes530×535; landscape image538×119 with independent measurement-panel scrolling and visible Approve.
- Marked/clean panes use identical verified blob URL, image dimensions and transform. Draft mode disables navigation and labels existing values Saved. Previous/Next stop at the first/last finding.
- Synthetic Front→Back→finding1→finding2→final Grade succeeded. No final report approval was submitted. Browser warning/error log was empty.
- Short-landscape and phone photo collapses were found through browser inspection and corrected. Border labels avoid clipping and wrapping.

Screenshots and prior evidence remain under /Users/markthomas/.codex/atlas-handoffs/atlas-review-interaction-20260928/rapid-workflow:

- staff-final-mobile-findings.png
- staff-final-desktop-findings.png
- staff-final-landscape-findings.png
- staff-final-grade.png

Final targeted test command (Node20):

```sh
/opt/homebrew/opt/node@20/bin/node --test \
  packages/atlas-manual-workspace/test/astra-review-component.test.mjs \
  packages/atlas-manual-workspace/test/rapid-review.test.mjs \
  packages/atlas-manual-workspace/test/focused-geometry-component.test.mjs \
  packages/atlas-manual-workspace/test/geometry-focus.test.mjs \
  frontend/atlas-app/test/manual-defect-workspace-integration.test.mjs \
  frontend/atlas-app/test/manual-cards-recovery.test.mjs \
  frontend/atlas-app/test/batch-finishing.test.mjs \
  frontend/atlas-app/test/completion-next-steps.test.mjs \
  frontend/atlas-app/test/market-reference-picker.test.mjs
```

## Boundaries and release work

At this earlier local-preview checkpoint, all changes remained local and uncommitted in the existing 1ce0 checkout. There was no deployment, production write, real approval, paid model/market lookup, NFC write, label print or learning activation. The fixture now implements actual local CPU geometry preparation, finding reprojection and remeasurement after physical geometry edits. Five adapter tests passed, and CUA verified edited Front and Back outlines, exact retained values after browser reload, both finding approvals and final draft Grade9.5. The demo does not implement adding/editing individual finding traces or production certification; the final Approve remains disabled. It stores demo state in memory until the server restarts. This is not authenticated production end-to-end evidence. Real iPhone ingestion and physical device acceptance remain separate from this design preview.

Owner design acceptance is recorded above, and Mark subsequently authorized completing qualification and production deployment. Authenticated release qualification against the production source/bindings and successful production build/deploy evidence are now recorded in the September 29 release audit.

## Edited geometry demo repair — owner acceptance follow-up

Only loopback fixture code changed. The accepted magnifier, styling and application save semantics are intact. Actual prepared image hashes, dimensions and transforms are adopted atomically with reprojected/remeasured findings. A failed preparation retains the physical edit and old evidence; retry resumes without duplicate physical saves. Stale writes and final certification are rejected. Errors now report Save failed rather than Saved.

Five actual-native regression cases passed under task-isolated Python3.12, OpenCV4.10.0.84 and bundled NumPy2.3.5; this does not claim equivalence with the production native build. Test invocation:

```sh
ATLAS_FIXTURE_PYTHON=/Users/markthomas/.codex/atlas-handoffs/atlas-review-interaction-20260928/preview-cpu/bin/python \
/opt/homebrew/opt/node@20/bin/node --test packages/atlas-manual-workspace/test/rapid-preview-adapter.test.mjs
```

Start the retained demo with the same ATLAS_FIXTURE_PYTHON plus ATLAS_PREVIEW_ONLY=1, ATLAS_PREVIEW_PORT=4191 and ATLAS_BROWSER_EVIDENCE pointing to the existing rapid-workflow evidence directory, running packages/atlas-manual-workspace/scripts/rapid-workflow-browser.mjs.

Edited browser proof: staff-edited-save-proof.json, staff-edited-back-retained.png and staff-edited-geometry-final-grade.png in the same evidence directory. Front44/56 and60/40, Back39/61 and58/42 remained exact after reload. Both findings advanced to a calculated draft9.5; final certification was disabled and never attempted. No browser warnings/errors.

An already-open tab from the old fixture needs a refresh, and any failed unsaved adjustment from that old instance must be repeated. Saved changes survive page reload in the new demo while its server stays running.
