# Catalog Ops Execution Pack

Last updated: 2026-02-26
Owner: Mark + Codex

## Purpose
This pack is the implementation blueprint for Workstation 2 redesign + Taxonomy V2 integration.
It is written so any Codex agent can execute with low ambiguity.

## Scope
- Workstation 2 surfaces:
  - Set Ops
  - Set Ops Review
  - Variants
  - Variant Ref QA
  - AI Ops
- New workstation IA:
  - Overview
  - Ingest & Draft
  - Variant Studio
  - AI Quality
- Taxonomy V2 foundations:
  - Card Type/Program
  - Variation
  - Parallel
  - Scope/Odds

## Read Order (Required)
1. `STRATEGIC_CONTRACT.md`
2. `SYSTEM_CONTRACT.md`
3. `BUILD_CONTRACT.md`
4. `UX_CONTRACT.md`
5. `QUALITY_AND_OPS_CONTRACT.md`
6. `AGENT_KICKOFF_CHECKLIST.md`
7. `MASTER_PLAN_V2_COMPLETE.md`
8. `WORKSTATION2_REDESIGN_SPEC.md`

## Hard Rules
- Keep legacy routes functional until cutover gates pass.
- No destructive data migration without explicit approval and rollback path.
- Use feature flags for every major phase.
- Validate parity before switching any consumer to Taxonomy V2-first reads.

## Related Core Docs
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`
- `AGENTS.md`
