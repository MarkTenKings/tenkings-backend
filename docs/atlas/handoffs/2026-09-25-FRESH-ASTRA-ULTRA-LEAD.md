# ATLAS — fresh Astra Ultra lead handoff

## Owner request and immediate task

Mark requested a **new independent lead task**, model **gpt-6-astra**, reasoning **ultra**, with its own fresh subagents. This is a transfer of working context, not delegation beneath the previous lead. Mark is testing the live release on his original iPhone and will send results to the new lead. Allow time for that test; do not treat silence as a failure or repeatedly request updates.

Work on **ATLAS GRADING**. Ten Kings is the shared repository/hosting team and was a read-only capture-pipeline comparison. Do not change Ten Kings Inventory. Repository AGENTS.md requires reading the Ten Kings blueprint; that does not change this task's ATLAS scope.

Use at least three **fresh gpt-6-astra / xhigh** subagents for concrete independent work while substantive implementation or investigation is active, as Mark requested. Suggested ownership: (1) iPhone upload and exact-original recovery, (2) current grading jobs and dispatch/review states, (3) submission motion, maps and customer acceptance. The lead integrates and owns release decisions. Avoid duplicate deployments, repeated full test runs, speculative mutations, or busywork while waiting for owner feedback.

## Checkout and packaged state

- Previous checkout: `/Users/markthomas/.codex/worktrees/1e86/ten-kings-mystery-packs-clean`.
- Previous branch: `codex/atlas-fresh-lead-20260924`.
- Deployed application commit: `e4a75df58d0f8c54423b845f1e5e4ffc4d8995bb`.
- Release documentation/evidence commit: `5f07eddb440f9de10e9f2a0b518a7754a138cad6`.
- This handoff is committed after that documentation commit. The launch message supplies its exact commit. Begin your own clean worktree/branch at that exact handoff commit; a new task's default checkout can be older than this live release. Do not accidentally work from the saved project's stale default branch or overwrite another worktree's edits.
- Private evidence and release scripts: `/Users/markthomas/.codex/atlas-handoffs/atlas-submission-refinement-20260925`.
- Original user diagnostics: `/Users/markthomas/Downloads/atlas-upload-diagnostics.json`.
- Latest design annotation: `/Users/markthomas/Downloads/Atlas Submission page Design.png`.
- Relevant iPhone screenshots: `/Users/markthomas/Downloads/IMG_0636.PNG` through `IMG_0642.PNG`; earlier capture errors in `IMG_0624.PNG` through `IMG_0626.PNG`.

Read required AGENTS.md context first, then this document and these current authorities:

1. `docs/atlas/audits/2026-09-25/submission-capture-release.md` — applied release, evidence and acceptance limits.
2. `validation/atlas-submission-refinement-20260925/sanitized-release-summary.json` — 23 verified receipt hashes and live identities.
3. `docs/atlas/audits/2026-09-25/iphone-inventory-pipeline-comparison.md`.
4. `docs/atlas/audits/2026-09-25/queue-incident-audit.md`.
5. `docs/atlas/WEBSITE_DEPLOYMENT.md`, `docs/atlas/WEBSITE_RELEASE.md`, `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md`, and the latest `docs/handoffs/SESSION_LOG.md` entries. Older checkpoints are explicitly historical.

## Plain-language explanation already given to Mark

Ten Kings shrinks photos to a maximum 1,400-pixel edge. ATLAS retains full-resolution originals, so it has more work and larger transfers. That was not the only cause: normal Apple photo metadata was incorrectly refused; struggling uploads delayed healthy pairs; one grading handoff hashed its request differently from the executor; and the UI continued saying queued when processing had stopped for edge/identity review or an error. Those software defects are now fixed and live. Full-resolution originals were not reduced to make uploads faster.

**There are currently two grading workers, not 50.** Fifty is the limit for one server batch request. Mark had expected 50 simultaneous agents. Do not claim that capacity exists, quietly raise it on the present 1-CPU/3-GB host, or treat an uploaded card as a completed grade.

## Live release — do not redeploy merely for handoff

- Site: `https://atlasgrading.com`; customer flow `/account/submit`; staff queue `/admin/batch?tab=INTAKE`.
- All three web projects and the private runtime run application source `e4a75df5`.
- Staff deployment `dpl_GP7dsyGzdX3anJq3jYBPJfyx4aYi`, customer `dpl_HtGqts71JmBA8LKUquAidKuwbZXt`, public `dpl_BK6FzdB6YvRtziR27m6tKT2MhVWW`.
- Private image `sha256:65f6d935c5147788ccc64e6faa1f406cbfb127c255b7beaa8ac6b159a1de036f`.
- Serving container `9a21d430649a60d7bb16205f07085d9c157df222d0f481791571500bd50435da`, named `atlas-manual-connected-20260917`.
- Predecessor `780b01eb99076d3ede3084a07ced5b3071f5cc07880a25aaf0707cfeeab2acdd` is retained stopped/disconnected, named `atlas-manual-connected-20260917-retained-fa966-submission-e4a75df5`.
- Cutover was at 2026-09-25 03:14 UTC; public promotion at 03:16:47 UTC. Strict preservation passed at 03:17:18 UTC; 34 canonical checks at 03:17:29 UTC.
- Actual release changed three runtime binding fields and six existing control rows with exact preservation checks. Credentials, schema, data/history, Caddy and unrelated containers were preserved. Do not replay already-consumed release intents/scripts.
- Customer intake and identification are enabled. Commerce, dealer operations and physical station operations remain disabled pending configuration.

