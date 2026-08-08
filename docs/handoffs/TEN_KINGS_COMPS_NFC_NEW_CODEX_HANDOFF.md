# Ten Kings Speedster V2 — SoldComps + NFC New-Codex Handoff

**Prepared:** 2026-08-07
**Owner:** Mark Thomas
**Purpose:** Copy/paste this entire document into a brand-new Codex task. It is the complete operating prompt for finishing eBay Sold Comps V2 through SoldComps and commissioning NFC V2 on the Dell without losing the existing reviewed work or violating the Speedster foundation principles.

---

## BEGIN COPY/PASTE PROMPT FOR THE NEW CODEX AGENT

You are the new primary implementation and release agent for two Ten Kings Speedster V2 finishing workstreams:

1. **eBay Sold Comps V2:** replace only the broken SerpAPI supplier adapter with SoldComps, prove it with a zero-write contract test, then test, release, and verify Production.
2. **NFC V2:** preserve the already-live card-bound hosted surface, then—only when Mark is physically at the Dell and explicitly authorizes it—run the read-only exact-state preflight and proceed through the approved physical commissioning gates.

Use fresh agents, but preserve and audit the existing reviewed implementation; do not discard it or rewrite either project from scratch. Do not trust summaries over code, runtime, database, Vercel, Git, or hardware evidence. Read every mandatory document and inspect the actual current state before changing anything.

### Required multi-agent structure

Mark explicitly requires fresh sub-agents.

- The root agent must first personally read every mandatory file completely and inspect the current Git/worktree state.
- Then spawn two **brand-new, fresh-context builder/lead sub-agents**: one Comps builder/lead and one NFC builder/lead. Do not reuse agents or conclusions from prior tasks.
- Require each fresh lead to read this full handoff and all cited documents/runbooks for its workstream before acting.
- The Comps builder/lead owns the SoldComps contract, adapter, focused tests, and browser acceptance.
- The NFC builder/lead owns the read-only source/runbook audit and, later, the Dell commissioning evidence.
- For each workstream, spawn a **different brand-new, fresh-context critic sub-agent** that did not build or edit that work. A lead may not act as its own auditor or critic.
- Require each critic to read this handoff and the relevant cited source/runbook files, inspect the actual evidence/diffs/tests, and try to disprove correctness.
- Continue builder → independent critic → correction → fresh critic re-review until the critic returns an explicit GO.
- Sub-agents may spawn focused sub-agents as concurrency permits, but agents must have explicit file ownership. Do not let multiple agents edit the same worktree/files at the same time.
- Root remains release owner: independently inspect diffs, rerun the critical tests, enforce owner-approval boundaries, and make the final release decision.

### Immediate priority order

1. Finish SoldComps V2 first after Mark securely configures the `sc_` key. Mark resolved the former `41` versus `#41` contract-query conflict on 2026-08-08 as documented below.
2. Keep NFC source review current in parallel, but do not touch the Dell until Mark says he is physically there and gives the exact read-only authorization below.
3. Speedster remains the top product priority. Do not begin Card Platform V2 packs, inventory, DIRECT, mystery-machine, shipping, buyback, or other later work in this task.

---

# 1. Mandatory reading and evidence rules

Use this working repository for the current authoritative documents:

`/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix`

Read these files completely before task actions:

1. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/AGENTS.md`
2. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/context/MASTER_PRODUCT_CONTEXT.md`
3. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/runbooks/DEPLOY_RUNBOOK.md`
4. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/runbooks/SET_OPS_RUNBOOK.md`
5. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/HANDOFF_SET_OPS.md`
6. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/handoffs/SESSION_LOG.md`
7. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`
8. `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/ai-grader-nfc-helper.md`
9. This handoff: `/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix/docs/handoffs/TEN_KINGS_COMPS_NFC_NEW_CODEX_HANDOFF.md`
10. The new owner-approved SoldComps supplier memo: `/Users/markthomas/.codex/attachments/23188b19-f38b-4321-ae03-9daf22ff61e2/pasted-text.txt`

The SoldComps memo supersedes only the master blueprint’s old decision that SerpAPI is the launch comps supplier. It does not supersede the rest of the blueprint.

Evidence rules:

- Code/runtime/DB/Vercel/Dell evidence beats documentation if they conflict.
- Update documentation in the same work if evidence changes the documented truth.
- Append to `docs/handoffs/SESSION_LOG.md` after every commit-worthy change.
- Append the planned action before every deploy, restart, migration, environment change, helper transition, or hardware action.
- Append the observed result afterward with exact evidence.
- Never print, log, commit, paste into chat, or expose API keys, NFC signing private material, workstation private keys, pairing tokens, raw NFC UIDs, admin tokens, database URLs, or customer data.
- No destructive database operations. No reset/clean/discard of user changes. No branch-protection bypass, force push, history rewrite, or silent migration.

### Dirty/stale checkout warning

Do **not** implement in:

`/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`

That checkout is stale and dirty on `feature/ai-grader-report-polish`, hundreds of commits behind current `origin/main`, contains unrelated user work, and has an unresolved `SESSION_LOG.md` conflict. Do not clean, reset, switch, stash, or repair it as part of this task.

Current remote truth at handoff creation:

- `origin/main`: `5c45a22ec61aee7cf5666d4c30ead6d1c948a01e`
- Merge: PR #305

Re-fetch and verify this before acting because it may advance after this handoff.

---

# 2. Speedster Foundation Principles — mandatory and ordered

When principles conflict, the earlier principle wins.

## 2.1 Least code possible

- Prefer one nullable fact over a new table.
- Prefer one bounded JSON snapshot over comp-result tables.
- Prefer one reusable screen over duplicate screens.
- Prefer the existing local NFC helper over another service.
- Do not add placeholders, future frameworks, queues, workers, or safety layers that are not required by the approved done gate.
- The SoldComps swap should reduce net code. Delete SerpAPI-only code instead of leaving dormant abstractions.

## 2.2 One write path

- Exactly one module, `card-platform-v2`, owns lifecycle writes.
- Comps is a read-only engine. It never writes application tables itself.
- Saving a snapshot, confirming market value, changing public visibility, or recording NFC verification must use the existing `card-platform-v2` functions and locking/revision protections.
- Do not create a second market-value writer, NFC writer, direct Prisma write, or parallel lifecycle API.

## 2.3 Count, never track

- Never introduce mutable inventory/availability counters.
- Nothing in Comps or NFC creates a duplicate status counter.

## 2.4 Permanent identity from creation

- Every valid completed Speedster grade already owns one permanent V2 card and `/c/tk2c_...` URL.
- NFC writes that permanent URL. It never mints a temporary URL or a tag-specific card identity.

## 2.5 Grade is authoritative and independent

- NFC does not affect a grade.
- Comps does not affect a grade.
- Market value does not affect a grade.
- Inventory does not affect a grade.
- Failure of Comps or NFC never erases, edits, gates, or invalidates a completed grade.
- Production acceptance must prove the grade record is byte-identical before and after Comps operations.

## 2.6 Payment before reveal/dispense

Not in scope for this task. Do not alter payment, reveal, Stripe, mystery pack, or vending behavior.

## 2.7 Preserve V1; do not extend it

- Old customer collections, Live Rips, Mux media, NFC/QR/report URLs, and customer rights continue working.
- Do not add new V2 cards, Comps, or NFC writes to V1 `CardAsset`, `Item`, KingsReview, or V1 NFC tables.
- No V1/V2 dual writes and no V1 deletion.

## 2.8 Reuse working foundations

Do not replace or redesign Speedster grading/capture/SAM/learning/measurement/label/report logic, auth/Twilio, Stripe, TKD wallet/ledger, Locations, Live Rip/Mux, object storage, or Dell hardware foundations.

### Optional forever

- Comps and NFC are optional per card forever.
- Neither is a grade-completion, card-creation, inventory, pack, DIRECT, listing, sale, ownership, or lifecycle gate.
- Absence/failure must render honestly and allow all unrelated work to continue.

---

# 3. Production truth already established

The following is already live and must not be rebuilt:

- Permanent `CollectibleCardV2` foundation and stable `/c/tk2c_...` public pages.
- Completed Card → Comps and Completed Card → NFC routing.
- Standalone `/admin/comps` and `/admin/nfc` admin engines.
- Corrected authoritative Speedster identity and Human Grade PDF binding.
- The exact TKH-000700 card is linked to both engines.
- Hosted NFC protocol/UI is deployed, but physical NFC writing is intentionally disabled and uncommissioned.

Relevant historical releases:

- PR #302 / merge `ec440c3d5312716146507edf577dfb62266479fe`: V2 card, Comps, and hosted NFC surfaces.
- PR #304 / merge `a269041caa20cfdb8254e1b65c228f41cd05ab7a`: Speedster identity/label correction and Production binding.
- PR #305 / merge `5c45a22ec61aee7cf5666d4c30ead6d1c948a01e`: production release record.

Do not assume a deployment ID is still current; verify GitHub/Vercel state at release time.

### TKH-000700 acceptance card

- Certificate: `TKH-000700`
- Speedster session ID: `cmsic0c60003ivcg0o81sw44d`
- Permanent V2 card ID: `cmsjbmzjj000rtts9c6o2iynp`
- Permanent token: `tk2c_1NVR4seS3qN_hX5DUydKnlXkroLZ4IDg`
- Grade: `TK 9.2`, mapped to `PSA 9`
- Identity: `JALEN HURTS · 2025 · PANINI · PHOENIX · SILVER · THUNDERBIRDS · #41`

Production URLs:

- Completed card: `https://collect.tenkings.co/admin/ai-grader-v2/completed/cmsic0c60003ivcg0o81sw44d`
- Comps: `https://collect.tenkings.co/admin/comps?card=cmsjbmzjj000rtts9c6o2iynp&from=%2Fadmin%2Fai-grader-v2%2Fcompleted%2Fcmsic0c60003ivcg0o81sw44d`
- NFC: `https://collect.tenkings.co/admin/nfc?card=cmsjbmzjj000rtts9c6o2iynp&from=%2Fadmin%2Fai-grader-v2%2Fcompleted%2Fcmsic0c60003ivcg0o81sw44d`
- Public card: `https://collect.tenkings.co/c/tk2c_1NVR4seS3qN_hX5DUydKnlXkroLZ4IDg`

---

# 4. Worktree isolation and ownership

## 4.1 Comps worktree — preserve existing reviewed changes

Use:

`/Users/markthomas/tenkings/ten-kings-serpapi-comps-v2-surgical-fix`

At handoff creation:

- Branch: `codex/serpapi-comps-v2-surgical-fix`
- HEAD: `5c45a22ec61aee7cf5666d4c30ead6d1c948a01e`
- HEAD equals then-current `origin/main`.
- There are intentional uncommitted/untracked Comps changes. They belong to this project. Do not discard them.

Changed files:

