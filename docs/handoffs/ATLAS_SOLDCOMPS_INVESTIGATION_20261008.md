# ATLAS SoldComps investigation — October 8, 2026

Scope: investigate and propose a resolution. No application code, production data, configuration, deployment, report approval or paid search changed. Evidence was gathered through current source inspection, read-only PostgreSQL transactions, immutable artifact reads, free provider account/history reads and offline tests.

## Conclusion

Two different problems are confirmed: final human approval never initiates a market lookup, and the recent manually initiated lookups succeeded at SoldComps but ATLAS removed all returned candidates. There is also a reproducible Pokémon variant-matching defect, plus a workflow that requires separate manual selection/publication and does not automatically rediscover saved previews.

This is not established as a missing key, disabled feature, provider outage or exhausted quota.

## Current production evidence

Observed October 8, 2026, approximately 5:53–5:57 p.m. America/Los_Angeles (October 9 00:53–00:57 UTC).

- Private application source: `5ce5b067e9bc6e352f4a4a81310bcaab62eedf3a`; running container prefix `4f1ec5def7dc`, image prefix `be46d90a26d4`, started 5:06 p.m. Pacific with zero restarts. Staff schema 75.
- Market, research, presentation, batch and catalog are enabled.
- SoldComps credential authenticated successfully to its free account APIs. Account usage: 670 of 10,000 requests; 9,330 remaining. No quota/configuration failure observed.
- Database: 9 human approvals and 9 published grading reports; 5 market requests across 4 cards, all READY; 5 approved cards without any market request.
- Zero report-presentation records: no sold references have been published through this feature.
- The original working directory is an old, dirty checkout at `8343958f`, with a preexisting conflicted SESSION_LOG. Source diagnosis instead used the clean current ATLAS worktree at `5ce5b067`. No existing changes/conflicts were resolved or discarded.

Runtime evidence supersedes the report-production context's earlier `19798` / schema 74 / pending `5ce5` checkpoint. That source was already serving during this investigation. Old key-missing checkpoints are also historical: the September 24 handoff records successful credential installation and a real transport check. Neither that check nor prior synthetic tests established the full automatic approval-to-comps workflow.

| Recent manual search, Pacific | SoldComps returned | Provider elapsed | ATLAS selectable | Saved exclusions |
| --- | ---: | ---: | ---: | --- |
| Magikarp, 2020 Rebel Clash 039/192 — 5:41:58 p.m. | 60 | 2.664 s | 0 | 38 unsupported/undisclosed; 22 contradictory |
| Snivy, 2013 Legendary Treasures — Radiant Collection RC1/RC25 — 5:46:24 p.m. | 60 | 18.768 s | 0 | 13 unsupported/undisclosed; 47 contradictory |
| Same Snivy — 5:53:37 p.m. | 60 | 8.882 s | 0 | 13 unsupported/undisclosed; 47 contradictory |

Provider request-history queries match the saved search-query hashes and report success for all three. In total, 180 returned listings became zero selectable ATLAS rows.

Historical saved previews establish partial functionality: Abomasnow had one eligible PSA 9 sale, and Jaxson Dart's shared-research preview had five eligible PSA 8/9/10 sales. Neither was published as a market presentation.

