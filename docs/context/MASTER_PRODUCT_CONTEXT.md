# Ten Kings Master Product Context

last_verified_at: 2026-07-18
verified_by: Codex from protected-main evidence plus the Mathematical Calibration V1 implementation and offline validation branch
repo_root_workstation: C:\TenKings\repos\tenkings-rip-it-live
repo_root_droplet: /root/tenkings-backend
default_branch: main
active_feature_branch_example: chore/seed-timeout-hardening
prod_site: https://collect.tenkings.co

## Purpose
This file is stable product/system context.
It is not the source of truth for fast-changing commands or incident state.

## Source-of-Truth Policy
When there is a conflict, use this order:
1. Runtime evidence (live API behavior, running deploy identity)
2. DB query evidence
3. Current code in checked-out commit
4. Docs

If docs conflict with evidence, update docs in the same session.

## Product Summary
Ten Kings is a hybrid physical-digital collectibles platform with:
- Mystery packs and card-level QR identity (`tkp_...`, `tkc_...`)
- Web + kiosk live rip workflows
- Inventory, vault, shipping, and buyback/TKD loops
- Admin ops for packing, staging, kiosk sessions, and label resets

## Core Platform Architecture
Frontend/API:
- Next.js app in `frontend/nextjs-app`
- Next.js API routes for admin, kiosk, variants, refs, packing flows

Data:
- PostgreSQL (DigitalOcean)
- Prisma ORM and migrations (`packages/database/prisma`)

Infra:
- Vercel serves public/product frontend
- DigitalOcean droplet runs backend build/runtime stack
- SER mini-PC runs kiosk display and OBS integration

Media/Live:
- OBS + obs-websocket on SER
- Mux stream per location (`muxStreamId`, `muxStreamKey`, `muxPlaybackId`)
- Kiosk helper drives stage/OBS behavior

## AI Grader Production Architecture (Current Reality)

- The current Dell workflow is one operator sequence: **Start New Card**, **Capture Front**, flip and **Capture Back**, then one **Approve & Publish** authority.
- `/ai-grader/station` uses Basler/Leimac through the loopback-only token-gated bridge, exact frame identity, direct browser-to-storage asset upload, and atomic durable publication.
- Mathematical Calibration V1 is an explicit, fail-closed grading contract. It may be selected only when the bridge has verified one finalized physical-calibration bundle and the hosted readiness boundary has independently trusted that exact bundle. It never falls back to V0, a manual grade, another camera, or another image. Until the supervised physical calibration is accepted and independently reviewed, V1 remains unavailable rather than claiming calibrated measurements.
- A V1 session binds the exact card identity and a centering profile before capture. `printed_border_v1` measures a robustly fitted printed frame. `registered_design_template_v1` requires the exact approved, identity/version/hash-bound Ten Kings reference; arbitrary web imagery and normalized-frame symmetry are not reference authority.
- V1 finding review is disposition-only and bound to the exact review-request SHA-256. The operator sees hash-verified True View, all eight directional channels, ROI, segmentation, confidence, and illumination evidence and records `confirmed` or `adjusted`; the operator cannot author measurement confidence. This is evidence review inside report preparation, not a second publication confirmation. **Approve & Publish** remains the sole publication authority.
- Part 2 is `/ai-grader/finish` on a normal authenticated computer: comps review/selection, slab-photo direct upload, label/inventory gates, and inventory completion. It has no local bridge, station token, camera, lighting, or hardware controls.
- `/ai-grader/labels/sheets` manages the unchanged 16-slot Label V1 physical sheets. Publication must preserve exact report/card/label/inventory linkage.
- Public report routes are unauthenticated read-only views and must never expose Dell paths, bridge URLs/tokens, presigned URLs, embedded image bodies, credentials, or hardware controls.
- Large images use direct browser-to-storage PUTs; browser-to-Vercel request and response bodies remain small manifests/metadata. OCR, publication-asset, and slab-photo finalization require the exact planned object identity, byte size, content type, and SHA-256 before use: accept a valid provider-native checksum when present, otherwise let the server pull and hash the same stored object through one bounded stream. ETag, mutable metadata, filename, caller URL, and unbounded reads are never integrity authority, and downloaded verification bytes are never written to disk.
- Raw forensic capture evidence remains local and immutable. Derived normalized/crop/deskew assets supplement rather than replace the raw front/back evidence.
- Mathematical V1 scoring policy, formulas, uncertainty semantics, evidence contracts, and honest limitations are specified in `docs/specs/AI_GRADER_MATHEMATICAL_CALIBRATION_V1.md`. The executable threshold manifest in `packages/shared/src/aiGraderMathematicalCalibrationV1.ts` is the only coefficient, tolerance, and cap authority.

