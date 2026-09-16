# First comp repair: release and provider qualification

Date: 2026-09-16. Read-only review of application source at `ece8223b`; research implementation commit `31b86535`. This packet does not authorize or report deployment. The [implementation record](2026-09-16-inventory-research-implementation.md) retains the prior complete test/build evidence.

## Decision

**Qualify and release the demonstrated private comp repairs first, with `STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES=false`.** Catalog persistence/pilot completion, Atlas adoption and the main-domain work are independent deliveries. A missing local provider credential does not block preparing the repair, running fixture/compatibility checks or measuring thumbnail-only load. It does block a fresh provider experiment.

The repair recognizes supported release/design-year wording, PSA NM-MT grades and descriptive sport suffixes while preserving exact product, card-number, grade and parallel controls. New diagnostics distinguish source eligibility, model assessment, deterministic assessment and image evidence. No migration, intake/save change, worker-capacity increase or catalog adapter is required by `31b86535`.

**The whole commit is not yet release-qualified.** Its affirmative sold-status gate is active even with larger images off: ordinary sale prices now need `listingType === 'sold'`; `listingType === 'active'` defeats stale sale-looking fields; absent status remains unknown except explicit supported offer hydration. Missing `bestOfferAccepted` remains unknown. This is a conservative eligibility change, separate from the false-rejection repairs, and its effect on real estimate coverage must be visible in acceptance. A recovered visual match does not promise a verified estimate.

## Concrete first-release gates

| Gate | Required evidence / present status |
| --- | --- |
| Exact candidate | Freeze the narrow release tree and manifest. Verify target branch/current-main relationship and required exact-head CI before promotion. Current checkout contains other agents' documentation work; do not deploy the whole working directory. |
| Same-payload decisions | Replay frozen known-failure inputs against deployed-version logic and v3 using identical source payloads, saved descriptions, image hashes and model decisions. Report classification changes and final selection/estimate separately. Preserve original result bytes/hashes. Existing 80-result compatibility replay proves parsing/hash preservation, not a behavioral comparison or recovery rate. |
| Positive repairs | Anniversary/design-year, NM-MT and descriptive-suffix mechanisms must reach the intended match and, only when all independent prerequisites exist, the final estimate gate. Existing fixtures demonstrate all three; real saved examples still require the paired comparison. |
| Rejection controls | Zero newly accepted wrong release year/season, product edition, sport, exact card number/denominator/leading zero, grader/grade, raw-versus-graded or explicit parallel; reject choice/lot/range/conflicting duplicate evidence. Unreadable/unassessed images, missing offer/status evidence and unsupported catalog identity remain possible/unknown. Model uncertainty is never converted into affirmative identity by deterministic rules. |
| Provider-status effect | Count newly ineligible ordinary sales caused by the new affirmative status gate, distinct from repaired visual matches. If historical raw payloads are unavailable, do not reconstruct absent fields from normalized stored results or a source hash. Keep those cases unproven and identify their effect before calling the whole v3 change a coverage improvement. |
| Thumbnail load | Paired base/candidate test with full-res false, same seeded history and one/three intake sessions, idle then two DB-claimed research workers with bounded mock-provider stalls. Use the existing disposable loopback harness; no production DB or paid calls. ABBA order, five warmups, at least 100 saves per scenario. Freeze p95 margin at <= max(50 ms, 10%) above base, zero new errors/retries, exactly one job per accepted save. Measure photo/recognition, queue-lock/lease wait, save acknowledgment, Cost focus and next-camera readiness separately. Follow with representative iPhone/staff acceptance. |
| Build / rollout | Prior normal migration-disabled Node22 build and Sharp runtime/tracing passed. Run required checks for the actual release artifact after source changes; twelve documented unrelated raw-tsc grader-test diagnostics are not new repair errors. Preserve `RUN_DB_MIGRATIONS=false`, ordinary release checks, existing auth/cron/storage settings and the images-off state. Append planned action and observed identity/results to SESSION_LOG before/after release. No catalog or domain cutover belongs in this release. |

The load gate is material: `packages/database/src/staffInventoryResearchV2.ts` shares queue advisory lock `(20260911,4202)` between saves and claims, permits two research workers and pauses new research only at three intake leases. Unchanged source and after-save scheduling do not prove no slowdown. No load result was obtained in this review.

First success report: three demonstrated failure mechanisms repaired; zero newly accepted rejection controls; real paired cohort size and repaired matches disclosed; verified-estimate changes separately attributed to identity, sale status, amount and independent-image requirements; paired intake latency within the frozen margin. No >90% claim follows from this narrow release. Broad all-card coverage still needs the independent holdout in the approved plan.

