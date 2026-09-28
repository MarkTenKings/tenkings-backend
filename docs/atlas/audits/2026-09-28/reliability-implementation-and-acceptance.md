# ATLAS reviewer reliability: implementation and acceptance

Date: 2026-09-28. Status: implementation and release qualification in progress. This document does **not** certify a production deployment or an accuracy improvement.

Scope: [approved plan](../../plans/ATLAS_REVIEW_RELIABILITY_AND_LEARNING_20260928.md). The lead and three Astra Extra High helpers share implementation and independent review. Production changes require the exact committed source, native-image qualification, owned PostgreSQL qualification, web builds, and reviewed release helpers to agree.

## Implemented boundaries and evidence

| Area | Result and evidence | Remaining acceptance |
| --- | --- | --- |
| iPhone preparation | All three complete retained failing JPEGs decode after correcting the inert Apple confidence metadata bound. Original hashes are unchanged; orientation 6 produces 3024 × 4032 working images; independent pixel permutation matches the lossless display. Strict unsupported HDR, malformed-container, color and pixel limits remain. | Deploy the qualified native image; offer/resume the exact retained originals through their existing recovery identities; actual new iPhone capture acceptance. |
| Review workflow | Ordinary and rapid review share visible geometry/finding tools. Add, edit, reject and save preserve the selected side/frame and viewport. Browse next stops at the last finding. Per-finding decisions are human-only, revision-bound and durable; final findings confirmation and report approval remain separate. Later detector updates cannot replace an explicitly reviewed finding. Editing one finding retains other decisions only when their evidence and measurements remain exactly unchanged. | Exact-source full regression and deployed authenticated browser acceptance. No agent has approved a real customer's card. |
| Desktop/mobile layout | Chrome checks at 1280 × 800, 1440 × 900, 1920 × 1080, 390 × 844 and 844 × 390 show usable image areas and finding controls. | Physical iPhone Safari acceptance is distinct from desktop WebKit/mobile viewport checks. |
| Image delivery | Small thumbnail reads, visible-row loading, selected-card request priority, bounded prefetch and authorization-scoped verified-image reuse replace full-image rail downloads and repeated stage transfers. Display generation moves into durable background jobs. Optional-preview operations have a separate two-second deadline and cannot remove access to valid full evidence. The worker prioritizes recently selected sources while preserving background progress. | Exact-source qualification and production backfill/readiness checks. |
| Canonical image integrity | Lossless canonical grading inputs and original uploads remain authoritative. JPEG previews never unlock geometry editing or exact overlays. Real Chrome/WebKit reject corrupt full images, reject incorrectly bound previews and recover through explicit retry. Native transforms, measurements and scoring have no planned changes. | Exact-source Linux/native byte checks and post-release source/image binding probes. |
| Feedback durability | Human confirmation and a publication job commit together. Worker leases, captured access versions, retries, immutable feedback and saved/prepared/active states are implemented. New candidates are physically separate from legacy publications, including during old-binary rollback. | Exact-source deployment with both additive migrations and narrow serving grants; baseline corpus remains active. |
| Controlled learning | Defect retrieval/evaluation and versioned release/rollback tools are implemented. The independent reference pack deliberately contains no invented truth labels. Geometry/clean consumers, normalized specimen and reviewer-quality policies, and controlled promotion are implemented and have passed focused regression. Each domain has separate release membership; invalid examples are omitted, and changed runtime policies fall back to baseline. | Independent adjudication, preregistered thresholds, authorized paired model comparisons and approved activation. Passing code tests cannot establish improved optical accuracy. |
| Public reports | Progressive previews are separate from verified immutable approved evidence. Optional preview failure cannot remove independently valid full image access. Staff corrections do not replace an approved report until explicit new approval. | Same-source public build, preserved homepage/customer deployment, signed report probes and production browser checks. |

## Measured browser image path

Measurements use the actual retained image bytes and the real geometry/report components on this Mac in Chrome. Network emulation limits the aggregate page connection. Timing begins **after image descriptors are available**; it excludes initial HTML, authentication, metadata/database work, server preparation and human review. These are not physical-iPhone or production end-to-end claims.

Primary profile: 25 Mbps down / 50 ms latency. Twenty geometry trials across two distinct full-photo pairs; ten inspection trials.

| Interaction | Measured p95 | Plan target |
| --- | --- | --- |
| Geometry useful preview | 194.8 ms | ≤ 1 second |
| Full geometry pair editable | 7,769.4 ms | ≤ 10 seconds |
| Cached geometry stage reuse | 39.3 ms | ≤ 250 ms |
| Inspection useful preview | 166.6 ms | ≤ 1 second |
| Verified inspection pair | 1,785.8 ms | ≤ 5 seconds |
| Cached inspection reuse | 2.9 ms | ≤ 250 ms |

