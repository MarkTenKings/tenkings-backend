# ATLAS unified review and named catalog references — deployed-state handoff

Recorded October 10, 2026: canonical verification at `2026-10-10T22:26:29.815Z`; independent read-only postflight at `2026-10-10T22:27:10.545335+00:00`. Application/native source **`fbafd56a5b142bc780badbacabec2a5a0cdf78ed`** is deployed and preservation checks pass. **Authenticated production acceptance of new named-reference photos, selection and findings interactions remains PENDING root verification. This handoff does not claim feature completion.** At postflight ordinary Staff sign-in was required; the user has since completed login and root is inspecting production. No session or human decision was synthesized.

## Live deployment and runtime

| Surface | Immutable deployment / host |
| --- | --- |
| Staff | `dpl_34E7C5MNetff8sjNH5EWZZ5YcJLZ` / `atlas-grading-staff-ex40y0rui-ten-kings.vercel.app` |
| Public | `dpl_4vYYT7zWriai6ggFBAHMzhL6ansu` / `atlas-grading-public-ccic1q3z4-ten-kings.vercel.app` |
| Retained customer | `dpl_HDCWyH27p4gMpNqHMoAYuBNmryXp` / `atlas-grading-customer-kqkvu4gtd-ten-kings.vercel.app`; source `546fd382d51ec42674d54114cbfcad83c574b79f` |

Both native roles use image `sha256:31018f810267aaefcf957484dada4057e58ca19853897f71b11166eac9e4cff7` and application source `fbafd56a5b142bc780badbacabec2a5a0cdf78ed`.

| Role | Container ID | Started at |
| --- | --- | --- |
| Main | `7f80befb65b2dac5ec1e4fca03fdfdbb8c58b810db348be8467a168d9439451e` | `2026-10-10T22:22:53.464873219Z` |
| Isolated worker | `c71725b6d63e6c7325afc0286a43de145ea9242f4d4ddec61cad4616be589a35` | `2026-10-10T22:25:32.590337047Z` |

Both are running with `unless-stopped`, zero restarts/OOM and exact receipt-matched lifetimes. The main retains primary address `172.29.69.2` and `atlas-runtime-primary`; both use `atlas-runtime-693f7229`. The isolated worker retains its existing resource, credential and concurrency configuration. In-memory comparison proved the environment differs from each predecessor only in the planned staff deployment/source values; no credential values were emitted. Both predecessors are cleanly stopped, restart-disabled and disconnected.

All bindings retain `mode=PRODUCTION` and `origin=https://atlasgrading.com`:

| Binding | Source | Config hash |
| --- | --- | --- |
| Staff | `fbafd56a5b142bc780badbacabec2a5a0cdf78ed` | `ec6f00bfaacf848516d5c39d4b00de32fdc872b01f83399aa89669bec6d3705e` |
| Public reader | `fbafd56a5b142bc780badbacabec2a5a0cdf78ed` | `cc3c81e9c8541fb3a2c9c0c8c01e54298a22f04522714561743051d4d331c1c8` |
| Customer | `546fd382d51ec42674d54114cbfcad83c574b79f` | `a16194cda97d081b2b878bb59343f68ba30e6e56085dfdaa064c32f7e6ea1563` |

Enabled control revisions are **Staff 83 / Customer 47 / PublicReader 54 / STAFF SMS 62 / CUSTOMER SMS 21**. STAFF SMS uses the new staff binding. CUSTOMER SMS and public customer admission remain unchanged; commerce, progress and customer-service controls equal baseline. Staff/public ledgers remain **79 / 121**.

The only provider environment change was the public project's staff-routing row. Public promotion was accepted once at `2026-10-10T22:26:15.400Z`; canonical staff/customer GETs and exact deployment assets, public routing and narrow catalog-image CSP passed. These are sessionless read checks, not authenticated feature acceptance.

## Deployed behavior and preserved decisions