## AI Grader NFC identity architecture (deployed; required policy temporarily disabled)

- The additive NFC schema, hosted routes, attempt-token secret, one-key workstation allowlist, and programming policy are deployed in Production. `AI_GRADER_NFC_PROGRAMMING_ENABLED=true`, while `AI_GRADER_NFC_REQUIRED=false` is the current safe state after the 2026-07-18 browser-pairing bootstrap incident. Do not require NFC again until the reviewed browser/launcher correction and the separately controlled installed-workstation recovery are accepted.
- `static_url_v1` associates one server-generated `https://collect.tenkings.co/nfc/{publicTagId}` with the exact durable Published report, Confirm-authority CardAsset/Item, certificate, and AiGraderLabel. NTAG215 and FEIJU F8215 are registered convenience links, never cryptographic authentication. F8215 permanent consumer write protection does not make its static URL unclonable.
- Hosted status/init/complete require a human AI Grader operator or admin; revoke/replace require a human admin. Service identities and browser role claims cannot authorize programming. Report-lifecycle locks, independently challenged one-time attempts, immutable audit events, and revoke-before-replace remain server enforced.
- Activation requires a current allowlisted finishing-workstation ECDSA P-256 operational attestation over the exact attempt/linkage/readback statement. Legacy NTAG215 keeps its exact v1 direct-PC/SC attestation. F8215 uses additive v2 evidence for the exact profile, GoToTags version, full URL readback, and verified permanent read-only state. Raw tag UID is never accepted; only its SHA-256 fingerprint is persisted after verified readback.
- `/nfc/[publicTagId]` is production-DB-only and resolves only an active, exactly linked, still-public Published report. `/ai-grader/nfc` owns local programming. Finish only shows safe state and opens that route; it has no helper/hardware control.
- The separate .NET 8 Windows helper is loopback/production-Origin/token restricted and owns fixed ACR1552U PC/SC NTAG215 operations. It also contains the asynchronous F8215 adapter around exact GoToTags Desktop `4.37.0.1`: Ten Kings prepares one protected operation, the operator clicks GoToTags **Start Encoding** once, and the helper accepts only a terminal exact-URL/readback/lock result. It signs only complete reviewed evidence with the named current-user, non-exportable Windows CNG P-256 key. The helper is independent of the capture helper and never imports native NFC or GoToTags dependencies into Next/Vercel.
- `AI_GRADER_NFC_PROGRAMMING_ENABLED` and `AI_GRADER_NFC_REQUIRED` are the only NFC feature controls. Disabled programming still permits authenticated status and admin revocation but blocks init/complete/replace before helper contact. NTAG215 and F8215 remain explicit profiles; neither can fall back to the other. When NFC required is false, QR and current inventory behavior are unchanged; when true, Add To Inventory requires exact active NFC inside the locked server transaction.
- GoToTags does not provide a reviewed electronic pre-write blank-state proof. The initial F8215 release instead uses the product-owner-approved audited operational control `operator_fresh_inventory_confirmation_v1`: the operator takes exactly one unused tag from controlled inventory, keeps it off-reader until requested, and quarantines every failed, interrupted, uncertain, previously presented, written, or locked tag. Never describe this control as electronically verified blankness. The terminal callback proves only the final exact URL, readback, and permanent write-protection result.
- Authenticated NFC readiness includes only the redacted `nfcSchemaReady` boolean plus programming-policy/configuration booleans/count. An unapplied additive migration produces controlled unavailable behavior, including a no-store/noindex public HTTP 503; unexpected database failures remain distinct. With NFC-required false, unrelated Finish/report/Publish/inventory workflows do not query the NFC tables. With it true, missing or unverifiable NFC schema blocks inventory.
- The dedicated NFC helper has separate first-install and ordinary-update workflows. Ordinary update stages and verifies the replacement before stopping only the NFC helper, preserves protected token/pairing/CNG/task/shortcut identity, and restores the prior working install on failure. Intentional token/pairing rotation is an explicit maintenance action, never an update side effect.
- The future `NTAG424_DNA` / `ntag424_sun_v1` seam is type-only and unimplemented. No keys, SUN validation, counters, originality proof, or cryptographic success claim exists.
- Operational detail, official hardware references, installation, rollout order, and the exact hardware-approval gate are in `docs/ai-grader-nfc-helper.md`.

## Kiosk Lifecycle (Phase 1)
Stages:
- COUNTDOWN
- LIVE
- REVEAL
- COMPLETE/CANCELLED

Behavior:
- Pack QR starts session
- Countdown auto-advances to LIVE
- Card QR triggers reveal
- Reveal timer auto-completes and returns to attract loop
- LocalStorage/session recovery is supported