- `docs/handoffs/SESSION_LOG.md`
- `frontend/nextjs-app/lib/server/compsV2.ts`
- `frontend/nextjs-app/pages/admin/comps.tsx`
- `frontend/nextjs-app/pages/api/v2/admin/comps/[...action].ts`
- `frontend/nextjs-app/tests/compsV2.test.ts`
- `packages/ebay-sold-comps-v2/README.md`
- `packages/ebay-sold-comps-v2/src/index.ts`
- `packages/ebay-sold-comps-v2/tests/index.test.js`
- untracked `frontend/nextjs-app/lib/compsV2Ui.ts`

Before editing:

1. Run `git status --short`, `git diff --check`, `git diff --stat`, and inspect the complete diff.
2. Preserve every unrelated/user change.
3. If creating a better-named branch, create `codex/soldcomps-comps-v2` from the existing HEAD while retaining the working changes. Do not reset/reapply them from memory.
4. Do not create a second Comps worktree that silently loses this reviewed work.

## 4.2 NFC worktree — create a separate clean current-main worktree

NFC agents must not edit in the dirty Comps worktree while Comps agents are working.

- Fetch `origin/main`.
- Create a fresh clean worktree from current `origin/main`, with a branch such as `codex/nfc-v2-commissioning` and an explicit path under `/Users/markthomas/tenkings/`.
- Confirm it is clean before any NFC documentation or script change.
- Do not use the stale `ten-kings-mystery-packs-clean` checkout.
- Do not assume the older `/Users/markthomas/tenkings/ten-kings-nfc-v2` worktree is current.

The NFC phase may require no repository code change before physical commissioning. Do not manufacture code changes merely to have a commit.

---

# 5. Comps V2 — current state that must be preserved

Production currently has the base Comps surface, but the committed supplier path still uses SerpAPI and is not a proven working sold-results path because eBay placed Sold/Completed filters behind login. SerpAPI publicly acknowledged the incident. The previous direct exact request took 84.59 seconds and returned a truthful no-results response. This was provider-side, not Mark’s internet.

The uncommitted Comps worktree contains valuable, tested corrections:

- Authoritative card-bound query from Speedster identity.
- Card-bound query is read-only; zero-write research mode remains editable.
- One automatic search when entering from a completed card with no snapshot.
- One documented decimal-to-whole PSA mapper; exact `.5` ties round down.
- Display-only `TK 9.2 — comping against PSA 9`.
- Ten Kings decimal grade/TK text never enters the provider query.
- One provider response, at most 60 normalized candidates.
- First 30 visible; `Fetch 30 More` reveals remaining local snapshot rows only.
- No network call on `Fetch 30 More`; selected IDs and `compsPublic` remain unchanged.
- Server-owned snapshot/selection/market-value writes and CAS/locking remain intact.
- Public comps placement remains below the full graded report and is blank when no comps exist or public display is disabled.

Those behaviors survive the SoldComps swap. SerpAPI-specific request/parsing code does not.

Prior Node 20 verification on the uncommitted correction:

- Provider engine: `26/26`
- Comps server/UI/API: `15/15`
- Database strict build: pass
- Focused ESLint: pass
- Optimized Production build: `75/75` pages
- `git diff --check`: pass
- Changed Comps files: no TypeScript errors
- Full repository `tsc --noEmit` still contained 13 pre-existing unrelated AI Grader test errors.

Current truth as of 2026-08-08 supersedes that pre-adapter snapshot: the Comps V2 supplier boundary is implemented against SoldComps, the former SerpAPI request/parser/status coupling is removed from this path, and `scripts/vercel-build.sh` explicitly builds `@tenkings/ebay-sold-comps-v2` before Next.js so a clean checkout does not depend on an untracked `dist`. PR `#306` merged normally as `5ada8204860dd40e14db38891e8e330c05272709`; Vercel deployment `48aTJTR3DeupTZzVmaHqzCuFewni` is Ready, Production, Current, and serves `collect.tenkings.co` from that exact merge commit.

A brand-new independent post-adapter critic returned explicit `GO` after one correction: Best Offer and non-USD candidates retain their approved amount/currency in the existing visible `matchReason`, while `soldPriceCents` remains null so those rows cannot be selected or averaged. Root-owned Node 20 verification passes provider `24/24`, Comps server/UI/API `16/16`, database build, focused ESLint, `git diff --check`, and the complete `RUN_DB_MIGRATIONS=false pnpm vercel:build` with all `75/75` pages.

---

# 6. Owner-approved SoldComps supplier decision

SoldComps is now the locked replacement supplier. Do not re-run the OpenWeb Ninja comparison, do not pursue eBay Marketplace Insights, and do not retain SerpAPI as a fallback.

This is an adapter-only swap. Preserve unchanged:

- authoritative query builder;
- PSA mapping function;
- snapshot shape/persistence;
- admin selection workflow;
- arithmetic average;
- server-owned market value;
- auth, locking, revision/CAS, and idempotency;
- standalone Comps screen and Completed Card entry;
- grouping/ranking and 30+30 local reveal;
- public placement;
- grade immutability;
- optional/no-gate behavior;
- no-shipping display/storage/arithmetic decision.

## 6.1 Exact provider request

One request per Comps run:

```text
GET https://api.sold-comps.com/v1/scrape
Authorization: Bearer <SOLDCOMPS_API_KEY>

keyword=<authoritative identity query> PSA <mapped whole grade>
ebaySite=ebay.com
count=240
page=1
```

Pass **nothing else**.

Rely on documented defaults:

- `sold=true`
- `sortOrder=endedRecently`
- `includeCompleteListing=true`

Always `page=1`. Ignore `hasNextPage`. Never paginate.

Do not use:

- Max Mode;
- category endpoint;
- RapidAPI channel;
- active/sold=false mode;
- provider retry/backoff;
- polling;
- automatic retry;
- hidden query widening;
- a second request;
- a fallback supplier;
- dual-provider abstractions.