The direct adapter requests count 40. Current [SoldComps documentation](https://sold-comps.com/docs) says unsupported page sizes round up to 60/120/240; its history records 60 for the recent requests. This is not evidence of deployment drift. Provider documentation is itself marked as undergoing updates, so new transport qualification should verify the actual contract.

## Confirmed root causes

### 1. Approval and market search are disconnected

The approval transaction creates publication intent, and `afterApprove` calls only `publication.publish`. There is no market intent, market worker or automatic recovery/discovery wired to this event.

Source in the current ATLAS worktree:
- `packages/atlas-connected-manual/src/index.mjs:98,156`
- `packages/atlas-connected-manual/src/publication-repository.mjs:47`
- `packages/atlas-connected-manual/src/publication.mjs:58`

The UI explicitly says “Search on request” and “Manual search · no lookup starts automatically.” The current sequence is Review sold comps → Find sold cards → select listings → Publish references. This is an implemented manual workflow, not a broken automatic trigger.

- `frontend/atlas-app/components/CompletionNextSteps.jsx:24`
- `frontend/atlas-app/components/MarketReferencePicker.jsx:18,71`

### 2. ATLAS filters a broad identity search down to a much narrower display contract

The query omits target grade and grader. ATLAS then admits only recognized PSA/BGS/SGC/CGC graded sales with disclosed positive USD prices and acceptable variant matching. Raw sales, unsupported graders and unknown prices disappear. Accepted Best Offer prices are not hydrated in this adapter.

The requirement to retain honest sold prices is sound; the workflow problem is searching broadly, discarding results before the reviewer can inspect them, and presenting a generic empty result rather than explaining fetched versus eligible counts.

- `packages/atlas-connected-manual/src/presentation-market.mjs:15,33`
- `packages/atlas-report-view/src/sold-reference-projection.mjs:19`
- `frontend/atlas-app/components/MarketReferencePicker.jsx:41`

Basic previews store only eligible candidates and two broad exclusion totals. The exact historical rejected titles and per-reason breakdown were not retained. Therefore the investigation cannot determine how many of the “unsupported” rows were raw versus unknown price/grade, or how many contradictory exclusions were correct.

### 3. Pokémon variant matching has reproducible false positives

Both recent saved card inputs have `parallel: null`. The shared matcher normalizes null to empty and treats empty as confirmed base. It uses generic variant words including holo, black and white, without recognizing non-holo negation or Pokémon series context.

Offline reproduction using the actual saved identities:
- Exact Magikarp identity + PSA 9: MATCH.
- Same listing + “Non-Holo”: CONTRADICTORY.
- Exact Snivy identity + PSA 9: MATCH.
- Same listing + “Holo”: CONTRADICTORY.
- Same listing + “Pokémon Black & White”: CONTRADICTORY.

The Non-Holo case is a clear false positive. Series words can also be misread as parallel evidence. ATLAS hard-drops these contradictions, whereas the older Ten Kings comps UI retains ranked candidates for human review.

- `packages/ebay-sold-comps-v2/src/index.ts:129,156,274`
- `packages/atlas-connected-manual/src/presentation-market.mjs:34`

This defect is proven offline. The missing rejected historical titles prevent attributing a precise share of the live 22/47 exclusions to it.

### 4. Retrieval, rediscovery and publication are separate manual steps

A READY preview is not a published market section. Only selection commits a presentation. No estimate is calculated by this ATLAS projection.

The ordinary GET returns the committed presentation, not the latest saved search. Unpublished preview access requires its request ID and originating actor. The browser keeps that ID in sessionStorage; the component resets its visible preview on remount. A new session/device cannot simply discover the last saved result.

- `packages/atlas-connected-manual/src/presentation-market-service.mjs:49`
- `packages/atlas-connected-manual/src/presentation-repository.mjs:39,121`
- `frontend/atlas-app/lib/report-market-client.mjs:10,50`
- `frontend/atlas-app/components/ReportMarketPicker.jsx:15`

### 5. Shared engine does not mean shared automation

The older Ten Kings completed-card comps page automatically searches when opened without a snapshot, then persistently reloads the snapshot. Its pure SoldComps package is shared with ATLAS.

Newer Ten Kings Inventory research has the stronger behavior: an item-description transaction creates a durable job; a worker leases it, executes independently of the browser and persists completion/failure. The neutral research package imported into ATLAS contains engine logic, not this job orchestration. Its README also states that adoption of the neutral package by Inventory remains a separate release; the two applications do not yet consume one fully unified end-to-end research workflow.

ATLAS exposes two manually initiated paths: direct sold search and optional shared photo/research. Both run inside the HTTP workflow and share the native-work limiter.

- ATLAS: `packages/card-research-core/README.md:3,11,13`; `packages/atlas-connected-manual/src/index.mjs:67,90,93`; `research-service.mjs:105`.
- Ten Kings comparator checkout: `/Users/markthomas/tenkings/codex-main-site-release-20260916`.
- Comparator: `packages/database/src/cardPlatformV2.ts:1860`; `packages/database/src/staffInventoryResearchV2.ts:157`; `frontend/nextjs-app/lib/server/staffInventoryResearchWorker.ts:21`.

### Reliability gap found, but not the observed incident

For simple searches, a saved UNKNOWN or abandoned STARTED request is replayed as UNKNOWN/PENDING indefinitely; there is no reconciliation worker. “Check saved search” does not dispatch a new lookup. This can strand future failures, but all five observed live requests are READY, so it does not explain these recent empty results.

Current web proxy deadline is 210 seconds and API maximum is 240 seconds; there is no evidence here for an alleged 30-second proxy cause.

## Resolution plan

1. **Correct the search/result adapter first.** Distinguish missing/unknown parallel from explicitly confirmed base, recognize non-holo and Pokémon series vocabulary, and keep uncertain matches reviewable. Preserve real mismatch rejection and honest price eligibility. Add exact Magikarp/Snivy regressions and Ten Kings compatibility cases. Use a documented graded-sale query strategy across supported graders without claiming ATLAS/PSA equivalence. Persist fetched, eligible and excluded counts with specific reasons.

2. **Attach durable work to real human approval.** Save one idempotent intent bound to card, approval version and approved identity/report hash in the approval transaction. Dispatch immediately after the immutable publication is available. Use the existing ATLAS service and narrowly scoped durable worker/effect patterns; no separate comps microservice. Reconcile missing work after restarts. Approval retries must not buy duplicate searches; successful grade approval must not wait for SoldComps.

3. **Reuse the engine while preserving company boundaries.** Keep provider parsing/matching shared with Ten Kings and use its proven worker design as a reference. ATLAS owns its requests and report attachments; do not import Ten Kings inventory, financial writes or old workflow limits. Give market work its own appropriate bounded concurrency so it does not contend with image preparation unnecessarily.

4. **Make saved results the normal card view.** Expose latest approval-bound status and candidates through a server GET. Show Queued, Searching, Ready, No qualifying sales or Failed with a useful reason. Load results automatically after approval, on reload and across authorized sessions/devices. Retain Refresh as an optional action. Public report views never trigger paid searches.

5. **Keep automatic retrieval distinct from public valuation/publication.** The current request authorizes automatic retrieval after human approval. It does not by itself select an automatic valuation formula or make every marketplace result a certified comparison. Default plan: automatically fetch and save evidence; retain deliberate selection for public references, with clear saved/published state. If automatic public matching is later desired, define its acceptance rule explicitly.

6. **Repair recovery and qualify end to end.** Persist safe provider diagnostics and response evidence before transformation. Resume local processing from retained responses, retry definitive temporary refusals with bounded backoff, and reconcile ambiguous dispatches before any new paid request. Test ordinary and rapid approval, browser closure, worker restart, duplicate approval, provider refusal/timeout, zero eligible rows and cross-session saved-result access. Assert unchanged grade/report bytes and Ten Kings behavior.

7. **Recover existing approved cards deliberately.** Produce a fresh inventory of active approvals with no usable result; exclude retired/superseded reports. Reuse useful saved previews and distinguish stale previews from missing work. The observed census has five approvals with no request and two recently searched cards with empty results; do not blindly charge for a rerun of every historical record. Run a small sports/Pokémon acceptance set, then enable every new approval.

Target experience: approve the card once → comps work is durably queued immediately → results appear automatically as the provider responds. “Immediately triggered” does not mean the external search completes instantly; the recent successful provider calls took roughly 3–19 seconds.

## Verification and evidence

- 15 existing focused market/projection/service tests passed.
- Offline parser-to-ATLAS reproduction confirmed that raw, undisclosed Best Offer and non-USD examples can produce READY with zero selectable rows; recognized disclosed graded USD evidence survives.
- Six targeted Pokémon matching assertions reproduced the issues above.
- No new paid scrape, card approval, selection/publication or production mutation was performed.

Current-source worktree: `/Users/markthomas/.codex/worktrees/atlas-report-production/ten-kings-mystery-packs-clean`.

Sanitized runtime receipts: `/Users/markthomas/.codex/atlas-handoffs/atlas-soldcomps-investigation-20261008/`:
- `runtime.json`
- `market-census.json`
- `market-previews.json`
- `provider-history.json`

Relevant historical handoffs: `docs/atlas/plans/DEALER_MARKET_ACTIVATION_20260923.md`, `docs/atlas/handoffs/2026-09-24-fresh-ultra-lead.md`, `docs/atlas/plans/SHARED_CARD_ENGINES_DISCUSSION.md`, `docs/handoffs/TEN_KINGS_COMPS_NFC_NEW_CODEX_HANDOFF.md`, and the September 22–24 market/research SESSION_LOG entries in the current-source worktree.
