# Reviewer performance and learning investigation

Date: 2026-09-28. Scope: investigation and proposed remediation only, requested by Mark. Root plus two GPT-6 Astra Extra High agents inspected current source, production records and stored-image metadata. Root reproduced the desktop layout failure with the real review component and production styles in a local browser using synthetic images. No application changes, deployment, restart, migration, grade approval, card correction, preparation retry or paid model call was performed.

Source examined: web `68c99d88`, private runtime `65b13352`, documentation HEAD `74cf824b`. Private diagnostic evidence lives at `/Users/markthomas/.codex/atlas-handoffs/atlas-review-performance-investigation-20260928`. Runtime and database observations were taken during this investigation; they are snapshots, not permanent production counts.

## Verdict

There are several independent problems. Lossless grading images should remain authoritative while we repair image delivery and review controls. Reverting image quality would not fix the desktop layout conflict, the disconnected correction link, the hidden approval path or the missing geometry-learning loop.

The strongest confirmed failures are:

1. A desktop CSS conflict shrinks correctly loaded card images to tiny thumbnails.
2. The queue downloads full inspection images for tiny thumbnails, without prioritizing the selected card. Verified image buffers are not shared across screens.
3. Full-resolution geometry display preparation happens on the read path, and editing waits for a large verified image.
4. The normal review screen is primarily a report browser. Its completion actions are concealed, its Next button wraps, and its correction link loses the selected finding.
5. Retained iPhone HDR failures expose an overly restrictive metadata validator. They predate the lossless release; the newest captures prepared successfully.
6. Human defect learning exists and has been used in real ASTRA requests, but it does not cover reusable geometry lessons or clean-card examples, and publication has scaling/recovery weaknesses.

## 1. Desktop images: a reproduced layout bug

`frontend/atlas-app/components/BatchGrading.module.css:49–52` makes a closed findings layout one column, but forces its findings panel to `display:block` and full height. This overrides the report stylesheet's hidden-panel rule in `packages/atlas-manual-workspace/src/report-review.css:129`. The supposedly hidden panel occupies a second grid row and consumes space intended for photographs.

Local Chrome evidence, using the actual `MachineReportReview`, the current production CSS and fully loaded 1350 × 1858 synthetic photographs:

| Measurement | Current production rules | Isolated diagnostic rule respecting `hidden` |
|---|---:|---:|
| Photo viewport height | 75 px | 611 px |
| Displayed card size | 31 × 43 px | 421 × 579 px |
| Supposedly hidden panel height | 516 px | 0 px |
| Image download/decode complete | Yes | Yes |

Only a local diagnostic stylesheet was toggled. No application fix was applied. Evidence: `layout-fixture.mjs`, `layout-proof.json`, `layout-before.png`, `layout-diagnostic.png` in the private evidence directory. This closely reproduces Mark's desktop screenshot. Mobile has a separate rule hiding the panel, explaining why this particular symptom differs between devices.

Git blame dates the conflicting rule to `1f0dd9cc`, September 27 at 01:46 Pacific, before the lossless release. This is not evidence that the images themselves failed to download.

## 2. Delivery: previews exist, but are not used consistently

The live queue showed 19 review cards, 29 needing attention and 3 in the label queue. All 19 review-rail images had natural dimensions 1350 × 1858 while displaying at approximately 42 × 58 pixels. `BatchGrading.jsx:96–102` returns the full inspection descriptor for thumbnails rather than its preview. All queue rows mount requests.

Stored-object evidence:

| Review queue image set | Bytes |
|---|---:|
| All 19 current front thumbnail sources | 22,727,438 |
| Six lossless front sources in that queue | 15,771,930 |
| Already stored previews for those six | 538,354 |
| Total with those six previews and the other 13 unchanged | 7,493,862 |

Those six previews are approximately 29 times smaller than the full files currently used in the rail. This is download overhead, not evidence of an upload failure.

`frontend/atlas-app/lib/batch-queue.mjs` uses a bounded FIFO queue with concurrency two. That protects backend capacity, but it has no selected-card priority. A local simulation using the production queue function queued 19 report reads, then selected the last card: the selected read still started nineteenth. Evidence: `queue-priority-proof.json`. This limit applies to descriptor/report reads, not all browser image transfers.

