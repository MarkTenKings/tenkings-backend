# Fingerprint: source audit and isolated feasibility boundary

Date: 2026-10-21 owner session. Source inspected in the canonical `atlas-marketplace-foundation` worktree; HEAD at this audit was `440d593564fd58e1597d7cf20ca05b154a2c1bad`.

This is a local, read-only source audit and a proposed offline feasibility sequence. It does not qualify a matcher, verify deployed behavior, acquire production records, start a camera, run inference, or change any report, grade, title, NFC tag, or grading service. No matcher is implemented by this document.

## Owner requirement

Fingerprint must not touch or interfere with the working Grading workflows, processes, or systems. The proposed experiment must operate without grading runtime imports, calls, credentials, databases, queues, workers, deployments, or inference configuration. Grading and saved reports must continue to work if Fingerprint is missing, unavailable, incorrect, or overloaded.

The intended experiment is narrower than authentication: compare new photographs with visible evidence in a particular saved approval and explain agreement, insufficient visibility, or discrepancies. It must not assert authenticity, change the original grade/report, or transfer ownership automatically.

## What the existing source actually provides

| Source reference | Observed behavior and feasibility implication |
| --- | --- |
| [`report-fingerprint.mjs`, lines 3–26](../../../../packages/atlas-manual-workspace/src/report-fingerprint.mjs#L3), `fingerprintSource` | The current recipe is `atlas-mask-tide-pixel-centers-v1`. It forms a union of saved finding-mask spans and renders a distance-field visualization. Order, IDs, duplication, and splitting do not change that union. The art excludes record ID, grade, identity, randomness, and the other side. There is no new-photo detector or physical-card comparison. Identical saved masks can produce identical art. |
| [`ReportFingerprint.jsx`, lines 6–14 and 71–81](../../../../packages/atlas-manual-workspace/src/ReportFingerprint.jsx#L6) | This layer explicitly owns presentation only; the report viewer owns photograph readiness. Missing traces and no recorded defects have distinct unavailable/empty states. Those states cannot become evidence of a physical match. |
| [`ATLAS_FINGERPRINT_V1.md`](../../design/ATLAS_FINGERPRINT_V1.md) | The historical marketing study is a different identity/defect-record-to-graphic recipe. Its examples use authored polygons. The document expressly excludes photo detection, physical authentication, uniqueness guarantees, secure-chip identity, and anti-copy protection. Neither that study nor the current graphic is a matcher. |
| [`manual-public-contract.mjs`, lines 26–47 and 60–65](../../../../packages/atlas-report-view/src/manual-public-contract.mjs#L26) | The saved public packet has an approval version, report hash, accepted findings, front/back image descriptors, and geometry. Inspection hashes must match the corresponding image hashes. Traces are validated in a 1270×1778 coordinate space. Image descriptors are specifically 1350×1858 WebP, with a maximum encoded size of 50 MiB per side. These are approved derivatives; this contract does not establish paired raw masters or phone/slab calibration. |
| [`useInspectionImages.mjs`, lines 18–25 and 46–58](../../../../frontend/atlas-public/components/useInspectionImages.mjs#L18) | Current report image access is bound to token, approval version, public hash, side, image hash, and byte count. Canonical inspection access is distinct from optional presentation access, including generated presentation images. This is evidence of existing binding concepts, not permission to call this reader from Fingerprint. |
| [`pages/reports/[token].jsx`, lines 9–32](../../../../frontend/atlas-public/pages/reports/%5Btoken%5D.jsx#L9) | The current report page reads and displays a saved version and has no new-photo authentication flow. It imports the existing report runtime/viewer. Fingerprint must not import or wrap this page to obtain its data. |
| [`manual.mjs`, lines 12–36](../../../../packages/atlas-finishing/src/manual.mjs#L12) | Finishing binds the exact immutable approval and public packet, and NFC points to `https://atlasgrading.com/reports/<token>?v=<approvalVersion>`. Reading that URL is not physical-card or chip authentication. No NFC rewrite or hardware operation is needed to study a separate comparison flow. |
| [`RapidCardCamera.jsx`, lines 19–55, 66, and 86–89](../../../../frontend/atlas-shared/RapidCardCamera.jsx#L19) | Existing capture has stream-generation checks, stops camera tracks on hide/unmount, captures the whole preview frame, and guides a front/back card pair. It supplies useful design concepts for a separate capture implementation. It does not qualify slab-glare, focus, registration, or physical identity. Its callers and imports must not be reused as a route into intake/grading. |
| [`rapid-camera.mjs`, lines 1–67](../../../../frontend/atlas-shared/rapid-camera.mjs#L1) | The helper prefers native still capture when requested/supported; the mounted camera currently requests `matchPreview: true`, which captures the delivered video frame as PNG. Neither path promises maximum sensor resolution. File size and frame-pixel limits exist, but they are not proof that a photographed defect is visible or discriminative. |
| [`geometry-focus.mjs`, lines 1–3 and 59 onward](../../../../packages/atlas-manual-workspace/src/geometry-focus.mjs#L1) | Existing display geometry includes a draft homography and imports grading geometry/scoring. It is not a qualified phone/slab registration pipeline and must not be imported by Fingerprint. Only the general geometric concept may inform an independently implemented offline experiment. |

The searched capture, report-fingerprint, photo-core, and preparation sources did not reveal a qualified same-physical-card matcher. Existing preparation and grading geometry are not available dependencies under the owner's isolation requirement.

## Reference limits

A future, separately authorized one-time copy may supply an immutable approved snapshot for offline study. No production acquisition, exporter, background sync, signed-media request, or service integration is authorized or performed by this audit.

An offline reference must preserve the exact approval version and public packet bytes/public hash, the packet's separate report hash, front/back inspection image bytes and hashes, and the saved traces and geometry. Approval-action identity and original-source provenance may be recorded only when supplied by an authoritative copied manifest; the public packet alone must not be claimed to contain them. Preserve absent fields as absent. Never silently select a newer approval, mix sides or versions, substitute presentation/clean/generated media, or label the 1350×1858 derivatives as raw masters.

A content hash proves byte consistency with the supplied reference. It does not independently prove that the exporting party is trusted or that a photographed physical card is authentic. Export authority and reference provenance remain separate requirements.

The saved defect masks describe reviewed findings in the reference coordinate system. They do not demonstrate that those features remain visible through a slab, under a phone camera, or at the reference resolution. Small defects may be below useful resolution. Centering and printed layout can help alignment but may be shared by other copies of the same card. New damage can occur to the same physical card; glare, dust, slab scratches, and occlusion can resemble or hide damage. A missing visible match cannot automatically mean counterfeit.

## Isolation design and enforcement gates

If feasibility warrants implementation, use a separate application/service and separately owned storage, queue, workers, resource limits, deployment, credentials, and spending budget. For the first experiment, use only local files with networking disabled; no service or queue is needed.

- No runtime or build dependency on grading, intake, report readers, grading DB schemas, or their internal packages. Do not import their clients, configuration, environment loaders, workers, inference wrappers, or credential providers. Concepts may be independently implemented; reviewed data may be copied once into an isolated reference package.
- No shared production database, bucket credentials, queue, worker pool, connection pool, native process, GPU allocation, deployment, or spending limit. Do not send new captures to grading or enroll them into its learning/memory pipeline.
- An eventual service must have an explicit egress allowlist that excludes grading/internal endpoints and metadata/credential endpoints, with no grading secrets in its environment, image, mounted files, or logs. Its own upload/retention/access policy needs separate review before real captures are retained.
- Decode untrusted input in a separately bounded process with pinned dependencies, byte/pixel/time/memory limits, and no network. Any timeout, missing artifact, decoder error, or cancellation ends in an unavailable/inconclusive result, never an automatic match or an unbounded retry.
- A future report entry point is a separately reviewed optional link to the separate application. It must not add report-side inference, acquisition, prefetch, credentials, or a required script/service response. If opened in a new tab, isolate the opener. The report must remain usable when that link's destination is absent.

Before any integration, prove dependency closure and environment isolation, and exercise absent/unreachable/slow/overloaded Fingerprint cases while verifying the unchanged grading/report behavior. Resource limits must demonstrate independent failure and load, not merely rely on different route names. No shared grading configuration change is an acceptable shortcut.

## Smallest offline feasibility sequence

1. **Specify the source manifest and offline importer first.** Define an allowlisted schema for reference identity/version, exact artifact paths, hashes, byte counts, dimensions, coordinate systems, provenance availability, and package/recipe versions. Use relative regular-file paths only, no URLs, executable content, symlinks, or path traversal. Keep reference data separate from candidate photographs. Explicitly identify these as copied approved derivatives.
2. **Qualify import without a matcher.** A next, separately scoped task can verify a fixture package entirely offline, reject mixed approval/image/trace bindings, tampered bytes, unknown fields, missing sides, malformed geometry, and oversized inputs, and prove no network/env/DB/runtime action occurs on import. Missing reference information must be reported rather than invented. No production package is fetched by these tests.
3. **Collect or supply an authorized research dataset.** Use manually labeled, independently supplied photographs with physical-card/session ground truth. Establish whether reference features are actually observable through representative slabs before choosing an algorithm or promising a product result.
4. **Only then build a bounded comparison experiment.** Start with manual card/region alignment and explicitly visible regions. Record alignment quality, visibility, glare/blur/occlusion, and per-region agreement/disagreement. Independently implement any geometric transforms in the isolated tool. Keep transformed diagnostic images separate from immutable original inputs. Do not run grading, generate replacement details, or infer ownership.
5. **Evaluate held-out data before exposing a decision.** Freeze preprocessing/recipe and thresholds before the held-out run. Record all abstentions and failures. Do not derive an authenticity percentage from an uncalibrated similarity score.

No matcher is justified merely because the existing Fingerprint graphic is deterministic. The immediate next useful artifact is the manifest/import qualification; the decision to implement comparison depends on observable reference evidence and dataset feasibility.

## Result semantics

| Result | Permitted meaning |
| --- | --- |
| `RETAKE` | The comparison lacks usable visibility/alignment/coverage or the capture is blurred, glared, occluded, or too small. Give specific capture guidance; do not count this as a match or mismatch. |
| `REVIEW` | Sufficiently visible evidence appears inconsistent, conflicting, or ambiguous, or the available reference is inadequate for a confident comparison. Human review may be appropriate; this is not a counterfeit finding. |
| `CONSISTENT_WITH_VISIBLE_SAVED_EVIDENCE` | Only after validation: the observable regions agree within the qualified method's limits. State which regions were observable and any missing evidence. This does not authenticate the card, NFC chip, holder, ownership, or grade. |
| `UNAVAILABLE` / unknown | Missing reference, decoder/processing failure, timeout, cancellation, unsupported input, or service unavailability. Preserve the saved report and allow normal report use; never convert unknown into success. |

Cards with no recorded defects, unavailable traces, or insufficiently discriminative visible features may remain inconclusive indefinitely. The interface must make that a normal outcome rather than force a binary decision.

## Dataset and acceptance gates

The dataset must include the exact same physical card captured in separate sessions and different physical copies of the same edition/parallel, especially copies with similar centering and surface appearance. Include both front and back, pristine/low-defect cards, varied defect sizes, and cases where a defect is absent from or unresolved in the saved derivative.

For each physical card, cover representative phones/lenses, native still versus delivered camera frame, distances, focus, orientations, operators, lighting, glare angles, and slab types/conditions. Include slab scratches, dust, fingerprints, occlusion, reflections, and changes in card condition. Full-card context and targeted close-ups should be separate observations; a tight close-up alone may not establish the correct side or card.

Include adversarial negatives using printed reference photographs, screens displaying reference images, other copies, and mismatched approval versions/sides. A report URL or copied graphic is not a liveness challenge. Anti-replay resistance remains unqualified unless explicitly tested; no such mechanism currently exists in the audited Fingerprint code.

Separate development and held-out evaluation by physical card, then hold out capture sessions and representative phones/operators. Do not split near-duplicate photographs of one card across training and evaluation. Record physical ground truth, exact reference package/hash, capture metadata, visible regions, and reason for every excluded/unknown result.

Measure false-consistent results on different copies and replays, false-discrepancy results on the same card, retake/unavailable rate, observable-region coverage, and processing/resource limits, with denominators and uncertainty. Choose acceptable limits before the held-out evaluation; this audit supplies no validated thresholds, sample-size guarantee, or success claim.

Progress requires evidence that the copied references expose repeatable and discriminative features, that results generalize beyond the development cards/phones, and that isolation/failure/load tests pass. If those gates fail, retain the experiment as an offline study or stop it; the working grading/report system remains unchanged.