## Provider/image experiment: a separate gate

Existing entry point: `frontend/nextjs-app/scripts/probe-staff-research-provider.ts`. Dry-run is the default and was verified here. Execution requires both `--execute` and an absolute unused private output path plus a legitimately supplied server `SOLDCOMPS_API_KEY`. It makes four search queries (three sold cohorts and one active control), at most four details and six image requests; its plan declares a maximum provider quota of eleven. It makes no model, database or inventory request. Provider calls have 20-second timeouts; image calls six seconds, two MiB and sixteen million pixels; redirects are rejected. Reports are create-new mode 0600 and newly created directories mode 0700. Confirm any existing output parent is private before use.

The production sensitive Vercel variable is not a locally available credential. Do not retrieve it through a bypass, put it in command text/logs, export project environments, alter its sensitivity, or create a public diagnostic endpoint to access it. Use an approved server execution environment that already legitimately possesses the key, or an owner-provisioned appropriately scoped test credential injected through its normal secret mechanism. If neither is available, record the live experiment unavailable and continue the independent images-off repair. Existing inventory research APIs mutate job/history state and are not a substitute for this read-only probe.

Before actual execution, pin script/commit, private output directory, request/paid quota bound and credential provenance without its value. Read the report privately, publish only aggregate findings and artifact hashes. The script's quota number is declared metadata; verify it against the applicable provider accounting before treating it as a spending guarantee. No such execution or provider-account change occurred here.

### What the script can and cannot establish

- It can observe returned fields, response hashes, item identities, request latency and whether provider-supplied thumbnail/full-primary URLs produce different decoded dimensions/bytes under the limits. It does not synthesize image URLs.
- Its first-item-per-query selection does **not** guarantee ordinary auction, ordinary fixed-price, missing-offer flag, known accepted offer, undisclosed offer and ended-unsold cases are all represented. Record uncovered cells as unqualified; do not turn active/ended status or a documentation example into proof of a completed sale or accepted amount.
- Qualify amount semantics against the same item ID: source sold status, exact currency/final amount, explicit offer/hydration fields and contradictory combinations. Item details may reveal useful discriminants, but runtime research currently searches and reads primary images; it does not consume item-detail specifics automatically.
- The script records image metadata/hashes without retaining the image bytes and invokes no model. A successful probe therefore cannot prove readable foil/edition/serial cues, that the larger primary depicts the same card/side, or improved visual identification. Those need separately bounded, source/hash-bound image review and paired downstream comparison before enabling larger images. Additional listing views remain outside this release.
- Fixture fallback tests prove the shared twelve-download/four-way-concurrency limit, not actual larger-image usefulness or throughput. Six-megapixel-looking URLs or larger dimensions alone are insufficient. Qualify actual decoded bytes/content, fallbacks, real latency and the paired loaded-intake scenario separately before changing the flag.

## Evidence produced by this bounded review

- Read mandatory context, the full canonical blueprint, deploy/SetOps runbooks and relevant handoff/log records; reviewed the implementation document, actual decision/evidence/price engine, v3 integration and probe code.
- Fresh credential-free Node `22.23.2` run: **33/33** existing decision, price and evidence tests pass. Separate targeted integration run: **6/6** pass (three failure mechanisms, legacy hash preservation, offer evidence, affirmative sale status, larger-primary toggle/fallback and duplicate price-range behavior). All use fixtures/injected providers; no paid requests or DB opened.
- Credential-free dry-run probe prints the four-query/request-limit plan and exits zero. No execute flag, output report, credential lookup, environment mutation, full build, deploy, database operation, Atlas edit or commit performed.

Reproduce the fixture checks from `frontend/nextjs-app` with a clean environment:

```sh
env -i PATH=/usr/bin:/bin TMPDIR=/private/tmp /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --import tsx --test tests/staffInventoryResearchDecisions.test.ts tests/staffInventoryResearchPrice.test.ts tests/staffInventoryResearchEvidence.test.ts
env -i PATH=/usr/bin:/bin TMPDIR=/private/tmp /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --import tsx --test --test-name-pattern='documented anniversary|provider sale status|v3 primary images|a duplicate listing|legacy immutable results|only explicit hydrated' tests/staffInventoryResearch.test.ts
env -i PATH=/usr/bin:/bin TMPDIR=/private/tmp /Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node --import tsx scripts/probe-staff-research-provider.ts
```
