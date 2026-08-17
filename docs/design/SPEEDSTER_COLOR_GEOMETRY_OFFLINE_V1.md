# Speedster Color Geometry Proposer V1

Status: owner-directed implementation of live `PROPOSER_ONLY` authority, currently undeployed and under review. The thresholds and preserved-pair outcomes below remain offline estimates, not live-calibrated Production policy. No deployment, Production migration, map change, detector threshold change, or Production activation is authorized until the owner gives a separate explicit Phase 2 deploy approval.

## Authority boundary

Color geometry is `PROPOSER_ONLY`. It can place the first draggable draft for:

- `PHYSICAL_OUTER`: the physical card cut against the operator-selected mat.
- `PRINTED_FRAME`: a four-sided printed frame inside the human-confirmed rectified card.

Every draft still stops in the existing `GeometryAssist` or `CenteringAssist` for mandatory human confirmation/correction. There is no automatic accept authority and no `AUTOMATIC_COLOR_FRAME` mode. `INSUFFICIENT_EVIDENCE`, `NOT_APPLICABLE`, and `ABSTAIN` preserve the existing manual proposal/workflow.

Color output is excluded from Card Map registration, registration lessons, zone projection, and filtering. An accepted `PRINTED_FRAME` result may seed only the existing centering draft. Card Map registration remains independently derived from the human-confirmed physical quad and immutable map evidence.

## One-side recapture boundary

A physical-mat advisory never silently restarts the pair. Targeted one-side recapture becomes available only after both sides have completed preparation and map registration, when the system has complete sibling evidence to preserve. Before that point the advisory remains factual and visible but the recapture action remains unavailable.

The targeted rerun uploads, proposes, prepares, and registers only the selected side. The sibling's original source, confirmed physical quad, prepared artifacts, physical and printed receipts, and map registration stay unchanged. A Back-side rerun also retains completed Front centering. Target registration failure uses the existing explicit retry/rescue/continue choice; it does not invalidate the sibling.

Targeted recapture is local-upload-only. Browser iPhone activation and polling are disabled while it is active. Normal iPhone Shortcut PLANs use pair-versioned object keys, and the admin ready-pair lookup reads the exact ready version. Complete legacy fixed-key pairs remain readable for rolling compatibility and are explicitly disclosed to the operator; a partial legacy or versioned pair fails visibly rather than mixing generations. Poll failures preserve existing photos and operator work, remain visible, and retry only the read-only status check. Source authorization remains exact-user, exact-session, exact-side, and exact-version.

## Workstation inputs

- Human selects the actual mat independently for Front and Back: `BLACK`, `WHITE`, or saturated `MAGENTA`.
- Offline suggested defaults are Front black and Back white. They are never recorded as operator selections until the operator explicitly confirms them. Magenta is the high-chroma fallback when both neutral mats are weak.
- Use stable diffuse lighting and keep the entire card separated from the photo frame on all four sides.
- A selected-mat/perimeter mismatch returns `ABSTAIN`.
- A selected-mat physical proposal must prove photographed-mat ownership outside and non-mat card material inside all four edges. A color-owned rectangle below `0.50` source-frame area returns `ABSTAIN` because a card border matching the mat can otherwise make an inner printed rectangle appear to be the outer cut. This is a proposer-only, fail-closed offline capture-envelope estimate; small or strongly angled captures fall back to manual handles.
- A dark edge on a black mat returns `ABSTAIN` with `Switch to WHITE`, even when chroma creates a large total Delta-E. This conservative guard stays until owner-approved live calibration exists.

## Deterministic evidence policy

Engine version: `speedster-color-geometry-v1`.

Policy provenance: `OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED`.

Offline-estimate floors:

- `PHYSICAL_OUTER`: Delta-E 18, 0.70 minimum selected-mat-outside/card-inside support on every side, and `0.50` minimum source-frame coverage.
- `PRINTED_FRAME`: Delta-E 12 and 0.55 minimum support on every side.

No result is `ACCEPTED` unless all four sides meet the relevant floor and no ambiguity guard fires. Outcomes are exactly:

- `ACCEPTED`: four-side proposal is available for mandatory human confirmation.
- `INSUFFICIENT_EVIDENCE`: some evidence exists but it is incomplete/weak; manual behavior remains.
- `NOT_APPLICABLE`: no credible four-sided printed frame, including full-art-like cases; manual behavior remains.
- `ABSTAIN`: mat mismatch, dark-on-black, or competing-boundary ambiguity; operator receives an explicit advisory.

Foil, gold borders, and reverse-holo sheen can reduce stability or create competing transitions. The engine abstains when four-side support/ambiguity policy is not satisfied. It does not guess from card content.

## Immutable provenance and score

The server, not the browser, issues an HMAC receipt for each mode. A receipt binds:

- operator/admin ID and session ID;
- Front/Back and mode;
- source object key and server-computed source SHA-256;
- selected mat;
- the canonical proposal/diagnostics hash;
- for `PRINTED_FRAME`, the exact human-confirmed physical quad used for rectification.

Capture persistence verifies both receipts and writes four append-only rows (Front/Back x physical/printed) in the same transaction as the DRAFT-to-CAPTURED transition. A database trigger rejects update/delete. Existing and completed sessions are not backfilled or rewritten.

Receipt validation verifies signature and binding before classifying expiry. An expired receipt produces a visible exact-side, exact-mode error and preserves every completed sibling and nonexpired mode. The required recovery is an explicit targeted rerun and reconfirmation of only that side and mode; there is no silent recomputation or whole-card discard. Persisting that targeted recovery across crash/reload is a Phase 1 versioned-draft dependency and must be integrated on the frozen Phase 1 head before the Phase 2 gate.

The admin score separately reports proposal-vs-human agreement (`accepted unchanged / accepted proposals`), overall first-draft yield (`accepted unchanged / all results`), proposal coverage (`accepted proposals / all results`), corrected accepted drafts, manual fallbacks, all four outcome counts, side/mat agreement and coverage with their exact denominators, and recent per-card drilldown.

## Approval boundary and risks

The live proposer implementation must remain undeployed and inactive until the owner reviews preserved-image results, live mat/lighting trials, false-accept/abstention rates, database migration dry-run evidence, and independent diff audits, then gives a separate explicit Phase 2 deploy approval. Thresholds must not be described as calibrated.

If a later owner approval authorizes activation, preserve a backend-first rolling release: the new service accepts the previous web client's missing `matColor` and returns the unchanged legacy physical/centering proposals without color evidence. The additive migration and dedicated web receipt secret must be ready before the reviewed web client, and that web client may activate only after the compatible service is healthy. The new web fails closed if a color proposal/receipt is absent or unverifiable.

The score endpoint keeps exact lifetime totals through bounded database aggregation and loads evidence only for the 20 most recent sessions selected by their latest evidence timestamp. It does not materialize all operator evidence rows in the application process.

The SHA-pinned preserved Squirtle/Bulbasaur offline replay is recorded in `docs/handoffs/artifacts/2026-08-13-color-geometry-preserved-pair-offline-estimate.json`. Both bordered Fronts produced four-side-supported `ACCEPTED` proposer drafts in the fixed outer 1-6 mm print-field band; maximum corner distance from the prior robust offline research detector was 7.4501 px for Squirtle and 11.7139 px for Bulbasaur. This comparison is an offline estimate and does not replace mandatory human correction or establish live calibration.
