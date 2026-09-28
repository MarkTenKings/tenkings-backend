# ATLAS lead handoff: ASTRA full-resolution test 3

Prepared 2026-09-28 04:15 UTC (September 27 Pacific). This is a fresh-lead handoff, not a claim that test 3 or the proposed processing fixes are implemented.

## Owner's latest direction and next action

Mark explicitly requested: "package all this up and hand it off to a fresh new lead Astra Ultra agent that I can continue working with" and "go ahead and get them started on test number three, which is allowing Astra to grade the full big picture detailed images."

You are the new lead, requested model **gpt-6-astra**, reasoning **ultra**. Start the work after reading this handoff and the required repository documents. Do not stop at acknowledging capability or asking the owner to re-explain. The next priority is the ASTRA-only full-resolution experiment; do not silently replace that priority with the broader geometry repair backlog. Address any prerequisite that is actually necessary for the experiment and explain it.

The owner already authorized a six-card experiment, using the six cards captured after the lossless rollout. Reuse their saved photos and retained comparison evidence. The owner does not need to send photos again. Preserve the earlier/current analyses and approvals. Build a distinct, traceable experiment rather than overwriting existing grades or switching every production card to an untested input path. Reviewer and customer delivery stays on the current progressive lossless plan. The request for an Ultra coding lead does **not** authorize changing the grading model's existing `gpt-6-astra` / `xhigh` effort as another experimental variable.

Be mindful of credits. The earlier collaboration preference was at most one Astra Extra High helper; carry that conservative limit forward unless Mark changes it. Reuse saved artifacts for local validation, avoid repeated paid retries, and do not automatically rerun the old lossy arm. Test 3 authorizes the bounded six-card full-resolution work; report any missing comparison baselines clearly. No dollar budget was specified. Verify current pricing/billing before claiming dollar costs.

## Checkout and required process

**Use this existing checkout explicitly for every repository command:**

`/Users/markthomas/.codex/worktrees/1ce0/ten-kings-mystery-packs-clean`

Branch: `codex/atlas-independent-lead-20260925`. The prior code HEAD was `a11ca928a51309b50457579b74c849404e004043`; later commits are documentation: `7cd9abaf` release record and `69f38f69` six-card comparison. This handoff is another documentation commit. Run `git status` and `git log` on arrival. The project may initially open at `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`; that is a different checkout. Do not assume it has the ATLAS work. Reuse the existing worktree, do not reset it or create a competing implementation. The outgoing lead stops writing once the new lead starts.

Read `AGENTS.md`, then the mandatory files: `docs/context/MASTER_PRODUCT_CONTEXT.md`, the full owner-approved `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, and `docs/handoffs/SESSION_LOG.md`. The latter two are very large; current checkpoints and newest session entries are essential. Also read `docs/atlas/audits/2026-09-28/six-card-lossless-comparison.md`.

Trust code/runtime/DB over conflicting historical prose; update docs in the same session. Append SESSION_LOG for every commit-worthy change and before/after deployment, restart or migration. Destructive operations require explicit owner approval and destructive set operations require dry-run impact plus typed confirmation. No such deletion is needed here. Old release and repair intents are consumed; never replay them. Revalidate current production before any mutation. The lead alone should execute production changes. Preserve the existing controlled release workflow and immutable history.

## What is live and already finished

Live code source: `a11ca928a51309b50457579b74c849404e004043` (tree `ebf30bad531aab6d0bd29d638cbf4b6bb92d64f9`). Lossless release verified 2026-09-28 03:02 UTC:

- Staff: `dpl_4RNFBCw19Ljdz1G8URfSnncPNTEj`, `atlas-grading-staff-ao2a82prx-ten-kings.vercel.app`.
- Public: `dpl_AFbaoxdA3KpQygyuykhdVzjBJhou`, `atlas-grading-public-91ezlxi4i-ten-kings.vercel.app`. All four public aliases, including atlasgrading.com, select it.
- Customer unchanged: `dpl_2bUeFNMvvdkEDXjpJcWYRSpiHMmG`, `atlas-grading-customer-jyniceagx-ten-kings.vercel.app`, source `d4a7dec2af187f4aa03166e639f4d9bb066fb612`.
- Private image: `sha256:7c0d812d0ea7dff9b22d88432a46f74e3657947e2cad458c834b2ee80d1ccfeb`.
- Container: `d3d99b4f7c7df96abc7d16f2ba14faf2aa58080740bc6873706b92d366cbf252`, name `atlas-lossless-a11ca928a513`, started `2026-09-28T02:57:52.478516246Z`; zero restarts/no OOM at verification.
- Protected env path `/opt/atlas/lossless-release-20260928/candidate.docker.env`, SHA256 `fc4373d2d7a2c1af7937276f77056fe11385ace76ee5f7d962a07d5c537dedd5`. Do not print secrets.
- Controls Staff 44 / STAFF SMS 42 / Public 24; customer 15/13; staff/public migration ledgers 58/112.
- Capacity unchanged: ASTRA analyses 64, workflow execution 20, geometry 12, native 12. DB pools manual 4 / staff 1 / customer 2; web PgBouncer six backends. Runtime 14 CPU / 28 GiB / 1024 PIDs, read-only node user, capability drop, 4 GiB tmp, 125-second boot fence.
- Previous container `86072c803c5a78a71cd038d59b41152060f442a2ecda0ad404554594798e4160` retained stopped/exit 0, restart disabled, network detached.

Release evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-lossless-release-20260928/release-prep-v2/web`. `runtime-ready.json`, `signed-probes.json`, `promotion.result.json`, `canonical.result.json`, `live-image-check.json`, and `database-postflight-result.json` passed. These are records, not instructions to rerun old mutations.

