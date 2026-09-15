# Cost → sales channel intake — 2026-09-15

Mark authorizes removing Expected sale price from initial Add inventory, while retaining it for later saved-card editing after reviewing sold comps. Staff capture front/back photos, enter acquisition cost, press Next to see sales channels, then save. The continuous next-card camera flow remains.

1. Remove the initial price input, price progression step and premature profit preview. Update instructions and progress labels. Keep immediate Cost focus, concurrent upload/identification, validation and explicit save.
2. New add commands store expected price as unknown (`null`), including older unsent drafts. Preserve exact pending-command retries and existing expected-price editing, projections and research behavior. No schema, provider or financial changes.
3. Update the existing workspace regressions for one-step Cost → channel progression, focus during identification, save/reset, unknown price, older drafts/pending retries and later price editing. Run focused tests, scoped lint and the normal production build with migrations disabled; check the responsive UI with isolated fixtures if available.
4. Review against the owner amendment and Foundation Principles, record PASS and commit. Deploy only the current collect lineage, verify serving SHA/alias and read-only UI assets, and record results in SESSION_LOG.

Preflight: collect serves READY deployment `dpl_FfRCDPvgS2gotT3RkrLhq29nV4Bg`, a redeploy of application `a319904273d4b4e4e81d721b699d3a2990975eda` on `codex/staff-inventory-release-20260910`. Local `da649c8c` adds only its acceptance documentation. Preserve the unrelated untracked ATLAS reuse note. No live inventory writes are needed for this change.
