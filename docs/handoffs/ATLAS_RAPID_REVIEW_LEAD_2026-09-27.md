# ATLAS rapid review — independent lead handoff, 2026-09-27

## Your role and what Mark asked

You are the new independent lead, not a subagent. Mark explicitly requested a fresh **Astra / Extra High** chat he can work with directly because the previous chat is long. Continue the implementation and safe release described below. Do not start over, generate more voice variations, or ask Mark to repeat decisions. No messages back to the previous chat are required or authorized by this handoff.

Read this handoff and the mandatory AGENTS context/runbook files in the active checkout first. Evidence supersedes stale docs; update SESSION_LOG for commit-worthy code changes and before/after deployments/restarts. No destructive data/set operations, real-card approvals, paid grading/research calls, or physical printing for verification.

## Exact working location

Use this existing checkout explicitly for every repository command:
`/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean`

Branch: `codex/atlas-independent-lead-20260925`.
HEAD: `1f0dd9ccfb1a3f3fb53cb64c39e2a9efa83e4b5c`.
HEAD tree: `74ca76615c02cfc2d55a2c8fec17f72d297a6fbf`.
Commit: “Keep rapid review actions visible and add session-aware Atlas feedback.”

The saved project path/new chat's default cwd may be `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`. **Do not edit that primary checkout.** Work in the existing 1ce0 checkout above; do not create or reset a new worktree. The previous lead will stop writes after creating this handoff.

Node20: `/opt/homebrew/opt/node@20/bin`; prepend to PATH. Python3 is available.
Disk is tight: last observed ~522MiB free before approved audio extraction. Clear only this task's generated Next build caches if needed. Never delete worktrees, private evidence, or old rollback checkouts to make space.

Mandatory docs:
- docs/context/MASTER_PRODUCT_CONTEXT.md
- docs/runbooks/DEPLOY_RUNBOOK.md
- docs/runbooks/SET_OPS_RUNBOOK.md
- docs/HANDOFF_SET_OPS.md
- docs/handoffs/SESSION_LOG.md

## Completed UI implementation — qualified locally, NOT deployed

1. Rapid review is a native 100dvh dialog with header, flexible evidence area, and a footer outside scroll. Essential work no longer requires page scrolling; optional details may scroll.
2. Bottom-right positions remain stable: **← Back**, contextual neon-red **Adjust Geometry / Adjust Defects**, neon-green **Approve**. Explicit Approve accepts/advances each finding, then stages. Merely navigating does not approve. Final certification remains explicit.
3. Geometry and defect corrections remain inside the modal. Save/discard and the single “I inspected both Front and Back” confirmation are docked. Existing hash/revision/image-verification safeguards remain.
4. Final grade view is compact, with optional full details. Completion displays verified front photograph, ATLAS label, exact saved grade, animated neon-green check and “Completed,” with Next card prominent. Reduced-motion supported.
5. Same selected defect shown marked and clean with the same camera. Rapid measurement readout and enlarged locator have a reserved row so labels do not cover the trace. Rulers measure the actual marked span. Normal public-report adaptive positioning remains.
6. Earlier accepted defaults preserved: regular view one large Front/Back-switched card, geometry guides ON, rapid geometry paired Front/Back, card details easier to access. No grading-formula changes.

Main files:
- frontend/atlas-app/components/BatchGrading.jsx and module CSS
- frontend/atlas-app/components/ManualCards.jsx
- frontend/atlas-app/components/RapidReviewControls.jsx
- frontend/atlas-app/styles/manual.css
- frontend/atlas-app/lib/review-feedback.mjs
- packages/atlas-manual-workspace/src/{DefectReviewWorkspace,FinalReportReview,PairedGeometryWorkspace,ReportInspectionImage}.jsx
- packages/atlas-manual-workspace/src/report-review.css
- relevant staff test harnesses and review-feedback tests

RapidActionDock/RapidEditDock portal into #atlas-rapid-actions / #atlas-rapid-edits. Completion checks descriptor.sha256 against saved expected hash and uses verified images. It displays v2 finalGrade, or historical v1 displayGrade. Geometry fitting uses ResizeObserver. Source evidence and exact approval remain authoritative.

## ATLAS voice — final user decision; IMPORTANT

Mark wanted a subtle playful original godlike persona, then rejected a heavier/darker revision. The user explicitly clarified:
**“The 23-second ‘Friendly mischief’ audition was right; the later clip was dark.”**

