# History-reuse background-load comparison — prepared only

Prepare **one new comparison of changed source**, using the integrated candidate before/after invocation-local verified-history reuse:

- A: `882e40a20bac3f3a276e03c1cbe9f823785d42a1`.
- B: `12e13992cd341eeea96dbe0955cc4dbfba67bc1d`.
- Exported runtime diff: **only `packages/database/src/cardPlatformV2.ts`**. Other commit differences are documentation, harness preparation or tests; both arms receive the same frozen driver/role/IPC bytes.

This is not another run of unchanged source seeking a pass. All three previous failed studies, their refs, protocols, raw evidence and gates remain untouched. Root reports 56 real PostgreSQL checks passed before committing B, including the five focused history-reuse cases; those checks were not repeated during preparation.

## New files and exact unchanged experiment

- [Dedicated runner](../../packages/database/scripts/benchmarkStaffIntakeHistoryReuseDisposable.mjs).
- [New preregistration](2026-09-16-intake-history-reuse-comparison-protocol.json).
- This readiness record.

The original split driver, role and IPC files are unchanged and their hashes are asserted. Three sessions, idle/thumbnail scenarios, ABBA order, five warmups and 50 measured saves per session/block: **1,200 measured + 120 warmup saves**. Keep the 2,000-unit/256-pending/16-terminal seed, 4/3/1 pools, two workers, provider response tapes/delays, photos, actual worker/save overlap barrier and admission/integrity assertions. Seed RPC remains 180 seconds, every ordinary RPC 60 seconds, global cap 30 minutes. This new runner rejects an extra preflight.

All original five metrics plus direct `photo_wall_ms` remain gates. Every pooled comparison **and each repetition** must satisfy B−A ≤ `max(50 ms, 10% of A p95)`; candidate loaded-minus-idle has the same rule. Photo sum is not replaced by wall time. No exclusions, pooling across studies or margin changes. The runner's metrics-through-summary region remains byte-identical to preparation 01 (`0a09e24e463316a81d1c360c2db4ff494899a3b369df3ffed1f9ca40203e9a70`). Revision 02 changes runner supervision and cleanup only, as detailed below. A diagnostic pass cannot become a release pass.

## Source-resolution correction required by these newer refs

The integrated worker eagerly imports `staffInventoryResearchCatalog`, which imports `@tenkings/card-catalog-evidence`, even while the catalog path is disabled. The old export list omitted that package and lacked its tsconfig alias. Reusing that list could silently load mutable canonical workspace code.

The new runner exports **`packages/card-catalog-evidence/src` and its `package.json` from each pinned commit**, then binds the exact package alias to `../../packages/card-catalog-evidence/src/index.mjs` inside each owned snapshot. Existing database/shared/ebay aliases remain snapshot-local; Prisma points to the original isolated frozen client. Recognition scope code is `frontend/nextjs-app/lib/server/cardCatalogScopeEffect.ts`, already inside the exported frontend library tree. No application package is copied from a mutable workspace symlink or built distribution.

Preparation traversed a conservative literal-import closure, including type/dynamic imports: **79 source/harness modules per arm**, all resolved within exported paths or the sealed harness inputs. Every workspace import maps to one of four explicit owned-source aliases; unresolved relative or workspace imports abort preparation. An additional static AST inspection found no computed import/require calls in the closure. External installed libraries are reused; no dependencies are installed or rebuilt. `source-compatibility.json` retains both source ledgers and external dependency names.

## Schema/client and disabled-feature evidence

Both A/B Prisma schemas have SHA-256 `0233ffa118ff9927621043bfe5e077aa15ee320db8087be9fc6a270884b9dd09` and **96 migration files**. The original frozen client ledger remains `e1a91c8dee8d08a561083f4976312f6d3b0faedaf3842489cda739b769db6345`; its schema hash is `70ce3c2011f58290eb62cc314c9e916b645d794f704332a1d6ff51c111ffd7d1`.

After comments/formatting normalization, the exercised `Location`, `InventoryWorkflowEventV2`, `StaffInventoryResearchJobV2` and `StaffInventoryIntakeLeaseV2` model definitions match that frozen client exactly. The complete schemas are not identical: the newer schema adds `SetCatalogEvidencePublication`/`SetCatalogObservationProposal`, and unrelated existing blocks differ. This is scoped compatibility evidence for the exercised path, not approval to use the old client for catalog/V4 operations. No Prisma generation occurred. Later execution still applies the complete pinned migration chain to the owned cluster and verifies the exact second-deploy no-op.