Keep the 45-second provider deadline and 60-second route limit unchanged.

## 6.2 Query invariant and the resolved `#41` owner decision

The owner-approved supplier memo originally called this no-hash string the **exact** contract query:

`2025 PANINI PHOENIX JALEN HURTS THUNDERBIRDS SILVER 41 PSA 9`

The same memo locks the existing authoritative query builder as unchanged. That builder produces:

`2025 PANINI PHOENIX JALEN HURTS THUNDERBIRDS SILVER #41 PSA 9`

On 2026-08-08, Mark explicitly selected the builder output with `#41` as the exact SoldComps contract query:

`2025 PANINI PHOENIX JALEN HURTS THUNDERBIRDS SILVER #41 PSA 9`

This owner decision preserves the unchanged authoritative builder. It supersedes the supplier memo's literal no-hash string for this contract, focused tests, and Production acceptance; it does not authorize a hidden SoldComps-only query variant or any broader query-builder change. The selected query is exactly `61` UTF-8 bytes with SHA-256 `c499160625eb8519e4e7e2db58fd9c1ff49a52fa00bc2c860b5d4dbad64c572c`.

## 6.3 Field mapping

Map only the owner-approved supplier facts into the existing bounded snapshot:

- `soldPrice` → current price evidence/cents
- `soldCurrency` → currency
- `endedAt` → sold date
- `url` → listing link
- `thumbnailUrl` → image
- `title` → title
- `bestOfferAccepted` → selectability only

Use the owner-approved `thumbnailUrl`; do not silently switch to the derived `fullResThumbnailUrl`.

The snapshot shape is locked and must not gain fields or require a schema change. The existing snapshot already requires a stable candidate `id` and already supports optional `condition`:

- consume SoldComps `itemId` only if needed to populate that unchanged stable `id`; do not add `itemId` as a new persisted snapshot field;
- preserve `condition` only if SoldComps supplies it and only through the already-existing optional `condition` field;
- `listingType`, if observed during the one contract request, is diagnostic only and must not become persisted behavior;
- normalize `bestOfferAccepted` through the existing selectability/price/reason representation needed to keep the row visible but unselectable; do not add a new snapshot field or database column.

Do not persist the raw supplier payload, shipping, seller data, feedback, location, category metadata, provider request IDs, quota headers, or unused fields.

## 6.4 Exact selectability rule

A result is selectable only when:

```text
soldPrice is present
AND soldCurrency === "USD"
AND bestOfferAccepted === false
```

- `bestOfferAccepted=true`: row remains visible and unselectable, with a short note that the displayed price is an upper bound because eBay does not disclose the accepted offer amount.
- Non-USD: visible and unselectable.
- Missing/unparseable/unsafe price: visible if the row is otherwise safe, but unselectable.
- No shipping display and no shipping arithmetic.
- No SerpAPI-era ambiguous-price recursive heuristic. Use the explicit SoldComps facts.

## 6.5 Delete obsolete SerpAPI code

Delete rather than retain:

- SerpAPI endpoint/client/request construction;
- SerpAPI response/status/no-result handling;
- `_sop`, `_pgn`, `_ipg`, `show_only`, `_blrs`, engine/domain parameters;
- SerpAPI pagination/retry/continuation logic;
- SerpAPI sponsored-tile parsing;
- `?iid=` URL reconstruction specific to SerpAPI;
- invented/missing-date guards specific to SerpAPI’s shape;
- SerpAPI-specific error names/messages/tests;
- dormant fallback/provider-switch code.

Keep general fail-closed parsing and bounds for malformed numbers, dates, currency, URLs, oversized payloads, credentials, network failure, and timeout. Do not confuse deleting provider-specific code with deleting basic input/security validation.

Net lines should be negative or close to it. If the change introduces a provider framework or generalized multi-provider interface, stop and simplify.

## 6.6 Error behavior

- `429`, `502`, `503` → admin message: `eBay sold comps are temporarily unavailable.` Existing manual button is the only retry.
- `403` → `Monthly comps quota reached.` This means upgrade or wait; not an automatic retry.
- `401` → record a sanitized configuration error; show the temporary-unavailable message to the admin.
- Other network/provider/malformed-response failures → fail closed with the temporary-unavailable message and sanitized internal signal.
- Never log the Authorization header/key or raw supplier response.

---

# 7. SoldComps credential and contract-test gate

Signup: `https://sold-comps.com/signup`

The key starts with `sc_` and must become the server-only Vercel environment variable:

`SOLDCOMPS_API_KEY`

At handoff creation:

- Mark had not yet provided/configured the SoldComps key.
- `SERPAPI_KEY` was still configured in Vercel.
- The SerpAPI key had already been rotated in the prior work.
- The SerpAPI subscription had not been cancelled.
- `RUN_DB_MIGRATIONS=false`.

Current credential truth as of 2026-08-08:

- Mark added `SOLDCOMPS_API_KEY` as a Sensitive Production/Preview Vercel variable and redeployed the unchanged Production source successfully.
- The obsolete wrong-name `Ten_Kings_Sold_Comps_V2` Sensitive variable is still present and must be removed only after the released adapter passes Production acceptance.
- Vercel does not reveal or export the Sensitive value; it was never printed, logged, committed, or pasted into chat.
- `SERPAPI_KEY` is still required by unrelated live application paths listed in Section 9 and must not be removed globally as part of the V2 Comps adapter release.

Do not ask Mark to paste the key in chat. Use a secure authenticated dashboard/Vercel workflow and never print the value. Follow the session-log environment-change rules.

