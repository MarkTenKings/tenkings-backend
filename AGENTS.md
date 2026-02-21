# AGENTS.md

## Mandatory Agent Process

At session start, read these files first:
- `docs/context/MASTER_PRODUCT_CONTEXT.md`
- `docs/runbooks/DEPLOY_RUNBOOK.md`
- `docs/runbooks/SET_OPS_RUNBOOK.md`
- `docs/HANDOFF_SET_OPS.md`
- `docs/handoffs/SESSION_LOG.md`

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