Runner/driver environment allowlists omit `SET_CATALOG_EVIDENCE_ENABLED`, `STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE` and `STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED`. Frozen injected worker dependencies provide neither `loadCatalog` nor `reconcileCatalog`; research therefore follows V3. Full-resolution images remain explicitly false. Only synthetic provider values/transports are supplied; unexpected external fetch fails closed. These conditions are the same in both arms.

## Preparation result and seals

Current receipt: `/private/tmp/tenkings-intake-history-reuse-preparation-20260916-02`. Receipt 01 remains unchanged as historical preparation evidence.

Observed: **no database started, no source trees exported, zero measured saves**. Runner syntax passed; source/schema/import/hash assertions passed. Unchanged driver/role/IPC files retain their prior static qualification; no application runtime, database test, build or new benchmark ran. Measurement fields are unchanged. The source compatibility receipt is identical to receipt 01.

### Revision 02 supervision correction

The parent owns every detached command group and the PostgreSQL group, using the already installed native `initdb`/`postgres` binaries. SIGINT/SIGTERM, startup/admin failure and the global deadline set a shared abort signal. Pending readiness/admin waits reject on that signal, new work is refused, and control reaches bounded cleanup. The unchanged **30-minute overall cap** now reserves its final 30 seconds for cleanup: work stops at **29 minutes 30 seconds**. TERM/INT is followed by bounded KILL escalation where needed. Data is removed only after owned command groups are absent and PostgreSQL is confirmed stopped; otherwise the runner retains the owned data and reports failure. Process/cleanup receipts retain owned PIDs and interruption state.

Independent static review closed the supervision blockers. The only subsequent defensive changes assert `work_cap_ms === cap_ms - cleanup_reserve_ms` and attach a rejection observer to the PostgreSQL readiness promise for the deadline-immediately-after-spawn edge. No driver, role, IPC, runtime source, workload or gate changed. **Forced-signal/failure cleanup has not been runtime-tested in this preparation**; SIGKILL and OS failure cannot be trapped. Normal completion and failure-path behavior must be reported from the eventual run, without claiming this static review proves them.

| Artifact | SHA-256 |
| --- | --- |
| New runner | `2e57a78dd1f65b439d814c54aba02eac1d9b94ffe83c6252c4ca6b3a360272a2` |
| New preregistration | `863dfc2fa58e508d6613612dbafc1c610e4290be62866e42031ac57bcfc0f580` |
| Effective protocol | `efe4396cb681d3a60a1e589d84a305343e743bf02ab0931a02d93cf8cb6829b1` |
| Source compatibility receipt | `964ea543c8dc612f0985232fbcc208750442eec78bced867c771870b900653a9` |
| Driver, unchanged | `064a9018d15ffd3c97bced10001a9c0541ee6d44a2313a83f3fac2f0108e5fb5` |
| Role, unchanged | `a708f12e817845806d62bceca4875b85178955c5a072e9bfc7447b8baaffc749` |
| IPC, unchanged | `a44b60247437c6b333ba36469e3248452ebfb0b60249650cee819fbb628a1a7f` |
| A writer | `d43a4e12fa347955fb6cce74c36e4c9a435a1e8e53c0b8ec770df9430f8437b0` |
| B writer | `20305bc3152618c3817ef6b06b8a7a32c69c4f12a9497bd0f809640744da05fb` |

## Coordinated launch — not yet released

Root must review these exact artifacts, confirm fresh disk headroom and release one quiet window under Mark's existing authorization. No new permission request to Mark is needed. The runner retains the **2 GiB free before setup and each block** checks. A preparation snapshot showed 2,535,202,816 free bytes, approximately 370 MiB above the floor; this is not a later launch guarantee. Prior full split output used about 150 MiB plus roughly 109 MB transient setup; require at least **2 GiB + 300 MiB** immediately before launch. Do not delete evidence or relax the floor. No measured run or preflight is authorized by this readiness document itself.

```sh
cd /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node \
  packages/database/scripts/benchmarkStaffIntakeHistoryReuseDisposable.mjs \
  --run-approved-split-diagnostic --ack-disposable-local-postgres \
  --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 \
  --out /private/tmp/tenkings-intake-history-reuse-comparison-20260916-01
```

Use a new output path; never overwrite a receipt. The coordinating agent launches only after reviewing the revision 02 seals and supervision limits above.

**Deployment limit remains:** synthetic identify leases and workspace saves share the intake process, whereas deployment metadata gives identify a different function identity. A changed-source result does not prove production identify isolation, Vercel instance concurrency, physical-camera responsiveness, real providers, the full scenario matrix or independent all-card accuracy. Preserve this limit and every prior failure when interpreting the one new result.