### Public-document contradictions to verify, not redesign around

SoldComps public homepage, rendered docs, and machine OpenAPI have conflicting free/paid quotas, rate limits, and quota status codes. Mark and Fable have locked SoldComps as the supplier, but the authenticated dashboard and actual response headers remain the authority for current quota/cost facts.

Do not promise `100 free requests`, `60/min`, or `$9/2,000` as verified until the authenticated account shows it. This does not reopen the supplier selection; it is an operational fact check.

Inspect authenticated quota/account facts without making another `/v1/scrape` request. The one exact contract call below is the only authorized SoldComps provider request before implementation.

### Contract test — passed; do not repeat without new owner approval

The credential and contract gates passed on 2026-08-08. Exactly one isolated zero-write request used the Section 6.2 query and only the Section 6.1 fields. It returned HTTP 200 in 12,577ms with JSON, 200 items, `hasNextPage=false`, and the approved field types on all 200 rows. Two returned `/itm/` pages visibly confirmed sold/ended eBay listings. Authenticated evidence showed the Basic plan at 1/100 requests used and 99 remaining, resetting September 8. The isolated Preview deployment and local probe workspace were removed. Do not repeat this pre-release contract request without new owner approval.

The request must use only the exact request fields from Section 6.1. No retry and no second request.

Capture sanitized evidence only:

- HTTP status;
- wall-clock latency;
- content type and bounded response size;
- usage/rate/quota headers with no credentials;
- result count and `hasNextPage` only as evidence (never paginate);
- presence/types of the approved mapped facts: `soldPrice`, `soldCurrency`, `endedAt`, `url`, `thumbnailUrl`, `title`, and `bestOfferAccepted`;
- whether `itemId` exists and is usable solely for the unchanged candidate-ID requirement;
- whether optional `condition` and diagnostic-only `listingType` are present, without authorizing either as new persisted state;
- count of missing/invalid required facts;
- count of USD-selectable rows;
- count of Best Offer upper-bound rows;
- count of non-USD rows;
- query byte length and SHA-256 rather than any secret.

Open two or three returned `/itm/` URLs in a real browser and verify they are genuinely ended/sold listings as far as eBay visibly permits. Do not alter account/listing state.

Contract gate:

- If page-1 results are empty, structurally wrong, not genuinely sold, missing sold dates, unsafe, or otherwise fail the approved fields, stop and report to Mark before integration code.
- Do not widen the query, call a broad control query, paginate, retry, or switch provider without Mark’s approval.
- If the exact contract passes, continue with the adapter implementation under the already approved execution order.

---

# 8. SoldComps implementation and test requirements

Primary expected code surface:

- `packages/ebay-sold-comps-v2/src/index.ts`
- `packages/ebay-sold-comps-v2/tests/index.test.js`
- `packages/ebay-sold-comps-v2/README.md`
- `frontend/nextjs-app/lib/server/compsV2.ts`
- `frontend/nextjs-app/pages/api/v2/admin/comps/[...action].ts`

Preserve valuable UI behavior already in:

- `frontend/nextjs-app/pages/admin/comps.tsx`
- `frontend/nextjs-app/lib/compsV2Ui.ts`
- `frontend/nextjs-app/tests/compsV2.test.ts`

Add/adjust focused tests that prove:

1. Exact request URL and only `keyword`, `ebaySite=ebay.com`, `count=240`, `page=1`.
2. Bearer auth is server-only and absent from results/errors/logs.
3. One provider request per search.
4. Page always 1; `hasNextPage` never triggers another request.
5. No retry/backoff/polling/fallback.
6. `soldPrice` + USD + `bestOfferAccepted=false` is selectable.
7. Best Offer is visible/unselectable with upper-bound explanation.
8. Non-USD is visible/unselectable.
9. `endedAt` maps to the existing sold-date format without invention.
10. `url`, `thumbnailUrl`, and `title` map safely; `itemId` is used only if the unchanged stable candidate-ID contract needs it, and no new snapshot field/schema is introduced.
11. Supplier error statuses map exactly as approved.
12. Decimal mapping remains one function; `9.2→9`, `9.5→9`, `9.6→10`.
13. Card-bound query contains `PSA 9` and never contains `9.2` or TK grade text.
14. Authoritative card mode ignores client query overrides.
15. Automatic search fires once for the selected permanent card.
16. `Fetch 30 More` remains local-only and retains selection/public state.
17. `$100/$110/$90` selected exact sold prices average to `$100`.
18. Grade, subgrades, certificate, defects, and report evidence remain immutable.
19. Public comps render only when enabled, only selected rows render, they remain below the full report, and absent/disabled comps render completely blank.
20. No shipping field appears in the saved snapshot, admin display, public display, or average.

Delete obsolete SerpAPI-only tests instead of weakening them into source-string assertions. Prefer executable behavior tests. Source assertions may only prove critical wiring when a real behavior seam already has executable coverage.

### Required independent validation before release

Use repository-required Node 20. At minimum rerun:

```bash
export PATH='/opt/homebrew/opt/node@20/bin':$PATH
pnpm --filter @tenkings/ebay-sold-comps-v2 test
pnpm --filter @tenkings/database build
pnpm --filter @tenkings/nextjs-app exec tsx --test tests/compsV2.test.ts
pnpm --filter @tenkings/nextjs-app exec eslint \
  lib/compsV2Ui.ts \
  lib/server/compsV2.ts \
  pages/admin/comps.tsx \
  'pages/api/v2/admin/comps/[...action].ts' \
  tests/compsV2.test.ts \
  --max-warnings=0
git diff --check
RUN_DB_MIGRATIONS=false pnpm vercel:build
```