`packages/atlas-manual-workspace/src/verified-image.mjs:62` fetches with `cache:'no-store'`. Its verified buffers belong to the mounted component, not a shared card/image cache. `ManualCards.jsx:618` remounts report components between review stages. Consequently, images can be downloaded and verified again when changing screens or stages. Preview and full-image requests start independently, without a selected-card-first transfer scheduler.

### Geometry loads a different image

The geometry editor needs the original photograph's coordinate frame. This differs from the canonical 1350 × 1858 grading image. Current latest captures have 3024 × 4032 source frames. Their full-resolution lossless display WebP files are approximately 7.13–8.38 MB per side; working PNG fallback files are 19.68–23.43 MB. Context previews are approximately 90–119 KB.

`packages/atlas-connected-manual/src/review-display.mjs:13–81` generates these optional display derivatives on demand. Descriptor caching is in process memory, with 128 entries. A shared 15-second deadline includes queue time, reading, encoding and grants. Failure silently returns a full working PNG fallback; both preview and full output are produced before the display descriptor is returned. Restarting the runtime loses the in-memory lookup even where derivative objects already exist.

The browser intentionally withholds geometry editing until the full image is downloaded and verified. This explains the disabled handles in the screenshot. It does not prove that every minute of the original phone delay came from one cause: no network trace from that incident was available. Download, repeated work, server generation, device decoding and connection speed must be timed separately during remediation.

## 3. Review, correction and Add finding are disconnected

Confirmed source and live browser behavior:

- `FinalReportReview.jsx:220` wraps Next finding back to the first finding. This changes view state only; it does not confirm review.
- `FinalReportReview.jsx:276–278` puts the queue's completion/correction actions inside a closed **Review summary** disclosure below the image. Opening that disclosure in production revealed **Continue final review**. No save or approval was performed.
- `BatchGrading.jsx:291` receives a selected finding but drops its identity. The correction path recovers the workspace and navigates to `/manual/:id?from=batch` without the finding, side or edit intent.
- `ManualCards.jsx:358` can then open geometry attention or the read-only provisional report, instead of the requested finding editor. The link's behavior does not match its promise.
- **Add finding** is implemented and wired at `DefectReviewWorkspace.jsx:329`. It is absent from the report browser and available only inside the defect editor. The editor requires current verified inspection pixels and settled state; it does not clearly explain every reason it can be disabled.
- Rapid review has an actual geometry → findings → report confirmation flow. However, per-finding Approve progress is initially local memory; durable findings confirmation and learning publication occur at the final finding. Closing the flow earlier loses that individual progress.

The correction route also repeats serial workspace/session loads and requests the broad image scope, including original geometry assets that a defect-only correction does not need. This is confirmed extra work; the user's specific ten-second navigation delay was not independently timed.

These findings do not establish that the underlying trace-save backend is universally broken. Historical saved additions exist. The strongest evidence concerns entry, routing, readiness and action visibility.

## 4. iPhone preparation: retained failures and an actual validator gap

The current preparation records contain 101 completed sides and three sides in attention. All three failures are Front `PHOTO_HDR_UNSUPPORTED`, dated September 27 at approximately 21:27–21:29 UTC, before the lossless and background-control releases. The latest three cards, captured September 28 at approximately 17:01–17:03 UTC, completed preparation on both sides in 13–21 seconds from original handoff. Five of those sides subsequently completed physical geometry; one returned geometry review rather than preparation failure.

Bounded original-header inspection identifies the three retained failures as iPhone 15 Pro JPEG/MPF/ISO-21496 files, not HEIC. Their inert Apple face-region metadata contains `ConfidenceLevel` values 531, 214 and 144. The current JPEG validator in `packages/atlas-photo-runtime/src/jpeg.mjs:177–178` permits at most 100. That is a sufficient rejection condition unrelated to the visible card pixels.

This is a real compatibility gap, but these timestamps do not support calling it a newly introduced lossless regression. The phone failure screenshots do not expose their card IDs, so assigning a particular screenshot to a particular failed record remains unverified. A full isolated decode of all three retained originals, followed by the complete preparation path, is required before calling the compatibility problem solved. Header checks alone do not establish that every other validation step will pass.

An isolated replay of the current validator against all three extracted primary XMP blocks throws `PHOTO_HDR_UNSUPPORTED` at line 178. This confirms the specific blocking check without decoding or retrying the production cards. Companion evidence: `phone-header-check.json`.