- Findings keeps the complete Front/Back photographs and every exact trace while offering zoom, pan, fit and expansion. Marker selection focuses evidence; editing is explicit. The bottom Return control from expanded, zoomed or focused inspection restores both fit photographs and remains in Findings. The ordinary paired-view control explicitly returns to geometry.
- One **Approve all findings** records both side inspections and the current findings/proposal roster, then opens Grade. Final report approval is separate. Browsing, zooming and catalog/photo retrieval never approve a grade or printing.
- Batch review uses one workflow with inline metadata/recovery. Removed the Needs Attention split, its legacy batch navigation and unused grading branches; retained completed-report, label and custody inspection. Unknown year/manufacturer alone no longer blocks geometry/findings. Missing photos or failed analysis remain honest recovery states. Photo verification, exact measurements, stale revisions, pending saves, current findings and final human approval still gate completion.
- Saved Pokémon manufacturer can display through source-bound identification without rewriting historical draft hashes. Nullable provisional metadata and historical identity parsing remain compatible with existing human decisions and saved reports.
- Pokémon preparation uses configured Scrydex. Sports preparation reads the retained official manufacturer snapshot, with reviewed published-catalog fallback for gaps. The removed TCGdex acquisition/cache and unused external set-demand path are absent from the deployed source overlay; historical saved evidence remains readable.
- Known names stay visible even without photos. Each named printing receives its own deterministic, shared SoldComps request keyed by public identity/printing/language. Sequential acquisition yields to grading priority. Unknown outcomes, leases and exact replay prevent duplicate purchases. Titles/photos cannot invent a catalog choice or substitute for a human physical-variant decision. Explicit extra finishes such as Refractor cannot attach to an unqualified insert row; Blue Hyper cannot substitute for Blue.

At independent postflight, **all 55 saved-card records and all 9 current approvals** exactly match the fresh r3 baseline. This is full record equality, not only count equality. All protected-history table counts/hashes and ledger entries also match at fence, restore, public binding and live postflight. All 16 active counters are zero; three priority flags are false; missing-upload carry-over is zero. No reset, retirement, schema migration, grading/identity approval or paid reference request occurred during cutover. Existing historical discard and immutable report evidence remain preserved.

## Qualification and limits

| Evidence | Result and scope |
| --- | --- |
| Exact deployed native image | **632/632 tests**, zero failures/skips; 1,253 source files, 16 inherited native artifacts and 29 dependencies verified. No native recompilation or provider/database calls in image qualification. |
| Final catalog/connected/variant UI suite | **201 tests passed**, zero failures/skips, including exact sports composite/season scope and actual retained LaMelo-title regression with explicitly synthetic response/image bytes. |
| Findings footer and review | **109 focused tests** and **8 browser viewport checks** passed. Root independently tested synthetic expanded Back → 150% zoom → pan → bottom Return → both 100% photographs, exact markers retained and no geometry transition. One findings approval reaches Grade without approving the final report. |
| Owned PostgreSQL journal | **22 assertion groups passed** using disposable PG17, two synthetic provider calls and zero production calls; named request coalescing, leases, uncertain dispatch, late responses and idempotent replay. Upgrade rehearsal preserved 292 existing tables/ACLs and registered no-op redeploy. Root's later query-wording edits were separately covered by final unit/native tests. |
| Release preservation guard | **6/6 offline checks**: all saved cards, protected-table checks, and refusal of new accepted work, revisions, approvals or uploads. **4/4 actual READ ONLY SQL checks** reproduced empty aggregation, accepted corrected empty and unchanged nonempty fixtures, and rejected changed non-scheduling evidence. |
| Live read-only checks | Exact runtime/bindings/history preservation and canonical delivery/CSP passed. Standalone postflight lexical guard was corrected to ignore quoted privilege names/comments while preserving the exact pinned SQL and READ ONLY boundary; four literal/comment and four actual-mutation fixtures passed before the one successful capture. |

Sports serving bundle: **618 official sources, 1,131,964 explicit rows**, gzip **6,054,311 bytes**, SHA-256 `caf2bc5b07c610c87b632bce71893541056ea712861dff2b139ad07fc92a77d0`. Coverage is explicitly **partial**, not complete 1990–2026 history. Topps lacks pre-2018 checklists; Leaf normalized coverage starts 2012–13; Panini covers seven selected products; historical Upper Deck baseball/basketball/football and discontinued brands remain gaps. Unsupported/ambiguous rows stay excluded, set-wide parallels are not multiplied across cards, and physical applicability remains unknown. Local cold-load plus two real-identity lookups took about 890 ms with peak RSS 538,640,384 bytes (~514 MiB); this is not a production latency or zero-contention guarantee.

The actual saved LaMelo identity (`2025`, `Topps Chrome — Ball of Duty`, `BD-13`) resolves one official `BALL OF DUTY` row from 2025–26, page 14 row 25. The scoped basketball start-year fallback preserves the saved identity and records the official season; conflicting seasons/products/subsets fail closed. Current Jaxson Dart `DTBH-JDT` remains **unmatched**: official 2025 Donruss Optic Threads rows use number `3` and supply no alias. Exact official #3 has nine named variants, but that does not authorize changing the user's saved identity. Scrydex `Normal` remains its literal source name, without an inferred Non-Holo alias. Missing photos remain missing; seller references remain unreviewed evidence and do not confer publication rights.

