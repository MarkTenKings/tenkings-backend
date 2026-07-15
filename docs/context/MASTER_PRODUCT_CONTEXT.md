# Ten Kings Master Product Context

last_verified_at: 2026-07-09
verified_by: Codex from current code, merged PR #79, and production handoff evidence
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

- PR #79 is merged and live. Preserve its two-person workflow and existing production auth/storage architecture.
- Part 1 is `/ai-grader/station` on the Dell: Basler/Leimac capture through the loopback-only token-gated bridge, provisional grade/report review, human Confirm Card, direct browser-to-storage publication, and the next grade.
- Part 2 is `/ai-grader/finish` on a normal authenticated computer: comps review/selection, slab-photo direct upload, label/inventory gates, and inventory completion. It has no local bridge, station token, camera, lighting, or hardware controls.
- `/ai-grader/labels/sheets` manages 16-slot physical label sheets. Rapid capture must feed the existing Confirm/Publish/label/comps/slab/inventory pipeline; it must not bypass it.
- Public report routes are unauthenticated read-only views and must never expose Dell paths, bridge URLs/tokens, presigned URLs, embedded image bodies, credentials, or hardware controls.
- Large images use direct browser-to-storage PUTs. Vercel receives only small manifests/metadata.
- Raw forensic capture evidence remains local and immutable. Derived normalized/crop/deskew assets supplement rather than replace the raw front/back evidence.

## AI Grader NFC identity architecture (software-ready, not deployed)

- `static_url_v1` associates one server-generated `https://collect.tenkings.co/nfc/{publicTagId}` with the exact durable Published report, Confirm-authority CardAsset/Item, certificate, and AiGraderLabel. NTAG215 is a registered convenience link, never cryptographic authentication.
- Hosted status/init/complete require a human AI Grader operator or admin; revoke/replace require a human admin. Service identities and browser role claims cannot authorize programming. Report-lifecycle locks, independently challenged one-time attempts, immutable audit events, and revoke-before-replace remain server enforced.
- Activation requires a current allowlisted finishing-workstation ECDSA P-256 operational attestation over the exact attempt/linkage/readback statement. This proves only that the approved helper reported PC/SC full readback; it does not make NTAG215, the card, or the slab cryptographically authentic. Raw tag UID is never accepted; only its SHA-256 fingerprint is persisted after verified readback.
- `/nfc/[publicTagId]` is production-DB-only and resolves only an active, exactly linked, still-public Published report. `/ai-grader/nfc` owns local programming. Finish only shows safe state and opens that route; it has no helper/hardware control.
- The separate .NET 8 Windows helper is loopback/production-Origin/token restricted and owns fixed ACR1552U PC/SC NTAG215 operations. It signs only exact successful readback with a named current-user, non-exportable Windows CNG P-256 key. The helper is independent of the capture helper and never imports native NFC libraries into Next/Vercel.
- `AI_GRADER_NFC_PROGRAMMING_ENABLED` and `AI_GRADER_NFC_REQUIRED` independently default false. Disabled programming still permits authenticated status and admin revocation but blocks init/complete/replace before helper contact. When inventory policy is false, QR and current inventory behavior are unchanged; when true, Add To Inventory requires exact active NFC inside the locked server transaction. Do not enable either control until its separately documented migration, secret, tenant public-key allowlist, hosted deploy, helper install, and sacrificial-tag prerequisites are approved.
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
- Increase AI Grader capture throughput without replacing the PR #79 workflow: normalization-safe solid-plate geometry, canonical crop/deskew, front processing during flip, guarded rapid capture, Confirm Card OCR prefill, and honest Dell timing proof.
- Keep `full_forensic` and `production_fast` as explicit selectable profiles. `full_forensic` is the previous stable/default selection until supervised Dell A/B evidence proves a later default change; it is never an automatic fallback. `production_fast` remains opt-in and must preserve dark, all-on, accepted-profile, and channels `1-8` per side.
- A warm-runner failure is terminal for that capture attempt: safe-off, release ownership/locks, show the exact error, and require operator retry. The cold command path is developer/debug-only when explicitly configured before the session and cannot count toward production-fast timing acceptance.
- `Ready` means a fresh, confident, fully visible card-shaped region can be normalized safely. Camera-frame centering and in-plane rotation inside the `35°` normalization envelope are not direct capture blockers; the `10°` target remains a visual placement guide, while full visibility and the fixed-rig `30%-85%` expected-size envelope constrain extreme placement and include the existing 97%-height production guide. `Adjust Card` carries a safe actionable reason for clipped, low-confidence, wrong-aspect, unsafe-size/coverage, or beyond-envelope geometry. The dominant live overlay follows the estimated outer corners. Geometry cannot infer printed top versus bottom, so the operator keeps the printed top generally toward the preview top. Failed/low-confidence/stale detection remains `Not Detected` or `Adjust Card` and never reuses stale geometry.
- Grade ROIs use the fixed `1200x1680` normalized portrait coordinate frame derived from the authoritative full-resolution all-on geometry and reused across accepted-profile and channels `1-8`. Full-resolution processing requires at least a `1000x1400` source crop and no more than `1.2x` upscaling. Camera-frame placement is retained only as acquisition diagnostics and excluded from grade inputs. Printed-design centering remains uncomputed; normalized Grade Story V0.2 redistributes only its missing weight across computed corner/edge/surface diagnostics, applies an explicit confidence penalty, and caps the provisional result at `9.0`. Every original raw role remains immutable and is hash-verified.
- Approximate Leimac direction vectors are transformed by the same authoritative deskew into normalized card coordinates. Missing or incoherent transform provenance suppresses directional normal/relief output; raw dark controls are not mixed with normalized pixels without registered coordinate and dimension parity.
- Public defect findings produced by the normalized path use canonical `1200x1680` card pixels as their only projection source, convert once to bounded normalized fractions, and bind to the exact raw-source and normalized-artifact hashes. They must not be inverse-rotated through raw/display coordinates a second time. Legacy source-display projection is retained only for older non-normalized evidence; findings remain side-scoped and absent when candidates or coherent geometry are absent.
- Manual capture/geometry must be an explicit operator-confirmed action and persist `manual_capture` / `manual_override` with `detectionUsed=false`; a configured fixture boundary must never be substituted silently.
- Do not claim five seconds per side from software/mock timing. The last supervised Dell control measured about `9442 ms` front and `9243 ms` back; image writes were the largest measured stage. A new hardware comparison requires Mark's explicit approval.
- Stabilize prod `/admin/variant-ref-qa` behavior and counts
- Ensure set/parallel label normalization is correct
- Ensure player-linked reference metadata is persisted and exposed
- Productize manual QA/approval workflows for imported datasets
- Add production UI support for safe set delete/archive operations