### ASTRA input remains canonical lossless

The latest retained production request examined was created at 17:02:07 UTC on September 28 for Jaxson Dart. Its metadata names `gpt-6-astra` with `xhigh`, `inspection-context-v1`, and ten PNG inputs marked `noResampling:true`. Its two source hashes match the prepared manifests marked `lossless:true` and `atlas-prepared-lossless-webp-v1`. Current code decodes the 1350 × 1858 canonical inspection images into whole-image PNGs and exact crops. The request is not using the experimental full original-resolution policy. This investigation verified saved metadata and source bindings; it did not download the full request payload again or perform another paid analysis.

## 5. Learning: what actually exists

The current system learns by supplying saved human-reviewed examples to future ASTRA requests. It does not update model weights after each card.

At the read-only census:

- Seven durable `CONFIRM_FINDINGS` actions produced seven memory publications; none was pending.
- Historical publications contain 56 lesson records. Publications belonging to discarded cards are excluded from current retrieval.
- The active bank contains 20 **accepted** findings across two cards: 13 Abomasnow and 7 Threads examples. A third confirmed clean card contributes zero lessons.
- No active corrected, rejected or newly added examples are present. The code supports those outcomes, but historical manual trace additions belong to discarded cards.
- Three of 32 stored ASTRA requests actually included examples: two used 12 and one used 7. The other 29 had no eligible examples. Inclusion is proven; accuracy improvement is not.
- Geometry edits and original/corrected boundaries are retained in card history, but the defect-memory schema does not publish or retrieve reusable geometry/border lessons.

`CONFIRM_FINDINGS`, not merely browsing or saving a draft, is the publication trigger. It supports accepted correct predictions, corrections, deliberate rejections and independent additions. Final report approval is a separate certification action. The normal batch all-at-once approval performs findings confirmation internally, so it also creates the learning intent.

Current operational limits:

- Confirmation can wait up to 195 seconds for post-commit example publication. Errors are caught, and recovery is difficult to discover in the rapid path.
- There is no dedicated automatic publication consumer. Recovery currently depends on a subsequent permitted action and the original confirming reviewer retaining access.
- A pending relevant confirmation can block analysis of another card in the same family. There is no such backlog today; this is a scaling/failure risk.
- Retrieval matches a tightly normalized design family and uses at most 12 examples, favoring card number and recency. It is not a broad, curated visual knowledge base; one recent card can fill the example budget.
- Retrieval scans current confirmations and computes a global state hash; publication repeatedly reads/encodes source images per lesson. Both need benchmarked improvements before large-scale use.

Detailed source references and sanitized SQL evidence are preserved in the companion private `learning-audit.md`, `learning-live-evidence.json` and `learning-counts-evidence.json`.

## Proposed implementation order

### P0 — Make review usable and restore iPhone compatibility

1. Correct the hidden-panel CSS conflict, give photo panes a stable minimum size and verify desktop/phone layouts with both open and closed finding panels. Reuse the isolated reproduction as a real browser regression case.
2. Make one consistent review workspace the destination from both normal and rapid entry points. Keep **Add finding**, **Edit**, **Reject**, **Save**, and review progression discoverable. Preserve exact finding/side/frame when entering an edit. Return to the same item after save/cancel. Put the final completion action in the primary flow instead of a closed disclosure.
3. Persist per-item review progress, or label temporary progression accurately until explicit durable confirmation. Final report approval must still bind the current reviewed evidence and deterministic score.
4. Correct inert Apple metadata handling without weakening actual source, HDR-base, orientation or color validation. Replay the three originals offline, add regression cases from their metadata variants, then exercise normal JPEG, HEIC, HDR, orientation and malformed-file controls. Only after qualification, recover each retained card through its ordinary idempotent preparation path, preserving originals and history.

### P1 — Deliver preview first, selected card first