## What was delivered

### Submission design and map

Removed crossed-out top copy and excess space; kept the desktop title on one line; fixed clipped italic final letters. Full 16:9 videos remain. Super Fast uses animated branching gold lightning and the large bolt; Fast uses layered silver wind. Both integrated thick timelines sit beneath the videos and share one cycle, with gold delivering at seven seconds and silver at fourteen. Prices use the same condensed italic face as the week counts. Pause, reduced-motion and hidden-tab behavior are supported.

Google's actual interactive embed loads following search/location/map action, with one selected verified dealer pin at a time. Live Chrome search for 95678 displayed CenterCourt Cards at **307 Lincoln St, Roseville CA 95678** and working map controls. Unmatched ZIP/city search honestly labels its directory fallback. Device coordinates are not sent to Google by the component. CenterCourt is **contact-only, setup in progress**, not an operational drop-off station; private operational directory count was zero. Do not invent pickup schedules or silently enable station selection.

### Capture and recovery

The persistent rapid camera stream remains independent of network upload. The compact 66×26 Front/Back cue flips for 300 ms in opposite directions; the completed-pair count is outside the camera and increments after durable Back save.

Original ArrayBuffers are stored separately from metadata, with atomic pairing and stable card/upload/action IDs. Older Safari Blob metadata did not guarantee its bytes remained readable. Recovery can use another intact local copy only after exact SHA-256 and byte-count matching, or continue from an already-verified remote original. It cannot reconstruct missing bytes if all local copies are unreadable and no verified remote original exists. Never clear the user's site data or discard failed records to hide an error.

Busy pairs now yield to healthy pairs before bounded retries. Background preparation no longer fetches unused display previews (roughly 23–25 MB per side in inspected examples). PREPARE storage failures receive at most two additional retries, three seconds apart, with durable counters; this does not automatically repeat paid analysis, authorization failures, lost leases or exhausted retry budgets.

### Photo decoder and grading

The decoder now admits narrowly validated ordinary Apple primary XMP capture-date/region metadata. Three affected exact originals passed in the actual Linux image, preserving original JPEG and gain-map bytes, full 3024×4032 oriented pixels, and exact independent pixel comparisons. Processing uses the evidenced **sRGB SDR base**, not HDR radiance; ambiguous/unsupported HDR and malformed structures remain guarded.

Assistance and executor now use the same canonical action hash. The affected job without an analysis run/refusal can resume through the existing saved-processing action with its source checks. Do not create replacement cards, rewrite statuses, bypass identity/geometry review or approve grades merely to clear the queue.

Staff-facing Astra labels now say ATLAS. Current job polling continues while Add cards is open and excludes superseded jobs, showing uploaded, queued, processing, review, attention or approved states as appropriate. Internal model IDs/protocol enums retain their technical names.

## What the queue evidence actually said

The **historical pre-release census**, 02:12:53 UTC, found 12 cards with 24 verified sides and nine attention jobs: five geometry reviews, two identity reviews, one analysis action conflict and one storage failure. There were zero analysis runs/refusals then. These are not present-day counts and do not prove the user's current test succeeded or the queue is cleared. Read current state only when needed for the owner's test report.

## Verification already complete

- Three production frontend builds, **730/730 frontend tests**.
- Actual native image, **585/585 tests across 55 files**, no skips; three exact affected-original replays.
- Chrome and desktop WebKit synthetic large-pair persistence, quota atomicity, reload and recovery checks; mobile layout widths 320/390/820 and desktop 1280.
- **34/34 canonical live checks**, **3/3 signed private reads**; 30 history and 21 customer tables preserved outside authorized control changes.
- Subsequent real live Chrome visual and actual Google pin check passed. It occurred after strict read-only preservation and could perform ordinary anonymous session bootstrap; it did not capture cards, resume recovery, call a grading model, submit an order or pay.
- Sixteen repository evidence JSON files parsed, 23 receipt hashes and four local audit links verified at closeout.
- The first native run had two missing legacy test-reference failures; exact committed read-only reference mounts corrected the fixture and all 585 passed with the same image. Earlier failed/preflight receipts remain retained. Do not misrepresent this as an unqualified first-pass result.

## Owner testing and next actions

Mark is testing now and will report here. The previous lead instructed him to refresh on the **same iPhone/Safari/site profile**, use **Resume saved uploads**, and **not clear site data**. Eligible attention jobs can use **Resume saved processing**; edge and identity reviews remain separate.

When feedback arrives, correlate card IDs and server job states with the new diagnostics rather than infer completion from a checkmark or total. Confirm no duplicate cards/replaced originals, correct image orientation, updated states on Add cards and actual analysis/report progress. Keep remaining failed records recoverable. If helpful, ask for the downloaded diagnostics file after a failure; do not ask for credential values. Screenshots may be explained by older in-memory JS until refresh, so establish the tested release before changing code.

Outstanding work: physical-device acceptance, real completed grading acceptance, any defects the new test exposes, operational dealer/station schedule/configuration, commerce/payment/shipping configuration, and a measured capacity plan if Mark wants actual 50-job concurrency. Existing authorization covers completing ATLAS work and deploying tested fixes; no blanket authorization for destructive data operations, fake grades or fabricated commercial settings. User prefers action and dislikes repeated permission requests.

At startup, prepare a concise acknowledgment that you are the new independent Astra Ultra lead, have loaded the live release context, and are ready for his test report. Do not demand immediate results, re-run the entire release, or declare everything complete. Preserve required session-log entries before/after any later commit-worthy change or deployment.