## Admin Operations
- Packing stage transitions including `LOADED`
- Active kiosk sessions control
- Pack label reset flow with reset-version semantics
- Variant ref QA tooling for set/card/parallel-level image validation

## Set Ops and Variant Ref System (Current Reality)
- Seeding builds variant/reference data from checklist/player-map sources
- Legacy `ALL` and `NULL` card-number behaviors require careful handling
- Dirty labels can come from encoded source data and JSON-like parallel payloads
- Player-level association for refs is critical for downstream matching quality

## Current Priorities
- Keep the station workflow at four actions: Start New Card, Capture Front, Capture Back, Approve & Publish. Start New Card and every Rapid continuation automatically apply the configured production positioning light through the bounded bridge path and become capture-ready only after exact controller acknowledgements.
- Keep one Basler/Pylon capture implementation, one bridge-owned watchdog, one capture lock, and one serialized hardware operation. Rapid Capture is a retained throughput queue: after the operator explicitly captures both sides, one serialized background worker completes diagnostics, the report bundle, final-grade calculation, finalized release, and final label-data preparation required by the unchanged downstream Label V1 authority while an independently acknowledged next-card session may begin. It never auto-approves, auto-publishes, or mutates inventory; it is not automatic capture or a fallback. There is no production cold/debug path, manual capture/geometry path, browser Safe Off system, or compatibility fallback.
- **Add To Inventory** remains the downstream Finish action after applicable NFC, slab-photo, valuation, and label requirements. It is outside the four grading actions and is not a safety mechanism or fallback.
- `Ready` means a fresh, confident, fully visible card-shaped region can be normalized safely. Camera-frame centering and in-plane rotation inside the `35°` normalization envelope are not direct capture blockers; the `10°` target remains a visual placement guide, while full visibility and the fixed-rig `30%-85%` expected-size envelope constrain extreme placement and include the existing 97%-height production guide. `Adjust Card` carries a safe actionable reason for clipped, low-confidence, wrong-aspect, unsafe-size/coverage, or beyond-envelope geometry. The dominant live overlay follows the estimated outer corners. Geometry cannot infer printed top versus bottom, so the operator keeps the printed top generally toward the preview top. Failed/low-confidence/stale detection remains `Not Detected` or `Adjust Card` and never reuses stale geometry.
- Grade ROIs use the fixed `1200x1680` normalized portrait coordinate frame derived from the authoritative full-resolution all-on geometry and reused across accepted-profile and channels `1-8`. Full-resolution processing requires at least a `1000x1400` source crop and no more than `1.2x` upscaling. Camera-frame placement is acquisition and evidence-quality data, never printed-design centering. Historical V0.2 retains its explicit missing-centering redistribution and cap for readability; a new V1 report instead requires measured front/back centering, corners, edges, and surface and applies the fixed four-element weights with no missing-element redistribution. Every original raw role remains immutable and hash-verified.
- Capture quality and card condition are separate in V1. Focus, clipping, exposure, darkness, common-mode/specular glare, and directional coverage select or exclude evidence, lower confidence, or require recapture; they never deduct physical-condition points or add sharpness points. Surface candidates are measured only on valid pixels after flat-field correction and common-mode removal. Calibrated illumination-pattern or glare overlap is shown as a limitation mask with zero card deduction, while supported directional defects remain measurable from alternate channels. Fully obscured evidence is insufficient, never a false 10.
- Approximate Leimac direction vectors are transformed by the same authoritative deskew into normalized card coordinates. Missing or incoherent transform provenance suppresses directional normal/relief output; raw dark controls are not mixed with normalized pixels without registered coordinate and dimension parity.
- Public defect findings produced by the normalized path use canonical `1200x1680` card pixels as their only projection source, convert once to bounded normalized fractions, and bind to the exact raw-source and normalized-artifact hashes. They must not be inverse-rotated through raw/display coordinates a second time. Legacy source-display projection is retained only for older non-normalized evidence; findings remain side-scoped and absent when candidates or coherent geometry are absent.
- Failed or stale geometry remains unavailable. No manual geometry or fixture rectangle may substitute for automatic detection.
- Do not claim five seconds per side from software/mock timing. The last supervised Dell control measured about `9442 ms` front and `9243 ms` back; image writes were the largest measured stage. A new hardware comparison requires Mark's explicit approval.
- Stabilize prod `/admin/variant-ref-qa` behavior and counts
- Ensure set/parallel label normalization is correct
- Ensure player-linked reference metadata is persisted and exposed
- Productize manual QA/approval workflows for imported datasets
- Add production UI support for safe set delete/archive operations