Qualification passed 1,115 JavaScript tests and 38 Python tests, zero skips; 15 retained-photo native outputs had zero decoded-sample mismatches. Eight Chrome/WebKit progressive-image cases passed. Live approved-image hashes/dimensions and direct grants passed Chrome/WebKit. No paid model tests or approvals were performed by the outgoing agent for release qualification. Owner subsequently tested physically on iPhone and says the pictures are visibly clearer.

## Exactly what lossless means in this app

Canonical preparation remains **1350 × 1858**, containing a **1270 × 1778** straightened card plus a 40-pixel surround. New canonical images use 8-bit lossless WebP with `policyVersion: atlas-prepared-lossless-webp-v1`. The prior path used WebP quality 92 at the same dimensions. Lossless preserves prepared pixels exactly; it does not add pixels or recover original detail lost in resampling.

ASTRA's existing whole-side/context/crop PNG inputs are decoded from those canonical images. Thus the release eliminated lossy encoding at that stage but **has not yet tested source-resolution inspection**. New full inspection files in the six-card sample are 2.35–2.87 MB per side.

Human reviewers/public reports show a separate 558 × 768 JPEG quality-78 preview while the canonical image downloads, verifies SHA/byte length/dimensions, then replaces it. Preview metadata is source-hash-bound and outside immutable grade evidence. Editing, overlays and approval require verified full evidence. Public IMAGE_ACCESS issues 120-second grants for exact existing private Spaces objects, avoiding the Vercel binary-response size limit. Report-only staff reads use `view?images=inspection`; editing promotes to full imagery. Old approved images/grades remain byte-exact and are not automatically regraded.

Original uploaded photos and their color-managed full-resolution working PNGs are retained. The verified sports working PNGs in this test are 3024 × 4032. Verify each chosen side's own dimensions/hash rather than assuming all are identical. Source photographs, working frames, prepared geometry and original-to-prepared mappings matter for the new experiment.

## Test 3: concrete starting work

