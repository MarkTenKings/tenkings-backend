# ATLAS review reliability and learning plan

Date: 2026-09-28. Status: approved by Mark; implementation in progress with the lead and three Astra Extra High helpers. The proposal and acceptance requirements below remain the agreed scope; passing implementation evidence is recorded separately.

Prepared from the investigation by the lead agent and two GPT-6 Astra Extra High agents, including their independent review of the proposed sequence and failure cases. Evidence: [reviewer performance and learning investigation](../audits/2026-09-28/reviewer-performance-and-learning-investigation.md).

## Decision requested

Approve a staged repair of capture, review, image delivery and learning. Keep production's lossless grading policy and current grading rules while repairing the workflow. Introduce changes to what ASTRA learns only after establishing an independent accuracy benchmark and proving the candidate behavior against today's behavior.

This is the approved plan, not a claim that the defects are fixed. No application code, production data, model requests or deployments were changed while preparing the original proposal. At approval, production was web `68c99d88` and private runtime `65b13352`; subsequent implementation/release evidence belongs in the session log and implementation audit.

## What the evidence says

These problems need separate remedies:

- Desktop rapid review has a reproduced layout conflict: a supposedly hidden findings panel takes the image area. A local diagnostic restores photo pane height from 75 to 611 pixels without changing the images.
- The queue uses full inspection photos as tiny thumbnails and does not prioritize the selected card. Six existing previews would replace 15.77 MB with 0.538 MB for those six rail images. Components also repeat downloads and verification when changing screens.
- Original-frame geometry uses different, much larger images than ASTRA's canonical grading inputs. Current lossless geometry displays are about 7–8 MB per side, with a roughly 20–23 MB PNG fallback. Display generation can occur during a page read.
- The ordinary report viewer has navigation controls but conceals completion controls. Correction navigation loses the selected finding and can land in a read-only view. Add finding exists in another editor.
- Three retained iPhone failures encounter an overly restrictive Apple metadata check. They predate lossless. The exact extracted metadata reproduces that blocker; complete-image decoding still needs validation before recovery.
- Human defect feedback is already stored and has appeared in real ASTRA requests. Reusable geometry and explicitly inspected clean-card lessons are missing. Existing feedback usage does not demonstrate improved accuracy.

The latest inspected ASTRA request used ten PNG whole-card/crop inputs bound to the lossless canonical image manifests. The full-original-resolution experiment is not the production default. This source-binding evidence is not a fresh byte-for-byte comparison of every historical request.

## Requirements throughout the work

1. Preserve original uploads and previously approved reports. Keep production's lossless canonical grading images, coordinate conventions, deterministic measurements and scoring rules unchanged in the usability releases.
2. Keep the existing camera default: Black for each new Front and Back, with a per-photo White choice saved before automatic geometry. All four background combinations must work.
3. Separate a fast display preview from authoritative evidence. Previews can load immediately; final measurements, trace edits and approvals must use verified evidence in the correct coordinate frame.
4. Persist explicit human decisions. Looking at a finding, moving Next or abandoning a draft must never silently approve it or label it as correct.
5. Distinguish physical card edges from printed borders. A borderless card, an uncertain border and an unprepared photo need different states and explanations. Do not invent a border or centering result to make a queue advance.
6. Preserve recovery and auditability: revision checks, source hashes, idempotent saves and immutable approved report versions. A display repair or retry must not silently run another paid grade.

## Foundation: establish proof before changing behavior

Record the deployed model, prompt, image preparation policy, scoring version and eligible learning corpus. Save reproducible reference results, delivery measurements and a rollback configuration.

Instrument the entire path: original save, preparation, geometry, model request, queue read, first preview, authoritative image fetch, hash verification, decode, gradient preparation, editor readiness, save acknowledgement and lesson publication. Record bytes and percentile timings; a healthy server alone does not prove a responsive browser.

Build an ATLAS-owned benchmark with independently adjudicated examples: printed and absent borders, black and white backgrounds, JPEG/HEIC/PNG inputs that the product claims to support, supported iPhone HDR variants, foil, glare, clean cards, tiny defects and rare serious damage. Use physical inspection where a photograph cannot establish the answer. Label insufficient evidence explicitly.

