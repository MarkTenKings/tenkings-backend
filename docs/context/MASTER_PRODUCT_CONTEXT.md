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
- Increase AI Grader capture throughput without replacing the PR #79 workflow: close-enough geometry, normalized crop/deskew, front processing during flip, guarded rapid capture, Confirm Card OCR prefill, and honest Dell timing proof.
- Keep `full_forensic` as the safety fallback. A faster profile may change lossless encoding/processing but must preserve dark, all-on, accepted-profile, and channels `1-8` per side until supervised evidence proves another change safe.
- Do not claim five seconds per side from software/mock timing. The last supervised Dell control measured about `9442 ms` front and `9243 ms` back; image writes were the largest measured stage. A new hardware comparison requires Mark's explicit approval.
- Stabilize prod `/admin/variant-ref-qa` behavior and counts
- Ensure set/parallel label normalization is correct
- Ensure player-linked reference metadata is persisted and exposed
- Productize manual QA/approval workflows for imported datasets
- Add production UI support for safe set delete/archive operations