1. Inspect the existing ASTRA image-input builder, native preparation, crop definitions, response coordinate conversion and deterministic measurement interfaces. Identify where source detail is reduced and what exact input pixels the provider actually receives. Use current official OpenAI docs for supported image-detail modes, resizing/tile behavior, limits and pricing. A larger uploaded file alone does not establish that ASTRA sees more detail.
2. Build a separately identifiable ASTRA-only experimental input policy that exposes retained source detail, with reliable source/crop/prepared coordinate transforms and immutable hash/dimension bindings. Consider full-frame context plus source-resolution detail crops if required by provider limits. Decide from code and docs, not assumption. Keep human/public output and approved historical packets unchanged. Do not claim geometric resampling is pixel-lossless.
3. Use the **same six newest saved captures** below and the current lossless results from those exact captures as the available baseline. Keep model/effort and unrelated settings unchanged; freeze or record prompt, schema, reviewed-example bank and geometry. Explicitly distinguish unresolved baseline grades from actual before/after pairs. Do not repeat the previous lossy runs simply to create a prettier table.
4. Validate input-pixel provenance and coordinate mapping locally before paid calls. Test outside-boundary responses, source/image substitution, failed preparation and unchanged grade/approval gates. A high-detail response cannot be scored by silently treating source-pixel coordinates as canonical coordinates.
5. Run a bounded experiment with traceable requests for these six cards when ready. Reuse existing secure credentials/runtime mechanisms without exposing secrets. Record request/response IDs, model/effort, source/input hashes and dimensions, detail mode, number of crops, latency, tokens, cached tokens, verified cost and accepted/rejected findings. Inspect the first result for systemic mapping/format problems before spending the other requests; avoid retry loops. Preserve all previous analyses and human reviews.
6. Report findings and numeric/subgrades where genuinely comparable, localization/type changes, uncertainty, time/cost, and remaining failure reasons. Do not call more findings better accuracy without evidence. Tell Mark when the test is ready or complete and what, if anything, he needs to review.

The implementation and experiment are authorized. No broad production default switch to original resolution was requested yet. The owner previously authorized shipping lossless, which is already live. Follow the current request's experimental scope and established deployment process for any necessary isolated test support; do not treat it as approval to alter every customer's grading or report delivery.

## The six cards and previous comparison

New Cards 38–43 were captured September 27 at 20:28–20:30 Pacific. Last read-only state check: September 28 03:59:25 UTC. Queue state may have changed after that; re-read instead of assuming.

| Card | New card ID | Earlier matching card ID | Earlier machine result | New lossless result |
|---|---|---|---|---|
| Snivy, Legendary Treasures RC1/RC25, Card 38 | `83b2d9a3-e5c6-43f7-86fb-427ba25ab102` | `cb960f4b-a762-40a7-af74-17aa7493b449` | Six raw proposals, whole response refused for outside-card contour; no grade | Grade 10, 11 measured findings |
| Abomasnow, Astral Radiance TG01/TG30, Card 39 | `4387f336-dc5d-4837-9f81-c0397d1d884e` | `d9c352d0-7156-426f-ab8b-e758d1e6cca4` | Grade 10, 13 findings | 14 raw proposals, outside-card refusal; no grade |
| Magikarp, Stormfront 65/100, Card 40 | `922200f4-d127-4d03-a553-46d4f0575837` | `e1846c0d-daac-429b-8c9f-b34a38785e8d` | Ten validated proposals, no saved completed grade found | Grade 9.5, nine findings |
| Jaxson Dart, Mosaic Center Stage #7, Card 41 | `14ca115c-73fc-41a0-bc2e-d16805f91057` | `a33907e7-7545-4a55-94d4-d015410e0b08` | Three findings, printed geometry unresolved, no grade | Two findings, same unresolved printed geometry, no grade |
| Drake Maye, Donruss Threads DTBH-DME, Card 42 | `b5071619-0cc3-4da5-92b0-d78faeaf4f91` | `53d7cc51-4fcb-4fda-ab6f-2e19d8eb122c` | Grade 9.5, seven findings | Back physical-outline failure before ASTRA |
| Jaxson Dart, Donruss Threads DTBH-JDT, Card 43 | `0883e437-dd44-46c4-893a-06f7ea6bb3f6` | `70175eb0-c180-4b56-a5dc-586c22a7c142` | Grade 10, zero findings | Back physical-outline failure before ASTRA |

New analysis IDs: Snivy `75901416-d043-4618-a9c9-3e797e67aee3`; Abomasnow `0d07733f-6810-42da-a973-38d3547c6831`; Magikarp `cf695637-7a4a-4aeb-a287-ff606d277728`; Mosaic `fbe134e1-8b43-4486-aef8-5bee0ab1c4e1`. No new Threads analysis was dispatched.

Earlier matching analyses occurred September 25 Pacific, except Stormfront Magikarp on September 22; some were approved September 27. The September 27 Rebel Clash Magikarp 039/192 is a different card and must not be substituted. Use original machine BATCH_REPORT, not a later human-corrected report, for comparison.

Three new reports reached Review, but only two have numeric grades. Three other cards are Needs Attention. **Zero pairs had a completed original numeric machine grade on both old and new sides.** Recapture/framing/light changed, and new Abomasnow also included 12 reviewed examples versus zero earlier. Therefore the prior comparison does not establish improved grading accuracy or encoding-only causality. Keep lossless for its verified pixel preservation and owner-observed clarity, while being explicit about those limits.