Preserve the ACTUAL approved recording, not a fresh generation with the same preset. Separate generated takes drifted and caused this confusion. **Do not generate another ATLAS voice variation unless Mark asks.**

Approved exact master:
`/Users/markthomas/.codex/atlas-handoffs/atlas-inspect-20260927/approved-friendly-mischief.mp3`
SHA256: `b2edb3b3e20d8db655b7ccf0c13634d4d320224ad79bda6d0281f789fbc2e44a`.
Duration:22.96seconds (MP3 container22.99).
Runway task: `6f9005e6-a7dc-4cc4-ac7e-650ed2d9b0d2`.

Final character direction: warm, relaxed, assured, smiling best-friend banter; half-step playfulness and light easy chuckles. Never insecure or seeking approval for a joke; no “tough room.” Keep lines concise; remove trailing explanations. Serious and reassuring moods can remain serious/reassuring. Original preset Ragnar, expressive model, speed0.96; no actor samples/cloning. User's earlier Disney Zeus reference describes broad persona; no exact impersonation used.

The approved master has already been split into FOUR website clips using **MP3 stream copy at silence boundaries**, no pitch/speed/effects/re-encoding:
- playful.mp3, source0–5.20s: “An entire legend in the palm of your hand. Very efficient.”
- teasing.mp3, source6.65–10.95s: “Shall I bring that corner a chair for its interview, my friend?”
- playful-door.mp3, source12.65–17.05s: “They expect thunder, so naturally, I use the door.”
- teasing-crown.mp3, source18.18–22.96s: “With eyes like yours around, I'd better polish the back of my crown.”

Captions and nine-entry bank updated in review-feedback.mjs. README includes provenance and individual hashes. Five concise non-playful clips remain from the preceding revision: wise, reassuring, celebratory, serious, grand. Previous well-judged/one-detail files are retained but not selected. Rejected replacement tasks79e7cd08-cb60-4beb-94c4-30b6fe5472f5 and5a806512-315b-4a11-a2a7-bf6987bf5310 were NEVER downloaded into the bank; do not use them. Earlier playful/teasing mp3s have been overwritten with the approved excerpts.

Extraction helper: /tmp/atlas-preserve-approved-voice.py (already run; do not rerun because it appends metadata).
FFmpeg already available:
`/Users/markthomas/.codex/atlas-handoffs/atlas-rapid-capture-20260924/media-tools/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`

Voice cadence implemented:
- Separate in-memory session per signed-in reviewer/open rapid-review flow; survives card changes, resets on modal close/reviewer change.
- Every5–10 cards; any geometry/findings/final-grade/completion stage, completion fallback if a stage was skipped.
-100completed cards yield10–20 appearances, deduplicated per approval and stage.
- Mute doesn't block approvals or consume a cue.
- Celebration only at completion; no more than one voice appearance at a scheduled interval.
- Chime on exact successful approval, not mounts. Voice stops on modal close.
- Existing media CSP supports same-origin files.
- No customer/NFC voice functionality added; it was a future idea.

## Uncommitted changes to preserve

Since HEAD1f0dd9cc:
- Concise nine-entry voice captions in frontend/atlas-app/lib/review-feedback.mjs.
- Five concise non-playful mp3 replacements and four exact approved playful/teasing excerpts.
- Audio README provenance/direction.
- SESSION_LOG additions for concise voice, exact approved take and this handoff.
- This handoff file.

Two new files are playful-door.mp3 and teasing-crown.mp3. Check git status; do not reset these. Commit after checking asset/caption alignment and final staff build. This new commit MUST become the release source; prepared release scripts currently still hardcode1f0dd9cc and its tree.

## Validation already done

- All697 staff tests PASS. Latest full run after concise bank changes, before approved four-clip extraction:
  /tmp/atlas-fixed-staff-tests-final.log
- After exact approved extraction/nine-entry update: review-feedback.test.mjs5/5PASS (cadence/extreme schedules, session/reviewer isolation, mute).
- Public tests33/33PASS: /tmp/atlas-fixed-public-tests.log
- Shared workspace141PASS,1pre-existing optional native skip: /tmp/atlas-rapid-shared-tests.log
- Staff production build and boundary check PASS: /tmp/atlas-fixed-staff-next.log (before latest voice-bank edit)
- Public production build and boundary check PASS: /tmp/atlas-fixed-public-next.log
- Initial31staff failures were missing imports in an existing VM test harness after adding docks, now fixed; all697pass.
- Synthetic browser at1024×640 and1280×800 confirmed paired findings, full completion image/grade, stable action coordinates, docked save/discard, and zero console errors. No real card writes/approvals.
- Need final staff build after latest bank update; do not claim it is already rebuilt.

