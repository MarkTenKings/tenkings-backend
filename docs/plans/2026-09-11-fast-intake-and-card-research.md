# Fast staff intake and after-save card research

Status: implementation authorized by Mark in this conversation on 2026-09-11. Source is the isolated `codex/staff-inventory-release-20260910` checkout; preserve collect lineage, unrelated ATLAS work and the existing financial evidence contract.

## Final product plan

1. Preserve conservative initial Google Vision + gpt-6-astra identification. Remove redundant preparation of component-owned JPEGs and improve explicit manufacturer/logo and release-year extraction without guessing copyright conversions, variants or staff-entered values. Record useful stage timings; performance and accuracy improvements require comparison evidence.
2. After the back capture, move staff directly to Cost, then Expected sale price, then visible Sales channel choices, using explicit Next controls suitable for decimal keyboards. Upload/identification proceed concurrently with human pricing. Initial camera/keyboard behavior must be tested on real browser engines; hardware-only acceptance is disclosed. Preserve retries, drafts, manual edits and the one-camera next-card loop.
3. Every newly saved individual card receives a durable research job, independent of whether a variant exists. Enqueue only for a successfully committed inventory item. Research never becomes a save-completion dependency and survives phone/browser closure. Deduplicate by exact item/evidence revision, lease claims, bound work and retain explicit errors. Edits invalidate stale research; jobs cannot overwrite human entries, costs or expected sale prices.
4. Reuse only the existing SoldCompsAPI provider and the isolated sold-comps engine's validated price/link parsing. Never call or fall back to SerpAPI. Ten Kings fetches candidates; Astra analyzes the returned identities and images; deterministic code calculates values from selected candidate IDs. No fabricated listing, price or sold date; unknown Best Offer amounts and mismatched/unsafe comparables are excluded. Preserve the existing grader/public valuation paths.
5. Establish exact card identity and available checklist/reference evidence before deciding base versus variant. Blank variant is not base. Resolve supported variants from explicit photo features and reliable reference evidence, with multiple sold images/titles as supporting comparisons. Unsupported findings remain unresolved. Every card attempts comps research, but unresolved identity or absent reliable sales produces an explicit unknown estimate.
6. Store private research evidence, source URLs, timestamps, exact photo hashes, selected/rejected candidate IDs and reference provenance separately from confirmed inventory descriptions. Retain approved/reusable evidence as knowledge, never promote a model guess or seller title into a verified catalog fact. Images retained by this workflow require exact source/provenance and private storage; no precision grading-map writes.
7. Display research progress, evidence-backed variant suggestion and estimated market value beside the existing staff item details. Staff corrections stay authoritative. Estimates are descriptive research, not a change to acquisition basis, recognized revenue, COGS, or financial actuals.
8. Protect intake with a capped background worker and shared capacity accounting/headroom. Validate duplicate saves, worker crashes, stale revisions, unavailable providers, strict price selection, mobile focus, continuous entry, auth and source/financial compatibility before release. Recheck live configuration without displaying credentials; deploy only completed, reviewed artifacts and honestly report remaining hardware/provider evidence gaps.

## Work ownership

- Mobile agent: capture/photo preparation, Section 3 progression and UI tests.
- Research agent: pure evidence/variant/comparison engine, conservative initial prompt, provider tests.
- Persistence agent: additive durable job/evidence storage and transactional save enqueue/read endpoints/tests.
- Coordinator: integrate worker scheduling/capacity, research UI, review, end-to-end proof, release and handoff.

## Verification and release

Use isolated fixtures/databases for business mutations. Live vendor probes, if needed, are bounded read-only research using the already authorized services; no synthetic production inventory is created. Additive production schema work requires the normal preflight/backup/migration record. Do not alter financial ledger schema or emit new workflow evidence fields solely for research. Persist and present all source-backed estimates separately so the existing financial consumer remains compatible.