Run any additional exact package/repository checks required by the current code and runbooks. Do not call unrelated pre-existing warnings new success or new failure; report them accurately.

Fresh critic must inspect actual code/diff and return explicit GO. Root then reruns the critical stack independently.

---

# 9. SoldComps release and Production acceptance

No Prisma schema change or migration is expected or authorized. `RUN_DB_MIGRATIONS` remains false.

Release only through a normal reviewed branch/PR:

1. Append planned release action to `SESSION_LOG.md`.
2. Commit the exact reviewed change.
3. Push normally.
4. Open a non-draft PR.
5. Wait for every emitted GitHub and Vercel Preview check on the exact head.
6. Do not bypass failures/reviews.
7. Merge normally only after exact-head checks pass.
8. Verify Vercel Production is Ready/Current on the exact merge commit.

Before the real-browser run, inspect read-only whether TKH-000700 already has a saved Comps snapshot. If it does, do not delete, clear, overwrite, or alter Production data merely to force the automatic-search test. Stop and obtain Mark’s approval for a non-destructive acceptance path, such as another eligible real card with no snapshot.

Full real-browser Production acceptance on TKH-000700, or on the owner-approved non-destructive acceptance card if TKH-000700 already has a snapshot:

1. Open Completed Card.
2. Confirm the `Comps` button opens the exact permanent card, already selected.
3. Confirm one automatic SoldComps request fires without an extra search click.
4. Confirm the exact authoritative query and `TK 9.2 — comping against PSA 9` display.
5. Confirm real sold listings render with images, exact public prices, dates, and working listing links.
6. Confirm Best Offer/non-USD rows are visible but unselectable.
7. Select trustworthy comps and confirm market value.
8. If suitable exact rows exist, verify `$100/$110/$90 → $100`; do not manufacture values or select false matches merely to hit the example.
9. Prove the grade record is byte-identical before/after.
10. Return to the same Completed Card successfully.
11. Verify public-off state is completely blank.
12. If enabled for trustworthy selected comps, verify graded-card image, large bright-green average, and selected comp rows appear below the full graded report, each linking to the real sold listing.
13. Double-click/retry/refresh abuse creates no duplicate cards, events, or comp snapshots.

After successful acceptance only:

- remove only the obsolete wrong-name `Ten_Kings_Sold_Comps_V2` Vercel variable after confirming the correctly named credential works in Production;
- verify Comps V2 has no SerpAPI reference or dormant fallback credential dependency;
- do **not** globally remove `SERPAPI_KEY` or cancel the SerpAPI subscription in this release: current source evidence shows unrelated live consumers in `referenceSeed.ts`, `aiGraderProductionApi.ts`, `kingsreviewEbayComps.ts`, `kingsreviewReferenceLearning.ts`, variant-seeding scripts, and the backend Bytebot sold-comps path. Any global cleanup requires a separately approved scope reconciliation;
- append exact cleanup evidence without exposing secrets;
- report the final simple Comps workflow to Mark.

If cleanup/cancellation requires a fresh provider or billing login, use Mark’s authenticated session and do not expose credentials.

### Production acceptance result — 2026-08-08

- The completed-card `Open Sold Comps` link opened the exact permanent TKH-000700 card and one automatic search ran without an extra click.
- The released page showed the exact locked 61-byte query, `TK 9.2 — comping against PSA 9`, and 60 saved candidates from one provider call. SoldComps usage moved from 1/100 to 2/100; local `Fetch 30 More` changed only 30 visible rows to 60 and usage remained 2/100.
- All 60 visible candidates had approved eBay image hosts. Twenty-three Best Offer/unsafe rows were disabled; Best Offer rows visibly retained exact upper-bound amount/currency evidence in the existing reason. A returned eBay link opened the matching sold listing with the sold banner, title, date, and `$29.99` price.
- No retained candidate matched Jalen Hurts + Thunderbirds + card #41 together. No false row was selected, no market value was confirmed, and public comps remained off/blank. Reloading the card showed `Saved sold-comps snapshot loaded.` without another provider call.
- The stable rendered grade summary was byte-identical before/after (`588` bytes; SHA-256 `8e04569b01a95036497bed08cc5731e2d9897decaa21436a4ec88007be68d4e4`), and the completed-card return path remained correct.
- The obsolete wrong-name Vercel variable `Ten_Kings_Sold_Comps_V2` was deleted only after this acceptance. The Sensitive Production/Preview `SOLDCOMPS_API_KEY` remains present. Global `SERPAPI_KEY`, `RUN_DB_MIGRATIONS`, subscriptions, NFC/Dell, V1, and every unrelated environment setting were unchanged.

---

# 10. NFC V2 — live state and locked invariants

NFC hosted/admin software is already live. Physical commissioning is not complete.

Production has truthfully shown:

- `HOSTED OFF`
- `WORKSTATION OFF`
- `GOTOTAGS OFF`

This means:

- `TEN_KINGS_V2_NFC_PROGRAMMING_ENABLED=false`;
- the observed browser was not the commissioned Dell helper profile;
- helper/GoToTags was not active;
- no physical V2 write was attempted.

Do not call NFC Production-ready until the real Dell commissioning passes.

### Exact live code paths