Geometry pairs transfer 20.88–22.05 MB and the inspection pair 5.35 MB. At 10 Mbps / 100 ms the measured geometry pair needs 17.3–18.1 seconds and inspection 4.4 seconds; useful previews remain under 0.5 seconds. Full geometry cannot beat the underlying transfer time. Browser decode is asynchronous; unchanged gradient/snap preparation still has roughly 165 ms cold main-thread work. An alternate asynchronous raster experiment worsened cached switching and was removed; its failed measurements remain retained.

The shared image pool also passes real React StrictMode, duplicate-pane, URL-renewal, remount, independent lease, scope-change and revocation checks in Chrome and WebKit. Simulated persisted page-transition events clear private image bytes and force a fresh page load. That check is not a claim of exhaustive native Safari back/forward-cache behavior.

## Qualification evidence locations

Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-review-reliability-20260928`.

- `performance-acceptance/result.json` and `summary.json`: final retained image-path timing distribution.
- `qualification/geometry-chromium/result.json` and `geometry-webkit/result.json`: preview, full hash/dimension, editing gate and failure cases.
- `qualification/report-browser/result.json`: eight actual-browser report cases using a retained 1350 × 1858 lossless inspection image.
- `qualification/cache-browser/result.json`: cache, authority and simulated persisted-transition checks.
- `qualification/reviewer-final/reviewer-browser-proof.json`: latest five-viewport layout, selected-finding correction, durable local decision and separate-confirmation evidence with synthetic pixels and local state.
- `qualification/finding-progress-hardening.log`: 41 passing focused checks for reviewed-finding protection, evidence-sensitive decision retention, workflow and memory integration.
- `release/runtime-baseline.json`, `provider-before.json` and private database census: read-only production baseline captured before this release. These prove the **old** deployment, never the candidate.
- `release-prep/native`: offline source-overlay build and qualification helpers preserving the exact deployed native dependencies and compiled artifacts.
- `release/web-helper-review.json`: fresh same-source staging helpers; root independently reran all 40 helper tests successfully.
- `release/release-helper-review.json`: reviewed runtime, database, migration-ledger, grants and rollback helpers. Root independently reran 17 runtime/database and 11 native preparation helper checks; these are local guard tests, not evidence that a production deployment occurred.

The final owned PostgreSQL rehearsal `reliability-postgres-qualified-v3/result.json` passes nine display and eight learning groups; root independently matched all 25 fenced source hashes. Focused learning checks pass 179/179, with 55/55 follow-up binding checks. These are implementation checks, not optical accuracy measurements.

Photo, SQL and learning evidence is under sibling `atlas-review-performance-investigation-20260928`. Owned PostgreSQL rehearsals use an isolated nonce-owned database and synthetic reviewer/card identities. They do not create production human decisions. Final source-bound receipts supersede earlier failed or pre-hardening runs; all failures are retained.

## Release and external gates

The existing production baseline is staff/public web `68c99d88e851082d995b92ad12b3fff7b4b85a3b`, private source `65b13352536c7448fd6848e8060acd4c5bfd503c`, image `sha256:21326f23021fc1347b28bc7e97b2091a7d1fbb7d9c578d8e47060df89c06c4e8`. The customer deployment remains independently pinned. New web/private source must match; the two new SQL migrations are additive. Rollback retains old runtime/image/environment, candidate feedback, originals and immutable approved reports.

The existing staff authentication contract binds sessions to the control revision. A release changes that revision, so staff must sign in normally again before authenticated production browser acceptance. Release verification must not fabricate a session or bypass that boundary. The three retained-photo recoveries have a separate legitimate machine continuation using their original captured owner/access versions; it cannot certify a report or create a human review.

The learning baseline is a reproducibility snapshot of previously eligible examples, **not** an expert accuracy certification. New defects, clean areas and geometry examples must not become active merely because their preparation succeeded. Independent truth, physical specimen grouping, reviewer adjudication and domain-specific gates are required. No model requests, fake adjudications or candidate activations were performed for the evidence above.

Borderless centering remains explicitly unresolved where no approved scoring rule exists. Reviewers can record an absent printed border and retain other findings; software must not invent centering or a final grade to advance the queue.

Deployment identities, final test counts, recovery results and production acceptance will be appended here after they are observed. Until then, this implementation is not represented as fully released or perfectly accurate.