**Pending authenticated acceptance:** ordinary user login is complete; root must finish inspection of preserved actual Pokémon/sports cards, their named choices and reference photographs, and full-photo findings navigation on the deployed staff UI. Do not mark this done from synthetic fixtures, sessionless GETs, historic photo snapshots or a READY job alone. Do not manufacture a printing confirmation or grade approval. New named-photo acquisition is not claimed to have run in production for this release. Root will append observed acceptance and any remaining gaps separately.

## One-shot cutover and failure handling

The earlier `release-r2` fence failed before its first control UPDATE: empty `jsonb_agg` returned SQL NULL rather than expected JSON `[]`. Exact READ ONLY replay returned `NON_SCHEDULING_CARRY_OVER_DRIFT` with stderr SHA-256 `fdee341e76ad637aed5e79c6336490f11347053cc3abf629226aea97454b8008`; unchanged controls and protected history corroborated zero CAS writes. The consumed intent and failure receipts remain intact.

`release-r3` reused the exact qualified native/staff/public candidates. Its only cutover-helper changes were the empty-array `COALESCE` and a fresh runtime namespace/container suffix, followed by a fresh baseline, bindings and plan. Ordinary fencing, graceful predecessor stop, main start, timely restoration inside the 125-second boot window, readiness, public binding, fresh worker grants/start, same-process restart-policy enablement and one routing/promotion completed. There was no retry of the failed fence, repeated build/deployment, reset or historical pre-drain.

All phase, routing and promotion intents are consumed. Preserve both failed and successful packets and inert staged containers; never replay a consumed mutation or silently clean up evidence. Any future release requires fresh current-state observation and a new reviewed plan that preserves later accepted work. Existing postflight outputs are immutable and refuse overwrite.

## Exact evidence

Private packet: `/Users/markthomas/.codex/atlas-handoffs/atlas-unified-review-20261010/release-r3`. Runtime namespace: `/opt/atlas/unified-review-fbafd56a5b14-r2`; native qualification evidence: `/opt/atlas/unified-review-fbafd56a5b14-native-r1`. Canonical runtime plan hash: `a0643e2b2c3b766d314b690a818ca5ba0203a36d5f53a6bc6be147026407ea82`.

| Receipt relative to r3 | SHA-256 |
| --- | --- |
| `runtime/plan.json` | `28d2fa3e1615c6e2b48c3987410df59e7a6173f24fea415d8754989607866317` |
| `native/qualified.json` | `839dc4fe13fcea846b3eb6f2ca042ccb959f24099ec0965e56e00b1e6416d8dd` |
| `review/postflight-result.json` | `393976eda266a510773f6933eda148873a2ad0855c3bc21b73f63cb521f4eb34` |
| `review/postflight-census.json` | `19a53901101f205f8aaf8a5d425bcd1190452dcafb75c86d423285a9489fe8fd` |
| `review/postflight-runtime.json` | `beec6ac4a8a2ab1e73dd5a435224c787d15996728e421f8238320ee1e301c74a` |
| `web/canonical-result.json` | `8ec86dd109b5d3393bce6f942120876e5246a9521ab55b094bf8f3faeeb9d82c` |
| `web/provider-after.json` | `382a0ec7cc1331993763b0989b965143da3d9d4b894915cbaba0fc736eef65c7` |
| `review/predecessor-failure-tombstone.json` | `e83617d0a34d76f2bfb1519c4cfad035890aa8c749b4ef25bab7f139b4cf710d` |
| `review/preservation-result.json` | `25826ad950b5e9899b0d5cf47847b032e514955e7a56d276df60a651053b00d4` |
| `readonly/carry-aggregate-qualification.json` | `29806406121bb44b58f7d5387d872b223aea070d4d96c6e11db46dfd1d729ab2` |

Individual phase receipt hashes are included in `review/postflight-result.json`. Owned PostgreSQL proof remains under `../release/owned-variant-postgres/{result,upgrade-result,source-observation}.json`; findings interaction evidence is under `/Users/markthomas/.codex/atlas-handoffs/atlas-unified-review-20261010/inspection-footer`. The earlier failed fence evidence remains in `../release-r2/runtime` and is indexed by the predecessor tombstone. These private receipts contain operational evidence; credentials are not copied into repository documentation.