ASTRA proposes defect types/contours/observations/uncertainty; it does not output the numeric grade. Native measurement and deterministic scoring calculate grades. Existing prompt forbids numeric grades/areas. Snivy raw score 9.775 rounds to half-point grade 10; Magikarp raw 9.668 rounds to 9.5. Do not change grading formulas to make comparisons appear consistent.

All paired runs use `gpt-6-astra` / `xhigh`; prompt SHA `ffdf36dd06afbaba89c29c8cf7c849047206c8662b3bceeb6af3fcee88212241`; schema SHA `4ff10247eb9975de53f63eafcdb08bf2b177c67c8f69d6c67a52c0284ccb26d3`; crop layout `inspection-context-v1`. Verify rather than hard-code these into an incompatible new input policy.

New analysis latency/input-output tokens: Snivy 250.06s / 16,157–11,056; Abomasnow 318.03s / 35,574–14,200 (rejected, 12 lesson examples); Magikarp 341.91s / 16,206–15,050; Mosaic 153.70s / 16,197–6,678. No cached input tokens recorded. Full old/new table is in the audit. No dollar prices were claimed.

## Processing failures: verified versus proposed

**Both Threads backs:** All edges/corners are visible in saved images. The owner's idea that larger sports cards extended beyond the on-screen guide does not explain these failures; the guide is not a crop boundary. Front physical detection passed. Backs passed initial mat visibility and generated two geometrically valid candidates, but neither passed the four-side support requirement: at least 24 of 33 sampled positions on every side. Receipt is `NO_SUPPORTED_PHYSICAL_OUTLINE`, not missing image, bad format, ambiguity or engine exception. This occurs before lossless encoding. Candidate measurements were discarded; zero per-side fields in failure receipts are defaults, not evidence of no sampling/zero contrast. Exact failing side/threshold still needs instrumented local replay of the retained PNGs. Glare/mat texture are hypotheses, not proven causes.

Manual path exists: Needs attention → Check card → Save & Review Geometry / Geometry → Physical edge → Start manual outline → position four corners → Save outline → Prepare this side → review supported printed geometry → Confirm both sides. Human confirmation must remain a real human action.

**Mosaic:** Physical preparation succeeded and ASTRA supplied two valid scuff findings, but printed geometry is unresolved on both sides of this borderless design, also in the previous run. It needs a supported centering reference. Do not invent a printed border or treat borderless as permission to skip centering. Glare is visible and ASTRA mentioned limitations, but glare is not proven to cause the geometry failure.

**Abomasnow:** Geometry/preparation succeeded. Five bottom-edge outlines (raw findings 9, 10, 11, 13, 14) extend at most three pixels beyond allowed card bounds. Canonical physical bounds x40..1309, y40..1817; bottom crop y865 plus model y955 reaches1820. `packages/atlas-defect-analysis/src/index.mjs` strictly rejects coordinates outside 0..1 and one bad proposal rejects the whole response. No findings were accepted. The rejected raw proposals are not editable as ordinary accepted findings. Manual tracing is available; Find defects with ATLAS can request another analysis when enabled, with another charge and possible recurrence.

Proposed but **NOT implemented**: independently retain validated findings for review while explicitly flagging invalid contours for correction, preserving raw evidence and blocking final approval until resolved. Do not silently clamp contours, drop invalid findings, loosen boundaries or fabricate a grade. Other proposed work is detector diagnostic replay and design-aware centering. The owner asked how to fix these, received an explanation, then redirected the next fresh lead to test 3. No processing-failure repair or paid retry has happened.

Useful code: `packages/atlas-defect-analysis/src/index.mjs`, `packages/atlas-manual-workspace/src/PairedGeometryWorkspace.jsx`, `DefectReviewWorkspace.jsx`, `astra-review-ui.mjs`, `frontend/atlas-app/components/ManualCards.jsx`, `BatchGrading.jsx`, `frontend/atlas-app/lib/manual-review-attention.mjs`. Native `atlas_photo_geometry.py` around233–245 and `color_geometry.py` around70–125 contain the physical-candidate rejection/default diagnostics. Locate exact current paths with rg.

## Retained evidence and access

