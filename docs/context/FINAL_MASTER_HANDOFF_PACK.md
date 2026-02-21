# Ten Kings Final Master Handoff Pack

Last updated: 2026-02-21
Owner: Mark

This file is the single-file handoff copy.
Operational source files remain:
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`
- `AGENTS.md`

## Source-of-Truth Precedence
1. Runtime evidence
2. DB query evidence
3. Current code
4. Docs

## Core Context
- Product: hybrid physical-digital collectibles platform.
- Critical system areas: kiosk live rip, admin packing/labels, variant ref QA, set seeding.
- Primary QA issue cluster: dirty labels, legacy `ALL/NULL` card behavior, inflated counts, incomplete player-link visibility.

## Branch + Commit Context
Working branch for this stream: `chore/seed-timeout-hardening`.
Important commits include:
- `8a14194`, `d096ce3`, `0e7fc5c`, `08a4ce2`, `cb42d9b`, `f6baadc`, `b1166dd`, `dc7b409`.

## Environment Paths
- Workstation: `/home/mark/tenkings/ten-kings-mystery-packs-clean`
- Droplet: `/root/tenkings-backend`
- Droplet infra: `/root/tenkings-backend/infra`

## Must-Run Checks Each Session
1. Verify git parity (workstation/droplet/origin).
2. Verify serving surface for `/admin/variant-ref-qa`.
3. Compare API payload vs DB truth for affected set rows.
4. Confirm player linkage fields for reference images.
5. Log evidence in `docs/handoffs/SESSION_LOG.md`.

## Command References
Use exact commands from:
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`

## Product Build Direction (Agreed)
Build Set Ops UI with:
- Ingestion queue (`parallel_db`, `player_worksheet`)
- Human review/edit + source link
- Approve gate
- Seed execution + progress monitor in UI
- Set archive/delete with dry-run impact + typed confirmation + audit log

## Agent Policy
Agents must follow `AGENTS.md`:
- read handoff docs first,
- update `SESSION_LOG.md` after commit-worthy changes,
- update before/after deploy/restart/migrate,
- no destructive data operations without explicit approval.
