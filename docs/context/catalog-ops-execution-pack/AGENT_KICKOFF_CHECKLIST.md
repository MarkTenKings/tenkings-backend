# Agent Kickoff Checklist

Use this at the start of any Catalog Ops or Taxonomy V2 coding session.

## Preflight
1. Read `AGENTS.md` and required startup docs.
2. Read `docs/context/catalog-ops-execution-pack/README.md` and all contract files in order.
3. Confirm branch and working tree status.
4. Confirm feature flags targeted for this session.

## Session Plan
1. State phase and ticket IDs being implemented.
2. List files expected to change.
3. List explicit non-goals for this session.

## During Build
1. Keep legacy routes operational.
2. Avoid destructive data operations.
3. Write migration code additively.
4. Preserve API compatibility unless ticket explicitly changes contract.

## Validation
1. Run targeted lint/type checks for changed files.
2. Execute ticket-level manual checks.
3. Capture parity evidence if touching dual-read paths.

## Handoff Discipline
1. Append session notes to `docs/handoffs/SESSION_LOG.md`.
2. Update `docs/HANDOFF_SET_OPS.md` for any architecture/runtime-relevant changes.
3. If deploy/restart/migration happens, log pre/post evidence with commands and outputs.

## Exit Gate
Only mark session complete when:
1. Acceptance checks pass for targeted tickets.
2. Rollback path is known.
3. Handoff docs are updated.
