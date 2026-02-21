# Ten Kings Master Product Context

last_verified_at: 2026-02-21
verified_by: Mark + Codex
repo_root_workstation: /home/mark/tenkings/ten-kings-mystery-packs-clean
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
- Stabilize prod `/admin/variant-ref-qa` behavior and counts
- Ensure set/parallel label normalization is correct
- Ensure player-linked reference metadata is persisted and exposed
- Productize manual QA/approval workflows for imported datasets
- Add production UI support for safe set delete/archive operations