Keep repeated photographs of the same physical specimen together. Hold out both specimens and selected card designs from learning. Resolve expert disagreements before using labels as benchmark truth. Establish numerical acceptance thresholds from this baseline before changing learning; do not invent a universal accuracy percentage.

## Release 1: make review a complete, dependable workflow

### One workspace, two navigation modes

Use the same review state and editing tools for ordinary review and rapid review. Rapid review advances through the queue; ordinary review opens a selected card. Neither should be a separate, less capable editor.

The visible sequence is:

1. Check front/back physical edges and printed borders; approve or correct them.
2. Check findings; accept, edit or reject each proposal and add any missed defect.
3. Review the recalculated grade and explanation, then explicitly approve the card and advance to the next ready card or label queue.

Correct the desktop hidden-panel CSS and test real viewport sizes. Keep images large when the findings panel is closed. Ensure controls remain usable at browser zoom, narrow desktop widths and phone portrait/landscape sizes.

Expose Add finding, Edit, Reject, Save and Cancel in the review workspace. Preserve the selected side, finding, image frame, zoom and position through editing. Avoid a full route change and repeated asset preparation for a simple correction. Provide keyboard shortcuts without making them the only way to operate the screen.

Keep Browse next distinct from Confirm and next. At the final item, offer completion or clearly identify what still needs a decision; never loop indefinitely as if browsing completed a review. Show why a button is unavailable and the specific action needed to continue.

### Durable decisions and correct invalidation

Save per-finding review progress so reloads, device changes and interrupted sessions do not erase it. Keep this progress separate from final card approval and final lesson eligibility. Show saving, saved and retry states accurately.

Use revision checks for simultaneous reviewers and idempotency for repeated clicks or lost responses. A second reviewer must not silently overwrite the first reviewer's newer decision.

A changed defect is remeasured and its review decision renewed. A geometry or source-image change invalidates affected measurements and current approval eligibility. Transform existing annotations only when the transformation is valid; otherwise require placement again. Historical approved reports remain intact.

Acceptance: complete a qualifying card in both review modes; add/edit/reject findings; approve valid printed borders; correctly identify a legitimate borderless case; reload mid-review; resume on another device; simulate a lost save response and conflicting review. For a borderless case whose centering rule is undefined, preserve available findings and withhold centering/final approval until an owner-approved, versioned scoring rule exists. Resolving that rule is a prerequisite to certifying those cases, not an implicit scoring change in the UI repair. Nothing disappears, falsely approves or lands in a read-only correction screen.

## Release 2: repair iPhone preparation and image delivery

### Correct the iPhone validator and recover retained originals

Classify metadata by whether it affects decoding, orientation, color or safety. An inert face-region confidence value must not be treated as proof that an otherwise supported image cannot be prepared. Preserve strict validation of malformed containers and genuinely unsupported image/color paths.

Test the proposed pipeline on all three complete retained JPEGs, not only their extracted metadata. Verify original hashes, orientation, dimensions, color handling and the intended SDR interpretation. Exercise malformed, duplicated and oversized metadata and unsupported HDR negative cases. Widening one numeric bound is not sufficient release evidence.

After those tests pass, offer recovery from the already saved original, retaining the existing upload identity. Distinguish retryable infrastructure failures from unsupported format failures. Resume must not repeatedly execute a known deterministic failure without explanation.

Fence work against replacement photos and changed settings. Test double-click, reload, late completion and partial front/back recovery. Do not duplicate uploads, grades or ASTRA calls. Confirm both newly captured photos and the retained failures on actual iPhone and desktop workflows.

### Prepare display assets before a reviewer needs them

Generate the small preview independently of the expensive full display. Produce and index display derivatives durably during asynchronous preparation; image/report reads should retrieve existing descriptors, not decode, encode or write new images.

Persist derivative identity and status so a restart does not regenerate an existing asset. Use idempotent bounded jobs, observable failures and retry handling. Do not silently fall back from a missing 8 MB display to a 23 MB PNG. Show a useful preview and a clear preparation state while the correct asset becomes ready.

Retain the original first. This work changes delivery of saved photos; it does not replace original uploads with compressed evidence or make ASTRA grade a thumbnail.

### Give the selected card priority

Split lightweight queue metadata/thumbnails from full card evidence. Use existing previews in the rail, lazily load visible rows, and safely create missing previews for legacy records from their immutable saved images. A new preview does not change an old approved photo's quality or grade.