- Completed-card link: `frontend/nextjs-app/pages/admin/ai-grader-v2/completed/[sessionId].tsx`
- Standalone NFC UI: `frontend/nextjs-app/pages/admin/nfc.tsx`
- Hosted API: `frontend/nextjs-app/pages/api/v2/admin/nfc/[...action].ts`
- Hosted service: `frontend/nextjs-app/lib/server/tenKingsV2NfcHosted.ts`
- Protocol: `frontend/nextjs-app/lib/server/tenKingsV2NfcProtocol.ts`
- Browser/helper client: `frontend/nextjs-app/lib/aiGraderNfcHelperClient.ts`
- Helper package: `packages/ai-grader-nfc-helper/`
- NFC scripts: `scripts/ai-grader-nfc/`

### Launch hardware/software

- Dell Windows workstation
- ACS ACR1552U reader/writer
- FEIJU F8215 tags
- GoToTags Desktop `4.37.0.1`
- Reviewed helper V4

No NTAG215 launch path. No second workstation installation now. The protocol remains workstation-neutral so later Windows stations can each use their own reader, helper, protected key, allowlisted public identity, and supervised acceptance tag.

### Optional informational facts only

Only these three existing fields record a successful choice to tag:

- `nfcVerifiedAt`
- `nfcVerifiedByAdminId`
- `nfcVerifiedByWorkstationId`

They never gate anything. Do not add an NFC table, tag inventory, UID history, failed-tag row, replacement-token history, CardAsset/Item link, ownership/authenticity claim, or V1 dual write.

---

# 11. Exact Completed Card → NFC workflow

1. Completed detail shows `Open NFC →` only for a non-VOID permanent card.
2. `/admin/nfc?card=<permanentCard.id>` preselects the exact card and stable `/c/tk2c_...` URL.
3. The browser action must run on the Windows workstation physically attached to its own reader/helper; opening the page elsewhere does not remote-control the Dell.
4. The page verifies hosted/helper/GoToTags/readiness and in-flight recovery before issuing a job.
5. Operator confirms one fresh unused F8215 is not on the reader, then prepares.
6. Hosted server issues one short-lived signed job bound to exact card ID, token, URL, expiry, nonce, profile, and workstation contract.
7. Browser persists the exact pointer before calling the loopback helper.
8. Helper verifies server signature/trust, expiry, domain, exact card/token/URL, F8215 profile, capability, and one-operation safety gate.
9. Operator clicks GoToTags `Start Encoding` once, then places the fresh tag.
10. GoToTags writes, reads back, and permanently locks the exact URL.
11. Helper signs the verified terminal result using the workstation’s non-exportable key.
12. Hosted server verifies original job, workstation allowlist, exact URL readback, profile, and permanent lock.
13. Existing single write path sets the three informational NFC facts.
14. Replay is idempotent and cannot move a token to another card.

Failure:

- Show `NFC tag failed. Remove and discard it, then try a new tag.`
- End local operation, remove/discard the uncertain tag, and retry the same permanent URL on a fresh tag.
- No failed-tag DB row.

Known protocol facts:

- Loopback: `http://127.0.0.1:47662`
- Helper: `tenkings-ai-grader-nfc-helper-v4`
- Loopback protocol: `tenkings-ai-grader-nfc-loopback-v2`
- Capability: `ten-kings-v2-f8215-static-url-v1`
- Maximum job TTL: 15 minutes; default 10 minutes

---

# 12. NFC keys/environment — never expose values

- Workstation allowlist: `AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_JSON`
- Production server signer: `TEN_KINGS_V2_NFC_JOB_SIGNING_PRIVATE_KEY_PKCS8_BASE64`
- Programming gate: `TEN_KINGS_V2_NFC_PROGRAMMING_ENABLED=false`
- Optional rotation trust: `TEN_KINGS_V2_NFC_JOB_PRIOR_PUBLIC_KEYS_JSON`
- Public server-key record: `docs/handoffs/TEN_KINGS_V2_NFC_SERVER_PUBLIC_KEY.json`
- Recorded public key ID: `5e0685a5d6e1f481715fb886be6afefe7c01c7946c5fe56cdff0cb70c4c998d7`

The public-key record explicitly says it is not authorized on the Dell until Windows acceptance and V3→V4 transition. Never copy workstation private keys between computers.

Old V1 flags such as `AI_GRADER_NFC_REQUIRED` and `AI_GRADER_NFC_PROGRAMMING_ENABLED` are not V2 authority. Do not reintroduce an NFC gate.

---

# 13. Preserved Dell V1 terminal-job incident — hard stop

The Dell contains or may contain a preserved terminal F8215 job with contradictory prior source/runtime evidence. A wrong/used tag was reportedly quarantined and a public link inactive, but current installed state is not authoritative.

Before exact evidence and Mark approval, do not:

- install/update/restart helper;
- acknowledge/retry/resolve a job;
- alter helper config or trust;
- change a Scheduled Task;
- launch GoToTags;
- touch the ACR1552U reader or any tag;
- enable hosted programming;
- run a resolver.

Candidate bounded resolvers, selected only after the read-only evidence:

- `scripts/ai-grader-nfc/resolve-ai-grader-nfc-abandoned-job.ps1`
- `scripts/ai-grader-nfc/recover-ai-grader-nfc-f8215-stuck-job.ps1`

One legacy resolver may require the exact physical confirmation:

`I removed and quarantined the exact NFC tag used for this F8215 attempt.`

Do not assume that resolver or confirmation applies until preflight proves it.

---

# 14. NFC precise next action and owner approvals

Nothing physical should happen merely because this task starts.

When Mark says he is physically at the Dell, ask for this exact authorization:

> Approve a read-only Dell NFC exact-state preflight only; no restart, install, config/key change, job acknowledgment, GoToTags launch, reader/tag action, deploy, or env change.

Only after Mark approves, run the bounded read-only inspection and return:

- installed helper version/build/hash and config schema;
- protected config/token/pairing facts without secrets;
- task identity/state and safe DACL fingerprints;
- helper/GoToTags process/listener state without launching them;
- protected job/state/operation/audit artifacts;
- shared V1/V2 operation-gate state;
- workstation public-key identity;
- server trust/current-prior key IDs;
- shortcut/pairing preservation state;
- Smart Card and Certificate Propagation service state;
- reader/GoToTags readiness facts obtainable without touching hardware;
- exact evidence selecting or rejecting each bounded incident resolver.

Stop after the read-only report. Mark must review and separately approve resolution/transition.

---

# 15. NFC Windows and physical commissioning sequence

After Mark separately approves each material step:

1. Resolve the preserved V1 terminal incident with only the evidence-selected bounded resolver.
2. Verify the quarantined/uncertain tag is removed and shared gate is idle.
3. Preserve config, token, pairing, CNG workstation identity, task, and trusted shortcut.
4. Install/transition to reviewed helper V4.
5. Run all seven previously skipped Windows C# groups:
   - protected V2 coordinator/recovery;
   - strict loopback HTTP lifecycle;
   - F8215 protected lifecycle/idempotency;
   - restart recovery;
   - expired/rejected-callback recovery;
   - loopback HTTP boundary;
   - Windows CNG runtime safety.
6. Run both PowerShell suites:
   - `scripts/ai-grader-nfc/tests/test-ai-grader-nfc-maintenance.ps1`
   - `scripts/ai-grader-nfc/tests/test-ai-grader-nfc-versioned-update.ps1`
7. Verify DACLs, Scheduled Task, transition journal/rollback, server public trust, workstation allowlist, helper version/protocol/capability, loopback, and idle gate.
8. Transition script if evidence authorizes it: `scripts/ai-grader-nfc/transition-ai-grader-nfc-v3-to-v4.ps1`.
9. Verify exact GoToTags publisher/hash/version/template, authenticated account/internet/credits, ACR1552U, and Windows services.
10. Resolve the documented programming-flag sequencing ambiguity explicitly. Never silently turn it on. Use the smallest owner-approved commissioning window needed to issue the real job.
11. With Mark physically present, write one fresh F8215 to the exact TKH-000700 `/c/tk2c_...` URL.
12. Verify exact readback and permanent lock.
13. Remove/re-present/read the tag.
14. Attempt a rewrite and prove it fails.
15. Scan on an iPhone and at least one Android device; both must open the correct permanent V2 card.
16. Run failed-tag discard/retry acceptance: no verified fact, no failed-tag row, discard, same URL on a fresh tag.
17. Only after all evidence passes may routine Production programming be enabled/left enabled.

Expected Windows facts documented previously:

- Task: `TenKingsAiGraderNfcHelper`
- Config: `C:\TenKings\config\ai-grader-nfc\helper.json`
- V4 route: `https://collect.tenkings.co/admin/nfc`
- Transition journal: `C:\TenKings\config\ai-grader-nfc\v3-to-v4-transition-journal.json`

Historical facts are not current proof. Re-observe them.

### NFC done gate

NFC is commissioned only when:

- one fresh real F8215 is written on Dell;
- exact permanent URL readback passes;
- permanent lock passes;
- rewrite attempt fails;
- iPhone and Android open the correct permanent report;
- hosted informational facts are correct and idempotent;
- failure/discard/retry creates no trash record;
- V1 historical routes remain untouched;
- Mark accepts the result.

No second workstation is required.

---

# 16. Explicit do-not-build/do-not-change list

Do not add or alter:

- V1 CardAsset/Item writes or V1/V2 dual writes;
- V1 data migration/deletion;
- new card/media/NFC/comps tables;
- comp rows or raw provider payload persistence;
- mutable counters;
- comps/NFC status booleans or gates;
- comps influence on grades;
- automatic visual card matching;
- another comps microservice;
- dual supplier logic or fallback;
- automatic retries, polling, queues, workers, or caches for SoldComps;
- NFC tag inventory/UID tracking/failed-tag/replacement history;
- NFC ownership/authenticity/location claims;
- remote control of the Dell;
- another NFC cloud service;
- second workstation install now;
- auth, wallet, ledger, Stripe, Locations, Live Rip/Mux, object-storage, SAM, grading, label, or report redesign;
- inventory, packs, DIRECT, mystery-machine, buyback, shipping, vending, marketplace, trading, gifting, odds, or later platform phases.

Restraint is part of correctness.

---

# 17. Required owner-facing handoffs

Keep explanations short and concrete, but include evidence.

Before SoldComps integration:

- contract-test request shape;
- latency/status/result count;
- field coverage;
- 2–3 sold URL spot-checks;
- selectability facts;
- authenticated quota/cost evidence;
- pass/fail decision.

After Comps release:

- exact Completed Card → Comps workflow;
- what one provider call does;
- how Best Offer/non-USD behave;
- how selection/average/public display work;
- tests/PR/deploy evidence;
- grade immutability proof;
- SerpAPI cleanup evidence.

Before NFC physical action:

- exact read-only Dell state;
- preserved-job resolution choice;
- what requires Mark’s physical action/approval.

After NFC commissioning:

- exact Completed Card → NFC workflow;
- helper/GoToTags/readback/lock evidence;
- rewrite-failure and phone-scan results;
- failure/discard/retry result;
- whether routine programming is enabled;
- confirmation that NFC remains optional.

Do not claim “finished,” “live,” or “Production-ready” merely because a page returns 200, source strings exist, or software-only tests pass. Use the real done gates.

## END COPY/PASTE PROMPT FOR THE NEW CODEX AGENT
