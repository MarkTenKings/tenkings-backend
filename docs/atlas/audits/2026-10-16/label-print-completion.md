# Sports and Pokémon label recovery

Status: locally implemented and qualified; not yet released. Physical printer/material qualification remains open.

## Observed problem

The supplied V4 assets match the vendored design, including 68.342 × 20.082 mm outer dimensions and the 10.2 mm NFC opening. Pokémon artwork already exists. Fresh authenticated production inspection found Sylveon ex and Articuno stuck in NEEDS_LAYOUT because their complete approved metadata cannot fit the single-line minimum. The old localhost Pokémon tab is a synthetic component fixture, not a production sheet.

The ordinary Sports download path was verified using the existing Jaxson Dart approval. Its PNG is 6458 × 1898 pixels at 2400 ppi, with binary alpha and no colored pixels. Transparent artwork exposes the foil; the print file also includes opaque white metadata and dark-gray detail. Gold and holographic colors are preview simulations. SHA256: `5e8a8d871138ebdcba278c6a4d29192a78d6d54cb4351610cf20cde076dfbcc8`.

## Change

The renderer retains its original layout whenever it fits. Otherwise, bounded semantic wrapping preserves all approved identity fields in up to three metadata lines, with minimum 1 mm metadata and 2.8 mm title ink heights. Both observed Pokémon identities fit with 1.316457 mm metadata. Physical cuts, static artwork, grade typography and existing short-label SVG bytes are unchanged. Saved READY artwork remains immutable; replacements copy its exact bytes.

An explicit staff layout retry creates a linked LAYOUT_RETRY successor for an eligible failed, unprinted label. It binds the exact failed source and current renderer/material/jig, retains the predecessor and approval, and reuses the normal worker/allocation flow. Same-request retries return the accepted generation; conflicting requests, changed source/access and duplicate successors are refused. The browser preserves uncertain requests and clears only named definitive refusals. History distinguishes a retried layout from a changed approval. NFC includes recovered current-card labels while continuing to exclude replacement duplicates.

Standalone migration007 changes purpose constraints, adds a unique successor index and insert guard, and preserves source/artwork immutability. It adds no table, column, business-data rewrite or new privilege. The updated runtime requires007 before startup. New exports use current profiles; old saved exports and READY items are not regenerated.

## Evidence and limits

- Node22 production staff build and dependency boundary passed.
- Node22 frontend client/component/NFC suite:48/48 passed.
- Renderer suite:17/17 passed, including existing SVG hashes, full source retention, composed/decomposed text, bounds, cut/ink-mask overlap and bounded128-token behavior.
- Combined Node22 renderer/backend/transport/schema/runtime checks:69/69 passed; final runtime checks10/10 passed.
- Disposable PostgreSQL17:15 label groups and8 schema006 compatibility groups passed, including concurrent retries, revoked access, changed approvals and retained print/reprint invariants.
- Reciprocal independent reviews found no remaining actionable issue after corrections.
- Actual Chrome inspected both Pokémon recoveries, correct Holographic sheet allocation, full identity, unchanged illustrative8.5grade, retained predecessor history and print-ink mode against the real component and an explicitly synthetic local service. This is not live recovery acceptance.

Private evidence: `~/.codex/atlas-handoffs/atlas-labels-20261016/`, including `foil-audit/LAYOUT_RETRY_HANDOFF.txt`, `pipeline-audit/RECOVERY_REVIEW.md`, `browser/`, `frontend-node22-tests.txt`, `staff-build.txt` and `live/`. Proof labels use illustrative certificates and must not substitute for actual approved downloads.

The owner confirms the same eufyMake E1, metal blanks and 310 × 400 mm,50-position jig. The software still labels the sheet export diagnostic: actual scale, printer origin, white-ink behavior, material adhesion and fine-detail legibility require physical evidence. No physical print or print-success record was created.

## Separate grading investigation

The owner requested an investigation of integer final rounding only, leaving precise scores, measurements, bands and weights untouched. That read-only audit is saved in `whole-grade-rounding-audit.txt`. No scoring policy or approved grade changes are part of this label candidate, and no new half-grade styling was adopted.

## Release requirements

Preserve the now-live c41f0ebd sold-photo repair and its documentation-only successor. Prepare fresh native,007/control and web publication plans from current evidence. Never replay prior consumed release intents. Qualify the exact native candidate, apply007 before new main startup, publish compatible staff/public bindings, then verify ordinary authenticated retry and downloads for the two existing failed Pokémon items. These actions must retain their approved grades and report identities; no reapproval or provider request is required.
