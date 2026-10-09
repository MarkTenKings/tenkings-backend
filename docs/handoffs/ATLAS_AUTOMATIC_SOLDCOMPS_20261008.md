# ATLAS automatic sold comps — October 8, 2026

## Authorized scope and current status

The owner approved the investigation recommendation, requested three Astra Ultra subagents, and supplied eight PriceCharting screenshots as display references. Implementation is isolated on `codex/atlas-automatic-comps` in `/Users/markthomas/.codex/worktrees/atlas-automatic-comps/ten-kings-mystery-packs-clean`, based on `9a03d02a26898fd08dcf08ca151f5f8fb4af93dd`. The original stale, dirty workspace and its preexisting session-log conflict were preserved.

Source implementation and local qualification are complete pending final release checks. Production remains source `5ce5b067e9bc6e352f4a4a81310bcaab62eedf3a`, schema75. No automatic-comps release, paid search or backfill has run. Fresh Vercel provider reads returned403 `Not authorized`; a device sign-in was requested from the owner. Do not describe local fixtures as live acceptance.

## What changed

- Human approval atomically records a job bound to the exact approval, source and report hashes. A separate leased worker starts the shared SoldComps search; browser navigation or reload does not own the work.
- The worker retains the normalized provider response before building the preview. Storage/filtering recovery reuses those bytes. A lost paid-dispatch result stays explicitly unknown and is never blindly repurchased. Typed rate-limit refusals back off; retries are finite. Explicit processing recovery keeps the original preview and records an immutable recovery audit.
- Current authorized card readers can discover saved previews across sessions. Only current authorized reviewers can publish chosen references. Publication remains bound to the same approval and exact saved evidence; grading, photographs, findings and scores are unchanged.
- A read-only backfill plan identifies missing searches, retained results, revoked access and unknown outcomes. Exact-plan application queues missing approvals and only explicitly named legacy refreshes, preserving old previews. It is server-only maintenance, not an automatic scan of historical cards.
- The shared engine's opt-in `ATLAS_IDENTITY_V1` policy distinguishes unknown target variants from base cards. It handles Non-Holo negation, Black & White series context, Pokémon finishes/patterns, language/edition/stamps, sports colors/patterns/serial limits and autograph/memorabilia claims. Existing approved parallel text provides explicit target facts; absent facts remain uncertain. Existing Ten Kings default envelopes remain compatible.
- The adapter reuses the shared research title/sale checks, excludes explicit identity conflicts and lots, normalizes collector-number zero padding, and treats a missing Pokémon collector denominator as incomplete evidence. A different provided denominator remains a conflict. No target ATLAS-to-PSA grade conversion is invented.
- Staff and selected public sales use horizontally selectable exact grader/grade/designation and identity groups, newest-first dates, listing links and disclosed prices. Raw, Black Label, Pristine, Perfect and unspecified labels stay separate. Counts summarize returned observations; no invented valuation, accepted-offer amount, sales rate or history chart is shown.
- Existing staff identity fields explain how to record observed finish/language/edition/stamp or sports color/serial/autograph details. Machine suggestions are not silently adopted into approved reports.

## Qualification and evidence

External evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-automatic-comps-20261008`.

- Shared engine:38 Node22 test groups, including26 legacy compatibility groups.
- Provider/adapter/public contracts:27 focused Node22 tests after independent review, including exact legacy-preview selection, raw/special labels and negative evidence cases.
- Connected service first broad run:488passed,0failed,2native-only skips; those native checks require the actual candidate image before release.
- UI/client/report:179 focused Node22 tests and manual-workspace build/boundary check passed.
- Actual JSX/client browser fixture:1440/1024/390/320px, keyboard focus, no page overflow, automatic queue-to-ready reads, fresh-session discovery, uncertain-outcome free checks, empty results and lost-selection-response exact recovery. Sales are synthetic and the card photograph is an existing approved reference. See `display/result.json` and screenshots.
- Owned disposable PostgreSQL: full migrations/no-op and seven behavior groups passed, including15individual missing-grant startup refusals, approval dedupe, machine authority, global claims/leases, unknown dispatch, retained-response retry, exact legacy refresh and retirement. Three synthetic provider calls; zero paid calls or production writes. See `backend-postgres/result.json`; separate75-to76 release rehearsal is recorded under `schema/`.
- Fresh native build/qualification helpers have37 offline guard checks and preserve16 existing native artifacts and the locked dependency closure. Helpers alone are not an image qualification receipt.

## Release sequence still required

1. Freeze the final clean source and run the actual offline native image build/qualification; preserve existing native binaries and dependency versions.
2. Restore Vercel access, qualify source-exact staff/public candidates and actual configuration bindings. Retain the current customer commerce behavior/settings.
3. Review the fresh75-to76 additive schema/grant and runtime/control plan. Record planned actions before execution, fence and drain existing work, preserve customer/grading records, and apply only the qualified migration and narrow manual-role permissions.
4. Enable `ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED=true` on the qualified private runtime with dedicated `ATLAS_MANUAL_MARKET_CONCURRENCY` (default2). Concurrency is a resource limit, not a cap on approved cards. Verify exact live bindings and signed/anonymous reads before promotion.
5. Read/review the exact backfill impact, including legacy empty results affected by old filtering. Queue that reviewed plan, then inspect actual saved outcomes and grade groups without fabricating a human approval or automatically publishing uncertain references.
6. Record observed live results in the master context, deployment runbook, handoff and session log. Retain all receipts and original failures; do not replay consumed release intents.

The investigation, including live provider success with zero eligible previews and the limits of retained historical evidence, remains in `docs/handoffs/ATLAS_SOLDCOMPS_INVESTIGATION_20261008.md`.
