# September 16 first Inventory research implementation

Status: **reviewed local candidate; not deployed**. Base `60572cec895ad63d4ab826cd366f6475b04e725a`. The [owner-approved plan](2026-09-15-variant-and-sold-comps-improvement.md) remains the full scope; this document distinguishes this first delivery from the remaining integration/qualification work.

## Implemented

1. Private research v3 separates release years from explicitly supported anniversary/design years, recognizes supported PSA NM-MT numeric grades, permits only descriptive sport/category suffix omissions and preserves meaningful product qualifiers, card-number zeroes/denominators, grading-company/grade and variant contradictions. Ambiguous evidence remains possible/unresolved. The shared public comp parser is unchanged.
2. Source-reported sold events are distinct from visually matching cards and verified prices. Active/unknown-status listings cannot supply an estimate; unknown Best Offer stays unknown. Choice/multi-price listings remain excluded. Duplicate rows cannot hide a newly exposed price range. An ended date alone cannot prove a sale.
3. Versioned diagnostics retain raw model conclusions separately from deterministic decisions, exact compared-image SHA256, attempted provider URLs, dimensions, source/retained counts, pagination flags and reason codes. A successfully downloaded image followed by optional model failure remains explicitly unassessed. Optional image archival timeout retains already verified comparison bytes without claiming successful storage.
4. Actual provider-supplied larger primary URLs can be tried with thumbnail fallback **only when** `STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES=true`. The flag has not been enabled. No synthesized URL or extra view is used. Both sizes share the existing twelve-image download budget, four-way concurrency, six-second image deadline, eighteen-second image round, two-MiB body and sixteen-million-pixel limit. Search/model counts and overall deadlines are unchanged.
5. [Recognition package handoff](2026-09-16-recognition-package-handoff.md) and [catalog contract foundation](2026-09-16-shared-catalog-contract.md) are committed at `b89cb020bde7e538142b26e69198fb992c526f36`. Atlas received the exact package scope, source/result commits, manifests, executable fixtures and adapter safeguards. Atlas independently verified the committed files and also passed 26/26 recognition tests on Node 20.20.1; it reports no new package-contract blocker. Both new packages are opt-in; neither application was switched to a new adapter.

No capture, photo upload, quick recognition, cost/channel, save/next-card, durable enqueue, worker concurrency, inventory writer, financial history or Atlas application file changed. The existing sports intake request remains exact. All new research work uses the existing after-save path.

## Verification actually completed

| Check | Observed result |
| --- | --- |
| Pre-change research/price/worker/compatibility baseline | 54/54 pass |
| Final staff/photo suite, including new integration cases | 252/252 pass on Node 22.23.2 |
| Recognition package | 26/26 pass; strict NodeNext consumer types; 19-file hash verifier |
| Catalog contract | 25/25 synthetic sports/Pokémon cases pass; strict NodeNext consumer types |
| Independent review | Three Astra Max agents; recognition and catalog cross-reviewed; three research findings fixed and verified |
| Immutable stored-result compatibility | All 80 stored results / 1,237 candidate occurrences in the existing September15 snapshot parse with unchanged canonical bytes and stored SHA256 hashes; read-only, no database opened |
| Scope lint and shared TypeScript build | Pass |
| Full application TypeScript | The same twelve pre-existing unrelated grader-test diagnostics; no new changed-file error |
| Workspace lock | Frozen lock-only check passes; only new workspace importers added; existing dependency resolutions unchanged |
| Normal `scripts/vercel-build.sh` with `RUN_DB_MIGRATIONS=false` | Pass, including Sharp trace/runtime check; existing unrelated Next warnings remain |
| Protected flow source audit | Twelve intake/save/enqueue/worker files byte-identical to base; five targeted concurrency/interaction tests pass |

The independent review caught and verified fixes for duplicate price-range loss, a product qualifier hidden by removing an interleaved player name, and inconsistent acquired-image diagnostics during an archive timeout. Known failure fixtures now pass through the final estimate gate; wrong-year, wrong-grade and wrong-product controls still fail. These tests do not independently establish real-card accuracy.

## Provider qualification remaining

`frontend/nextjs-app/scripts/probe-staff-research-provider.ts` prepares a bounded, explicit, read-only qualification: four queries including an active control, up to four item details and six thumbnail/full-resolution image reads; no model, database or inventory call. Default execution only prints the plan. Actual execution needs a legitimately supplied server credential and explicit private output path; private report files use mode 0600 and omit authentication headers.

No fresh SoldComps experiment ran in this build. The production variable is configured as sensitive; its authorized metadata read does not expose a usable local key, and no credential-access workaround was attempted. Published documentation describes larger images, but actual primary-image sizes/quality, ordinary-sale/Best-Offer semantics and item-specific usefulness still need this experiment. Do not enable larger images or claim the provider ambiguity is solved from documentation alone. Existing positive hydrated-offer semantics and missing-flag safeguards are preserved.

## Performance and next delivery gates

No new awaited intake work is a structural safeguard, not a measured no-slowdown claim. The existing optional intake lease can wait up to one second plus a 1.5-second transaction budget; save and worker transactions share queue lock 4202, and research pauses only at three active intake leases. The new release needs a paired idle/saturated check before adding background load.

Use the existing loopback-only `testCardInventoryV2Disposable` harness with equal seeded history and an ABBA base/candidate order: five warmups and at least 100 measured saves per scenario, one then three intake sessions, idle then two real DB-claimed research workers with bounded mock-provider stalls. Capture photo/recognition handler, lease/queue-lock wait, save acknowledgment, Cost focus and next-camera readiness separately. Include ordinary thumbnails, enabled larger images, provider timeouts and throttling. Freeze local non-regression margins before results (proposed p95 increase <= max(50ms, 10%), zero new errors/retries, exactly one research job per accepted save). This remains a local regression test, followed by real iPhone and representative simultaneous staff acceptance. No loaded-device latency result is claimed here.

Next authorized implementation remains:

- Complete the real provider/image experiment and measured load qualification.
- Implement the durable full-manifest SetOps publication/current-pointer and idempotent proposal persistence described in the catalog design; verify additive migration, authorization, concurrency and rollback before activation.
- Prepare and review one real demanded sports product and one Pokémon set with source bytes/hashes, exact applicability and useful approved images. Synthetic contract fixtures are not that pilot.
- Add the Inventory after-save adapter and pinned revision evidence. Atlas owns its separate adapter/release after initial grading acceptance unless Mark changes that priority.
- Prove reviewed evidence reuse in both directions on different physical cards; then broaden coverage and evaluate an independent holdout of at least 200 cards.

The >90% all-card correct-comp-attachment objective remains a target. No live improvement rate, complete catalog, Atlas parity or new deployment is claimed by this first build.
