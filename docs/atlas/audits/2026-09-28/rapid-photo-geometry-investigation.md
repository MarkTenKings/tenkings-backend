# Rapid Photos geometry investigation — 2026-09-28

The reported failures are real, but the lossless encoder did not cause them. Production remains on `a11ca928` while the corrections below are qualified for release. No saved grade or human review has been changed by this investigation.

## Evidence and causes

The read-only census at 06:49:53 UTC captured Cards 38–48, their 22 early-geometry records and six production ASTRA requests. The screenshot cards are Card 43 (`0883e437-dd44-46c4-893a-06f7ea6bb3f6`) and Card 48 (`51c1b851-0ed4-4447-b52c-96c04c764025`). The missing overlay on these photos is the **physical card outline**. Printed-border preparation cannot proceed until that outline is available.

| Case | Reproduced cause | Qualified correction |
| --- | --- | --- |
| Cards 42 and 43, Back | Printed design touching the cut edge divides its observed contour into fragments. Each individual contour fails the side-span requirement before the real perimeter is scored. | A bounded second search combines observed fragments within candidate edge bands. All four existing material-support checks, missing-edge refusal and ambiguity checks still apply. |
| Card 46, both sides; Cards 47 and 48, Front | Saved mat setting is Black; photo perimeter is 99.82–100% White and 0% Black. | The unchanged detector accepts all four with White, with full support on each edge. Front/Back mat overrides allow a mixed-background pair. |
| Cards 47 and 48, Back | These photos actually have Black backgrounds. | Preserve Black independently; switching the whole pair to White rejects these otherwise valid backs. |
| Needs Review intake | Retry is beside the highlighted photo, while the manual entry button is below the entire identity form. | Add Edit Front geometry / Edit Back geometry beside each photo; preserve the durable save/recovery path and open the selected side. |
| Card 41, Mosaic | Physical preparation succeeds, but a printed border remains unresolved. | Do not label both borders ready. Native before/after printed proposals are identical; no unsupported border is invented. |

Physical and printed geometry worker sources are identical between pre-lossless `0de150fa` and production `a11ca928`. Exact Card 43 working-PNG replays give the same accepted Front and rejected Back; printed Front and Mosaic proposals also match. Physical detection precedes prepared encoding, and printed detection uses the in-memory rectified raster. Changing the encoder invalidated cache identities, not the detection rules.

## ASTRA image proof

The latest Card 44 and Card 45 requests use `gpt-6-astra`, reasoning `xhigh`, and the canonical 1350 × 1858 inspection frame (1270 × 1778 card plus a 40-pixel surround). Their prepared files have the lossless WebP VP8L chunk and lossless encoder settings. All 20 actual PNG whole-image/crop inputs were recovered from their immutable request parts and compared to decoded canonical pixels: **zero mismatched samples**. Source hashes and request hashes match the retained records. These are not the original 3024 × 4032 experimental inputs.

The intake caption “full-resolution SDR working view” described the original-photo path and could also accompany a smaller outline preview. It is replaced with “Original photo retained · outline preview.” Full originals remain available for physical geometry. This change does not alter ASTRA, approved report images, grading rules or review authority.

## Changes and qualification

- Native proposal policy v3 adds the fragment search only when the original search finds zero supported candidates. At most 64 extra candidate seeds are fitted. In the 18-photo replay, all 12 previously accepted sides retain their geometry/evidence (apart from explicit policy provenance), two Threads backs recover, and four wrongly configured white-background sides still refuse Black as expected. Existing ambiguity and negative cases remain protected.
- Optional `frontMatColor` / `backMatColor` inherit historical `matColor` when absent or null. Workspace initialization and both SQL discovery interfaces use the same effective side setting. The additive migration changes functions only and preserves old detail records, jobs and geometry. Existing workspace settings remain authoritative.
- A narrowly scoped background recovery action is available only before physical geometry/findings have been adopted. It saves one side’s background with an exact settings base before retrying that side’s preparation.
- Direct editor entry saves pending identity/settings changes through the existing durable command journal. Incomplete pairs/uploads, uncertain commands, identity errors and reviewer access restrictions still block writes. Explicit entry selects the intended side even for a previously confirmed pair. Human approval remains separate.
- Deferred reveals accept only the pinned, qualified physical-proposer migration. All other pixel/native sources remain bound, and regenerated core image hashes, transforms and printed proposals must equal the retained preparation. Both historical quality-92 and current lossless preparations are exercised; unknown source, adapter, worker or native substitutions fail.

Chrome verification uses the actual intake page, attention component and geometry editor with synthetic local persistence: Edit Back opens Back, Start manual outline exposes four handles, and a one-pixel nudge changes its coordinate from 127 to 128. Only the expected details/initialize fixture actions occur. The user's production tab with unsaved background/corner selections was left untouched.

Qualification receipts and rollout observations are recorded in SESSION_LOG. Private originals, full requests and source manifests are intentionally outside Git:

- `/Users/markthomas/.codex/atlas-handoffs/atlas-geometry-review-investigation-20260928`
- `/Users/markthomas/.codex/atlas-handoffs/atlas-geometry-regression-20260928/helper`

These checks demonstrate recovery for the reproduced cases; they do not establish perfect automatic geometry for every future photo. Insufficient or ambiguous evidence must continue to reach a usable manual editor.

Final local review also verifies direct Back entry for confirmed pairs and suppresses stale intake failure/proposal displays after the current workspace takes ownership. Staff724, workspace153, native39 and backend82 tests pass; both build boundaries pass, with46 targeted recovery/attention tests passing after the final display correction. Deployment qualification remains pending.