Browser preview:
- Server previous exec session37383, port4180; check liveness before starting another.
- /tmp/atlas-fixed-preview.mjs builds synthetic fixture; do NOT run older /tmp/atlas-fixed-preview-generate.py, which overwrites latest fixture.
- Preview files:
  /Users/markthomas/.codex/atlas-handoffs/atlas-inspect-20260927/fixed-review-preview/
- Proof images: completion-desktop.png and findings-desktop.png.
- Last synthetic browser was on geometry with a1pixel Front nudge (fixture only).
- Previous browser tab2132126381 in Chrome, http://127.0.0.1:4180; fresh CUA session must initialize/document.
- Live staff browser is signed out. Do not claim authenticated live acceptance or approve real cards.

## Remaining work, in order

1. Verify exact approved audio excerpts/captions/provenance. No voice regeneration.
2. Final staff build + appropriate targeted checks (full suite is fast but don't repeat needlessly). Confirm essential controls still accessible; existing browser proofs remain useful.
3. Commit current source changes and prepare exact new release SHA/tree.
4. Update the prepared release scripts for that new SHA/tree and fresh provider evidence. Inspect scripts; several copied static fields are stale. Materialize immutable source, guarded dry payload and preflight.
5. Stage staff and public deployments. Then fresh quiescence check, existing guarded private-runtime web-binding restart/control-row update, read-only qualification and canonical promotion as detailed below.
6. Verify live assets/audio bytes, staff sign-in, public report, exact preserved homepage, and record observed results in five context/runbook/handoff docs +SESSION_LOG. No live real-card approval.
7. Give Mark concise completion with live status and any actual limitation.

No production changes have been made for this pending release. It remains safe to finish preparation before changing anything live.

## Release preparation (exists, NOT executed beyond read-only snapshot)

Directory:
`/Users/markthomas/.codex/atlas-handoffs/atlas-inspect-20260927/fixed-review-release`

Fresh read-only provider-before.json was saved successfully. First attempt403was expired Vercel auth; ordinary CLI whoami refreshed it successfully (mark-1842). No manual login needed at that time.

Scripts copied/adapted from prior release; **inspect/fix remaining placeholders, never blind-run**:
- web-prepared/prepare-source.mjs, web-plan.mjs, source-cli.template.mjs, cli-policy.json, cli-network-guard.cjs
- rematerialize.mjs,run-cli.mjs,stage-staff.mjs,stage-public.mjs,prepare-cutover.mjs
- public-binding.mjs,database.py,readonly.sql,remote.py,runtime.remote.py
- cutover.py,verify-runtime.py,private-probe.mjs,promote-public.mjs,canonical.mjs,document-release.py

Known stale items:
- All prepared source literals currently1f0dd9cc... /tree74ca...; update to new committed source including approved clips.
- prepare-source.mjs provider-before SHA is STILL OLD960f809... and must be recalculated from actual fresh provider-before.json.
- NEW_STAFF_DEPLOYMENT / NEW_PUBLIC_DEPLOYMENT / NEW_STAFF_HOSTNAME / NEW_PUBLIC_HOSTNAME placeholders: fill only after actual READY candidates.
- web-plan.mjs OLD constant still ancient sample IDs; ensure assertReady uses correct live IDs as appropriate.
- canonical.mjs still asserts old “REVIEW COMPLETE” strings. Update to actual Completed/fixed dock/contextual Adjust strings plus exact deployed audio hashes; keep homepage/public report checks.
- document-release.py still prior completion-release prose/counts/paths; rewrite from actual observations before using.
- cutover.py static job count23may be stale; derive count from fresh census before writing final narrative.
- /tmp/atlas-prepare-fixed-release.py was a one-shot directory creator; DO NOT rerun it.
- No materialization/upload intents or receipts consumed yet in fixed-review-release.
- Previous review-completion-release contains CONSUMED one-shot intents; never rerun it.

Expected flow:
- materialize exact new committed source via rematerialize.mjs: own git object custody, no alternates, tracked regular manifest
- guarded run-cli.mjs staff dry/public dry and preflight; inspect outputs
- stage-staff.mjs logs planned action then --prod --skip-domain upload
- provider confirms READY exactsource; set staff placeholder
- stage-public.mjs logs planned single public ATLAS_STAFF_DEPLOYMENT_ORIGIN env patch + same immutable source upload
- both READY: fill public placeholder, calculate exact public binding
- fresh DB census/quiescence +cold network-none runtime constructors
- prepare-cutover.mjs fresh provider snapshot; cutover.py only if fresh checks pass
- retain prior container, same immutable image/security/resources/network; change only two web-binding envfields and three guarded control rows; preserve all grading history/job rows
-125second existing boot fence (wait in≤60s intervals with updates)
- verify-runtime.py +private-probe.mjs read-only401/404/200
- promote-public.mjs single providerPOST after fresh proofs; aliasesverified
- canonical.mjs live assets/audio/report/homepage verification
- documentation update and commit

Provider helper:
`/Users/markthomas/.codex/atlas-handoffs/atlas-scalable-pipeline-20260925/web-release/provider.mjs`
Exports client,snapshot,save,ready; avoid printing auth.
Team/project IDs are in web-plan.mjs; don't invent them.
Vercel CLI protected auth auto-refresh worked via ordinary whoami. Never print token contents.
Public/staff candidates are --prod --skip-domain; generated aliases can advance but canonical routing remains pinned until explicit promotion.

## Current production facts (last observed unchanged)

Frontend source21041faef71750b35b6e8015dc29a5952dddcd6a.
Staff:dpl_gzXTKufeMd4mAh6TptUHS57Howby
atlas-grading-staff-hogh8f0kn-ten-kings.vercel.app
Public:dpl_A9eKWoTrGSt7ufeyknJeABmX2ujm
atlas-grading-public-2g3zt8kmp-ten-kings.vercel.app
Customer unchanged:dpl_2bUeFNMvvdkEDXjpJcWYRSpiHMmG
atlas-grading-customer-jyniceagx-ten-kings.vercel.app
customer source:d4a7dec2af187f4aa03166e639f4d9bb066fb612.

Homepage exact dcc58d885cfd172dadb395b2ae2e59ce1c60725e subtree.
Canonical HTML SHA256:
06149b1e819e5c42091e8f5709f83986482a25772f80ff3d569b92866b75abe3.

Private runtime image unchanged:
sha256:d21cacaadfdc780a1da2be85aa6629bfc249d12871e6017d839832a885b44871
Container339f1c6a7488733257d0f03f52f7d79fbd56cd55994076441047933d3583c179
Name atlas-inspect-complete-21041faef717
Started2026-09-27T06:30:59.59949058Z,restart0.
Config /opt/atlas/inspect-complete-20260927/candidate.docker.env
Config SHA38ef070221093c5a7d8b997ca51aeca6ceb98c0f978a51a1e13f2efb19fcbcd7.
Controls Staff39 / STAFF SMS37 /PublicReader18;customer15/13.
DB47ordinary slots,staff role limit16.
Host161.35.178.144,droplet603665696,private10.108.0.4.
Networkatlas-runtime-693f7229,IP172.29.69.2,aliasatlas-runtime-primary.
14CPU28GiB.
Existing125s boot fence:
 /opt/atlas/scalable-pipeline-20260925/final-review-release-20260926/runtime/boot-fence.runtime.mjs
SHA76e61c7020c633ee9a2d67f0f53335e9c73cfe533035e709aad3256e83ced902.

Known public report, read-only:
https://atlasgrading.com/reports/ar_x01RP8d3VZS0Gk9rREW0DwkR?v=1
Abomasnow grade10/version1/13findings.
Do not approve, regrade, print, research or mutate it during verification.

Previous consumed release evidence:
 /Users/markthomas/.codex/atlas-handoffs/atlas-inspect-20260926/review-completion-release
Keep rollback artifacts. The new prepared release runtime target is /opt/atlas/inspect-fixed-20260927 with a new source-named container.

## Communication and scope

Mark wants action and minimal unnecessary permission questions. Give concise updates during sustained work. The voice decision is settled: exact approved23secondrecording. No more auditions. Preserve serious/reassuring moods and the original character. Future rare customer NFC speeches are an idea, not this release's scope.

Final handoff should distinguish local qualification from production verification. The UI work is implemented and locally qualified, but not yet deployed. Finish the release with actual evidence rather than assuming staging means live.