Prioritize the selected card's preview and required full images, then the next few likely cards. Cancel stale speculative requests without cancelling a request still used by another view. Do not download every full card in a large queue.

Share verified image buffers across review stages, bounded by memory and authorization scope. Key reuse by immutable source/descriptor identity, policy and dimensions; handle logout/revocation and release unused buffers. Changing screens should reuse already verified evidence.

Profile full-original geometry separately. Measure network, hashing, decode and gradient costs; move expensive work off the main thread where justified. Retain the authoritative coordinate and pixel checks before enabling final edits. If the measured full-image path cannot meet the target, evaluate a coordinate-preserving lossless tile design in a separate prototype, with pixel and transform proof, before adding that complexity.

### Proposed performance acceptance targets

These are release targets to validate, not current measurements or promises for every connection. Primary profile: 25 Mbps down, 50 ms latency, representative desktop and supported iPhone, with the current 12-megapixel geometry fixtures. Measure cold and warm sessions separately.

| Interaction | Proposed p95 target |
| --- | --- |
| Selected card shows a useful preview | Within 1 second |
| Canonical front/back inspection evidence ready | Within 5 seconds |
| Switching between already cached review stages | Within 250 milliseconds |
| Full geometry pair editable on the specified fixtures | Within 10 seconds |
| Ordinary review decision durably acknowledged | Within 1 second; expensive remeasurement has separate visible progress |
| Customer report useful preview / verified inspection pair | Within 1 second / 5 seconds |

Also test 10 Mbps/100 ms, large images, constrained phone memory, cold server restart, long queues and concurrent reviewers. Do not claim the same geometry deadline on a link whose transfer time alone exceeds it. Record the supported capacity envelope and bottlenecks before promising higher throughput.

## Release 3: make feedback durable and recoverable

Separate three events: human feedback saved, reusable example prepared, and example active for future grading. Show these as distinct states with timestamps and failures.

Commit the confirmed review and an idempotent publication job together. A background worker prepares examples, retries transient failures and resumes after restart. Reuse source reads and decoded images while building a publication. Move global history scans to indexed, scoped retrieval. Ordinary grading and review screens should not wait up to minutes for lesson preparation.

Store useful evidence for each finalized decision: source image/crop and hashes, physical specimen and design identity when known, capture conditions, before/after geometry or trace, classification, measurements, reviewer decision and reason, reviewer identity, time, and model/prompt/image/scoring versions. Preserve supersession and provenance.

Support separate labels for accepted findings, corrected findings, rejected false positives, added missed defects, explicitly inspected clean areas/cards, accepted geometry and corrected geometry. Unknown or uninspected is not clean. A zero-finding model output becomes a clean example only after explicit human inspection. Capturing accepted results is necessary to learn what success looks like.

Recommended policy decisions in this proposal:

- An expired browser session does not erase a valid committed confirmation. A durable worker may finish the work authorized by that confirmation. Explicit reviewer revocation holds unpublished work for an authorized review; removing access and declaring historical labels unreliable are separate actions.
- A delayed or invalid example is excluded along with its superseded versions. Unrelated cards can use other eligible examples or the baseline. Record the missing coverage; do not let one pending lesson stop a whole card family. This does not relax evidence requirements for approving the current card.
- Keep trusted lessons when cards leave the active queue through archival. Explicit withdrawal or invalidation removes affected lessons from eligibility while preserving audit history under the applicable retention policy. Do not conflate routine queue cleanup with deleting learned evidence.
- Finalized feedback is captured immediately. Candidate preparation should normally take seconds and must be observable. Active use follows the approved quality and release policy; saving a review does not automatically endorse a new general grading rule.

Acceptance: worker restart, storage timeout, repeated event, revoked authority, superseded review, concurrent edits and a lost response each recover without duplicate examples or paid reanalysis. There must be a visible, actionable failure state rather than silent dropped learning.

## Release 4: improve ASTRA through controlled, relevant learning

### What ASTRA receives

ATLAS owns the memory and chooses what to include in each API request. Human review does not automatically retrain ASTRA's model weights. A future grading request receives the current card's proper lossless inputs, stable grading instructions and a small relevant packet of trusted examples when useful.

For example, an approved case may show that a particular foil reflection is not damage, while another shows a real scratch with an accurately traced boundary. The packet explains the reviewed distinction; ASTRA still evaluates the new photo. Existing measurements and scoring rules determine the grade.

