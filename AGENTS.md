# AGENTS.md

## Mandatory Agent Process

At session start, read these files first:
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

Approved V2 blueprint rule:
- `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md` is Mark's owner-approved product and architecture authority for the future Ten Kings V2 card platform
- Every agent must read it in full before beginning work
- Code/runtime/DB evidence remains the authority for what is currently implemented or deployed
- Do not silently change or expand the approved blueprint; owner-approved corrections must update the canonical file and the handoff record

Conflict rule:
- If docs conflict with code/runtime/DB evidence, trust evidence
- Then update docs in the same session before final handoff

Update rule:
- After every commit-worthy code change, append to `docs/handoffs/SESSION_LOG.md`
- Before deploy/restart/migration, append planned action to `docs/handoffs/SESSION_LOG.md`
- After deploy/restart/migration, append observed result with evidence

Safety rule:
- Do not run destructive data operations without explicit user approval
- Require dry-run impact + typed confirmation for destructive set operations
