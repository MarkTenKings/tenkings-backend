# Card Map Atomic Dual-Create Shared Contract

Date: 2026-08-11
Owner correction: Mark Thomas
Base: `610192cc0a987aeb05849d58bcbd725e82933373`

## Authoring command

One completed human authoring action accepts one exact source identity, one immutable source-evidence/provenance bundle, and one Front/Back geometry body. The server derives both keys and creates both results:

1. `FAMILY`: Pokemon = category + year + product/set + parallel; Sports = category + year + manufacturer + product/set + insert + parallel.
2. `EXACT`: the existing legacy exact key, including source card/player name and card number.

The client does not choose a creation scope. Both revisions receive the same initial human-authored Front/Back geometry and retain complete exact source imagery, identity, hashes, session, author, and provenance. Family and exact are separate complete revisions and never merge.

## Atomic persistence

- Create or locate both map records and append both immutable revisions inside one database transaction.
- Compute both revision hashes on the server from the exact immutable content that will be persisted.
- Verify the exact persisted content against those hashes before moving either current-revision pointer.
- Move both current pointers only after both revisions exist and verify.
- Any failure rolls back both revisions, both map creations, and both pointer changes.
- Preserve every legacy exact/family map and hash. Do not rewrite existing rows.
- Restore remains append-only and creates new immutable revisions.

## Canonical hashing

- There is one server-owned canonical hash-payload builder and one deterministic canonical serializer.
- Client field order and client-computed fingerprints are never revision authority.
- Canonical handling is explicit for field order, dates/strings, null versus omitted fields, normalized/raw identity, scope/key discriminator, provenance, image keys/hashes, Front/Back, zone order, and polygon vertex order.
- FAMILY and EXACT hashes are independently deterministic and distinct because their immutable key identities differ.
- Hash failures return a stable operator-safe code and bounded field/path diagnostics without credentials, signed URLs, private storage details, or image bytes.

## Runtime lookup and registration

- Resolve `EXACT -> FAMILY -> ordinary human review`.
- Return at most one complete map. Never merge geometry.
- A malformed or hash-invalid exact candidate does not guess, select an unrelated map, or retry a lower scope.
- Registration is all-or-none across Front and Back. Failure applies neither side, stores no binding, and continues ordinary human review where the approved runtime permits.
- Each new copy keeps its own physical-card quad. Saved anchors register the printed-design transform; the resulting transform positions the saved boundary and zones.

## Draft recovery

- Draft format is versioned JSON with exact source identity, both derived identities, stable source evidence keys/hashes (never signed URLs), Front/Back boundaries, four anchors per side, ordered zones, zone IDs/names/semantic types, ordered polygon vertices, and coordinate-space metadata.
- Export and import round-trip every field exactly after normalization.
- Import validates before replacing editor state and never submits or activates automatically.
- API failure leaves the current React draft intact and exposes Retry plus Export Draft.
- UI shows whether the current normalized draft has been exported/recoverably persisted.
- Mark's recovered Squirtle payload is the primary regression fixture and must import without redrawing.

## UI contract

- Remove FAMILY/EXACT creation radio controls.
- Explain that one save creates both the family map and exact source map, with category-aware identity text.
- Pre-submit summary shows family identity, exact identity, Front/Back readiness, zone counts, and recovery/export state.
- Primary action is `SAVE FAMILY + EXACT MAPS`.
- First-use state is neutral creation copy, not an error-like `NO FAMILY MAP` state.
- Success identifies both created revisions and their applicability.
- Failure preserves the draft and shows precise safe diagnostics, Retry, and Export Draft.

## Frozen boundaries

Do not change SAM, detector thresholds, Memory thresholds/bank, grading formulas, identity authority, source images, physical-card geometry, completed cards/grades/labels/reports, or unrelated workflows. Detector and Memory still run first; raw evidence remains; Smart Marks remain. Zone-semantics separation and Auto-Build Zones follow the save-path repair and must not silently change current filter authority. The 50-card zero-write calibration replay remains required before claiming filter safety.
