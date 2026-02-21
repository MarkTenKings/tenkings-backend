# AGENTS.md

## Handoff Policy (Mandatory)

At session start:
1. Read `docs/HANDOFF_SET_OPS.md`.
2. Read the latest entries in `docs/handoffs/SESSION_LOG.md`.

During work:
1. After every code-change batch (commit-worthy edit), update:
   - `docs/HANDOFF_SET_OPS.md`
   - `docs/handoffs/SESSION_LOG.md`
2. Before running deploy/restart/migration commands, update handoff files first.

Before final response:
1. Update both handoff files with latest status.
2. Include commit SHA(s), environment actions, and exact next steps.
3. Explicitly state in final response that handoff files were updated.

## Working Rules For This Repo

1. Do not delete production data without a dry-run impact preview and explicit user confirmation.
2. Prefer archive over hard delete unless user explicitly asks to hard delete.
3. Treat `/admin/variant-ref-qa` regressions as high priority.
4. Keep set/parallel normalization compatible with legacy dirty values (`&#038;`, `&amp;`, JSON-like parallel labels).