Use normalized design identities, reviewer quality, relevance and diversity. Limit examples from a single source card. Keep design-specific false-positive lessons narrowly scoped unless broader transfer is proven. Exclude the target specimen and its retakes from evaluation retrieval. If no example is appropriate, use the baseline rather than filling the request with weak matches.

Send geometry lessons only to the geometry component through a tested consumer. Send defect lessons to defect analysis. Do not stuff every prior decision into every agent or add grading agents unless measured results justify their extra latency and cost.

### How improvements become active

Start with the frozen production baseline. Build a candidate retrieval policy and corpus snapshot, then compare baseline and candidate on identical held-out inputs. Include blinded expert adjudication and repeated runs where model variability matters.

Measure physical-edge and printed-border error, defect precision/recall, missed serious damage, false alarms on clean/foil cards, grade consistency, reviewer correction time, latency and API cost. Inspect results by card family, device, background and defect severity. A better overall average must not conceal a meaningful regression on rare serious damage or another critical segment.

Begin live comparison in shadow on a bounded sample with an explicit inference budget. Then release to a small cohort after the preset gates pass. Record the exact lesson IDs and versions used for every grade. Keep the prior corpus/retrieval version available for immediate rollback; rollback must not discard newly captured feedback or change approved reports.

After a retrieval policy is validated, narrowly scoped new examples can become eligible through its automated evidence/quality checks and versioned publication process. Ambiguous labels, broad generalizations, changed prompts and new geometry behavior stay in the candidate lane for further evaluation. Sample new publications and monitor actual corrections after activation. This allows fast reuse without claiming that every new example guarantees a better result.

The durable advantage is a trusted, searchable body of image evidence and expert decisions, consistent measurements, a benchmark competitors do not have, and documented improvement over time. Storing more labels alone is insufficient.

## Customer report and publication contract

Use the repaired progressive viewer for the public report too, without staff-only editing components or background work. Present the approved grade, subgrades and plain-language reasons first. Let customers inspect front/back photos, tap a finding, compare its marked and unmarked image, zoom and optionally inspect measurements and centering.

Bind every precise overlay to the same verified frame used by the approved report. A lightweight preview must not imply that full-detail evidence has already arrived. Use lossless detail for reports whose approved evidence is lossless; retain the actual historical evidence for older reports.

Publish only explicitly approved versions. Later staff edits produce a new pending revision and require approval before changing the current public result. Previously approved versions remain auditable. A customer never encounters staff approval controls, provisional edits or a silent change to their certified evidence.

## Rollout and proof of completion

Start benchmark construction and instrumentation first. Release the verified layout/control repairs promptly; intake and delivery work can proceed in parallel once their source boundaries are fixed. Land learning durability before expanding learning influence. Test the shared customer viewer with every applicable release.

For each release, require:

1. Focused automated checks of the affected state transitions, failure recovery, image/frame identity and permission boundaries.
2. Actual browser acceptance on desktop Chrome and supported iPhone Safari using representative card evidence; synthetic fixtures alone do not prove iPhone capture or real reviewer completion.
3. Cold/warm timing and byte measurements on the declared profiles, including concurrent demand. Record throughput limits and memory behavior.
4. A controlled deployment with versioned rollback, post-release checks, and the owner's actual capture-to-review-to-report acceptance.
5. Before/after evidence: screenshots/video, timing distributions, hashes, save/reload outcomes, learning lifecycle counts and, for learning behavior, held-out accuracy comparisons and cost.

Do not declare completion from a passing build alone. A card must travel from capture through preparation, geometry, findings, explicit approval, label eligibility and the public report. A finalized lesson must be recoverable and its actual use in a later request traceable. Accuracy must be measured separately from whether a lesson was included.

## Expected experience

Reviewers should open a card and immediately see useful front/back photos, followed by verified detail, with large images and direct geometry and finding controls. Decisions survive interruptions; the next card is prepared ahead; explicit approval leads forward rather than looping. Photo or evidence problems have a clear remedy. Customers should open a fast, polished ATLAS report with the approved grade, understandable reasons and detailed photos that let them inspect exactly what affected the grade. Both experiences rely on the same traceable approved evidence, while the learning system improves only through recorded, tested changes.