Comparison evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-six-card-comparison-20260928`.

- `comparison.json`: exact paired IDs, timing/usage, proposed grades/subgrades, findings and prepared-image bindings; `summarize.py` generates it.
- `artifacts.private.json`: 99 immutable JSON artifacts verified by SHA, bytes and lineage, including PHOTO_SOURCE, PREPARED_IMAGES, GEOMETRY, EARLY_GEOMETRY, DEFECT_RESULT/RESPONSE, BATCH_REPORT, REPORT, FINAL_REVIEW.
- `matched-history.private.json`, `snapshot.private.json`, `runs-and-jobs.private.json`, `final-state.private.json`: read-only DB evidence. Do not print entire private histories into chat.
- `Card-39-4387f336-raw-proposals.json`, `Card-3-cb960f4b-raw-proposals.json`, `abomasnow-rejection-explanation.json`: exact refused analyses and coordinate calculations.
- `image-inspection.json` and `images/Card-41-FRONT.jpg` etc: six scaled sports diagnostic copies. These 756 × 1008 JPEGs are **not** the full-resolution test inputs. Retrieve verified original/working references from PHOTO_SOURCE instead.
- `collect-artifacts.py` and `inspect-saved-images.py`: existing read-only collection patterns; review before reuse.

Read-only DB access helper is `database.py` under `/Users/markthomas/.codex/atlas-handoffs/atlas-lossless-release-20260928/release-prep-v2/web`. Its `query(sql)` uses the established pinned SSH/read-only role with a 20-second statement timeout. Review it; do not call old apply/cutover/promotion entry points. Its file saver creates exclusive paths, so use fresh evidence directories. Some runtime helpers intentionally require exact deployed HEAD and will reject a newer documentation HEAD; respect that check and build a fresh explicit read plan rather than tampering with release evidence.

Pinned SSH settings are in that directory's `remote.py`; known host is161.35.178.144. Read-only S3 artifact access was performed inside the existing private container using `createRequire('/workspace/packages/atlas-photo-storage/package.json')('@aws-sdk/client-s3')` with existing protected `ATLAS_MANUAL_STORAGE_*` configuration. Root workspace SDK resolution fails; use the package context. Bound requests/timeouts and verify bytes, hash, content type and lineage. Never print env values, credentials or signed private URLs. For diagnostic sharp use `createRequire('/workspace/frontend/atlas-app/package.json')('sharp')`. Retained working raster references live under PHOTO_SOURCE.workingFrame.raster.

Local Node20: `/opt/homebrew/opt/node@20/bin`. Qualified Python: `/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/cpu-measurement/venv/bin/python`. Playwright is available through createRequire from `/Users/markthomas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/fixture.cjs`; Chrome channel chrome and WebKit available. Use repository requirements and existing native artifacts, do not reinstall or mutate the serving container ad hoc.

## Older context that must not be lost

- Owner-required removal of 30-minute/inactivity staff timeout is already live. Explicit sign-out/revocation remains. Staff-access failure was DB exhaustion while the session was still valid; managed six-backend transaction pooling was deployed. Do not reintroduce inactivity sign-out.
- Opaque P3 iPhone PNGs with redundant alpha previously failed preparation; v4 checks every alpha sample and handles fully opaque sources correctly. Originals retained, 16 sides across eight cards recovered. This is already deployed, not test 3 work.
- Rapid capture preview now shows the full camera frame with aligned guide, replacing the earlier misleading cropped preview. Red correction targets and exact-card routing are live and owner-confirmed improvements.
- Progressive/cached verified photo delivery fixed the prior repeated large-image loading behavior. Preserve these changes.
- The original 30-new-physical-card incident is not fully explained: diagnostics contain30 uploaded IDs, seven from an earlier batch plus23 new. Mark explicitly says he photographed30 NEW physical cards. The seven additional captures remain unresolved. Do not tell him the old counter alone explains them or ask for the same diagnostics again. It is background, not the next task.
- Preserve the approved homepage, voice assets, customer deployment, NFC/printing, billing and unrelated Ten Kings/Set Ops behavior. No new PR or goal was created by the outgoing lead.

## Outgoing lead status

Only documentation and a new lead chat are being created for this handoff. No code fix, production mutation, photo replacement, model request, paid regrade, manual outline approval or final card approval was executed during handoff. The new lead takes ownership of the checkout and starts test 3. Mark should continue in that new chat.