1. Persist small thumbnails and context previews during preparation, with durable descriptors. Never generate all display representations merely to open a review page. Use existing small previews immediately and lazily backfill missing historical representations with bounded work.
2. Prioritize selected-card metadata and image requests. Load rail thumbnails on demand; prefetch a small bounded number of upcoming cards after the selected card is ready. Cancel obsolete queued reads. Do not let a long queue compete with the active editor.
3. Share verified image buffers across queue, report and editor stages using content hashes plus current authorization, bounded memory, and explicit eviction/revocation behavior. Do not make private signed media globally cacheable as a shortcut.
4. Use progressive display consistently. A small preview may support orientation and coarse draft placement, but must never silently become final grading evidence. Preserve coordinate transforms and require verified authoritative pixels for final precision/confirmation. Benchmark precomputed full-resolution lossless assets first; qualify lossless region/tile delivery if large frames still prevent acceptable geometry interaction.
5. Split geometry-specific assets from defect-editor assets. Keep the source photo, canonical grading image and display preview roles explicit, without exposing implementation jargon in staff controls.

### P1 — Make the learning loop durable and observable

1. After a confirmed human review, commit the immutable learning intent with the review. Publish examples asynchronously through an idempotent, bounded reconciliation worker. Show **Review saved**, **Examples preparing**, **Examples available**, or a concrete retryable failure.
2. Preserve confirmation authority, exact source/frame/trace hashes and publication lineage. A worker publishing after the original confirmer loses permission is an authority-policy decision, not a silent retry change. Likewise, continuing new analysis with omitted pending lessons is a documented freshness policy decision; never resurrect superseded examples.
3. Capture accepted, corrected, rejected and newly added defects, plus explicit clean-card/region negatives. Add separately typed physical-outline and printed-border before/after examples with card design, background, source-frame mapping and reviewer provenance. Reusable geometry learning and clean examples extend current product scope and need explicit eligibility rules.
4. Keep retrieval advisory to proposals. Measurement and scoring remain deterministic, and final human approval remains explicit. Record which example versions every request received. Let authorized reviewers revoke bad examples with an auditable reason.
5. Decide explicitly whether removing test cards from the working queue should also remove their lessons from eligibility. The current discard policy does exclude them; do not silently reverse it.

### P2 — Prove accuracy and scale

Improve selection with stable design identifiers, diversity and per-card limits, then benchmark indexed retrieval and reusable per-side image processing. Promote broader cross-design lessons only after evaluation shows benefit. A count of examples, or proof that ASTRA received them, is not proof that grading got more accurate.

Use a held-out, independently reviewed set separated by physical card and retake family. Compare identical requests with and without reviewed examples. Measure missed defects, false positives, mistaken suppression of real damage, contour/measurement error, geometry error, grade changes and human correction time. Include accepted predictions, mistakes, clean regions, foil/glare, white/black backgrounds and different phone formats.

## Release gates and proposed performance targets

These are targets for qualification, not claims of achieved speed:

- On a specified ordinary connection (initial benchmark: 25 Mbps, 50 ms latency), selected-card preview p95 at or below 1 second and canonical front/back review readiness p95 at or below 5 seconds; cached same-card stage changes at or below 250 ms. Measure cold and warm behavior separately. Set the full-resolution geometry target from the prototype and actual asset-size budget rather than assuming the same download cost.
- Demonstrate no desktop pane collapse across 1280/1440/1920 widths, different browser zoom levels, and mobile portrait/landscape. Confirm touch and mouse geometry controls remain usable.
- Start from queue and complete add/edit/type-change/remove/save/cancel/reload, geometry correction, both-side confirmation, grade recalculation and final approval without a navigation loop or lost selection. Assert persisted state, not just button visibility.
- After confirmation, fault-inject interrupted publication/storage failure, recover one publication without duplicated lessons, and prove the next eligible request includes the expected version. Proposed normal publication target: p95 within 10 seconds after durable confirmation, subject to benchmark.
- Replay the three retained iPhone originals offline through the entire preparation pipeline. Record pixel/orientation/HDR-base evidence and source hashes; no test should succeed by silently substituting a recompressed original.
- Exercise concurrent reviewers and a realistic multi-card queue; record p50/p95/p99 API, transfer, decode, verification, preparation, save, measurement and publication timings. No stale frame approval, duplicate paid request, corrupted trace or silent learning failure is acceptable.

## Limits of this investigation

The desktop layout bug is reproduced, and the queue/navigation/learning findings are backed by source plus runtime observations. The original phone network timeline and specific screenshot card identity are not known. No fix is yet deployed, no complete original-image decoder replay was claimed, and no physical grading accuracy improvement has been measured. Previous passing unit/build checks do not substitute for this end-to-end browser and physical-card acceptance.
