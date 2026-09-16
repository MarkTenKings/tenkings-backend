# Add Inventory access, admin replacement and main-domain review

Date: September 16, 2026 (America/Los_Angeles).

Status: investigation and proposed direction only. No domain, navigation, application, database or production configuration changed. Mark requested two Astra Extra High reviewers; both `gpt-6-astra` / `xhigh` reviewers inspected the approved blueprint and separate admin/dependency and hosting/domain scopes. Source presence establishes implemented dependencies, not current operator usage. No authenticated staff usage-log audit or new end-to-end business transaction was performed.

## Access Add Inventory today

Open **https://collect.tenkings.co/admin/physical-inventory**, sign in with an authorized staff/admin account, and select **Add inventory**. From the collect home menu, choose **Inventory**; the admin home also has an **Inventory** tile.

The similarly named **Add Cards** (`/admin/uploads`) and **Card Catalog** (`/admin/inventory`) are different older workflows. The new workspace defaults to staff mode and already hides the old global header/footer. Its own links include Inventory, Locations, Advanced records and Admin home; the last link returns to the broader older console. Advanced records still provides purchased-lot/batch and exact permanent-card evidence tools.

The direct production route was checked unsigned and returned the expected “Sign in to physical inventory” page. No login/SMS or inventory write was performed in this review. The serving application remains the earlier `38c95335` release on READY deployment `dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj`; new local research commits are not deployed.

Source: [navigation](../../frontend/nextjs-app/components/AppShell.tsx), [admin tiles](../../frontend/nextjs-app/pages/admin/index.tsx), [entry point](../../frontend/nextjs-app/pages/admin/physical-inventory.tsx), [staff workspace](../../frontend/nextjs-app/components/admin/StaffInventoryWorkspace.tsx).

## Has Add Inventory replaced the old admin platform?

**No. It supplies the new daily inventory workflow, while the wider grading, packing, commerce and customer platform is only partly rebuilt.** The checked navigation/dependency files match the serving source and current local candidate; subsequent research work does not constitute the rest of the platform replacement.

| Capability | Evidence-based assessment |
| --- | --- |
| Front/back capture, recognition, cost, planned sales channel and save/next card | Implemented in the new staff workflow. Old upload still creates a separate legacy CardAsset record. |
| Individual and bulk stock, saved descriptions, costs, expected prices, custody and stock history | Implemented in the new inventory journal. Expected profit is not realized accounting; adding stock is not completing grading. |
| Locations, planned moves and loading/count records | New controls reuse existing Location records; new location creation still calls the existing admin API. |
| Background variant/comps research | New private research exists. The current improved candidate remains local; this is not every function of KingsReview or grading comps. |
| Old Card Catalog and Assigned Locations | Still operate on legacy CardAsset, InventoryBatch and PackDefinition records. No complete record/workflow replacement established. |
| Pack types, commercial pack assignment, physical packing/scanning and label printing | Separate capabilities remain. Recording stock as packed or loaded is not a replacement commercial pack platform. |
| Grading, grade labels, permanent report/card creation and NFC | Separate workflows remain. Add Inventory creates inventory bookkeeping records, not a completed graded permanent card. |
| Set Ops, checklist publication and variant QA | Still used. New research reads approved SetOps card, parallel, scope and source records directly. |
| Live Rips, kiosk controls, Golden Tickets and Stocker operations | Separate systems remain; the approved blueprint explicitly reuses several of them. |
| Customer collection, shipping, wallet/buyback and existing customer links | Not replaced by Add Inventory; rights and historical data must remain accessible. |
| Financial Story | New read-only inventory readers exist; they do not replace payment or wallet accounting. |

Concrete sources:

- [Staff inventory commands](../../packages/database/src/staffInventoryV2.ts) and [sole V2 writer](../../packages/database/src/cardPlatformV2.ts).
- [Workspace Location reads](../../frontend/nextjs-app/pages/api/v2/admin/inventory/workspace.ts), [existing location writer](../../frontend/nextjs-app/pages/api/admin/locations/index.ts).
- [Legacy assignment writer](../../frontend/nextjs-app/pages/api/admin/inventory/assign.ts), [pack-type writer](../../frontend/nextjs-app/pages/api/admin/pack-types/index.ts), [packing UI](../../frontend/nextjs-app/pages/admin/packing.tsx).
- [Approved SetOps research reader](../../frontend/nextjs-app/lib/server/staffInventoryResearchReferences.ts).
- [Collection reader](../../frontend/nextjs-app/pages/api/collection/index.ts), [shipping request](../../frontend/nextjs-app/pages/api/collection/[itemId]/shipping-request.ts), [wallet reader](../../frontend/nextjs-app/pages/api/wallet/me.ts).

The source schema has physical/workflow journals and CollectibleCardV2, but no PackV2, PackTypeV2 or ShipmentV2 models. The current collection API reads legacy Item records. These are specific reasons not to infer full V2 completion from the new intake interface.

Removing a navigation tile and retiring its underlying capability are separate changes. A focused staff home can show only approved new tools while retaining specialist/legacy access. Actual endpoint/service retirement needs a per-capability replacement and consumer audit. The blueprint preserves V1 customer rights, permanent URLs, saved playback and accounting; new V1 creation freezes only after proven V2 replacement and an approved cutover.

## Main-domain findings

- **tenkings.co is occupied:** it redirects to **www.tenkings.co**, a live Wix marketing site. Its sitemap includes the homepage, `/mike-fink`, `/contact`, `/work-with-me`, `/blank` and `/blog`. These need an explicit keep/replace/redirect decision before replacement.
- **collect.tenkings.co** serves the Next.js/Vercel application.
- Public DNS uses Wix nameservers and Google mail records. A future web cutover should preserve mail and other subdomain records; it does not require replacing all nameservers.
- Existing authentication uses phone/Twilio and Turnstile. The auth service source defaults to one expected hostname, `collect.tenkings.co`, and validates exact hostname equality. The actual deployed setting was not extracted. A new origin requires deliberate widget and server hostname support while preserving collect login.
- Sessions and pending browser work are origin-local. A main-domain move will not automatically transfer the collect login or unsent/retry state. Preserve the old origin while pending saves are reconciled; never copy or discard outstanding commands casually.
- An unsigned cross-origin OPTIONS probe to the inventory workspace returned 401 without CORS headers. Direct browser calls from a separate main-domain frontend to existing collect staff APIs are not currently a demonstrated integration. Prefer same-origin approved API routing to existing services, or implement a deliberately scoped cross-origin contract.
- Staff photos use authenticated same-origin requests, server processing and existing private object storage. A new shell must preserve private signed reads, cache controls and current authorization. It should not introduce a second photo or stock authority.
- Existing permanent card/NFC URLs and helper assumptions use collect. The blueprint's canonical V2 card URL remains `https://collect.tenkings.co/c/<tk2c_token>`. Keep these valid through the initial transition.
- Shared site-base configuration also generates pack/kiosk QR and Live Rip claim/watch links. Do not globally replace that configuration during a staff-site move. Installed NFC helpers have their own host assumptions.
- The app configuration schedules the inventory research cron every minute. A second UI deployment must not accidentally create a second scheduled execution owner. Prefer the first new shell and explicit host/path routing within the existing application/monorepo.
- Verify browser Maps-key restrictions for the new origin. Payment/dashboard callbacks and direct-upload/hardware configuration need separate qualification when those capabilities move; they were not inspected here. Public `/terms` and `/privacy` currently resolve to Wix 404 pages, so legal-page content belongs in the website content audit.

Sources: [public main site](https://tenkings.co), [page sitemap](https://www.tenkings.co/pages-sitemap.xml), [session storage](../../frontend/nextjs-app/hooks/useSession.tsx), [auth service](../../backend/auth-service/src/index.ts), [Turnstile validation](../../backend/auth-service/src/turnstile.ts), [photo API](../../frontend/nextjs-app/pages/api/v2/admin/inventory/photo.ts), [deployment schedules](../../frontend/nextjs-app/vercel.json), [NFC protocol](../../frontend/nextjs-app/lib/server/tenKingsV2NfcProtocol.ts), [approved blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md).

## Recommended direction

Build a focused new consumer/staff interface under **tenkings.co**, with a role-controlled staff section such as `/staff` and `/staff/inventory`. These are proposed routes, not links that work today. The final apex-versus-www convention is a cutover decision.

Reuse the proven Add Inventory components and existing canonical services/writers. A clean website does not require duplicate databases, a second catalog, or rewriting working authentication, storage and financial history. Merely adding a domain alias to the current app would expose the same old routes and would not accomplish the desired separation.

Keep **collect.tenkings.co** serving required legacy/customer links and specialist tools while features transition individually. Preserve existing permanent card URLs even if the main browsing experience later moves. Atlas keeps its separate app, source ownership and release process while both apps adopt one reviewed catalog and compatible recognition/research tools.

Suggested sequence:

1. Record the owner-approved website/domain transition in the canonical blueprint when the proposal becomes an implementation decision; this investigation does not silently amend it.
2. Inventory Wix pages/assets/SEO redirects and actual legacy workflow consumers. Classify each capability as reuse, replace, keep read-only or retire later.
3. Build a preview of the clean consumer/staff shell; reuse the current Inventory flow through approved same-origin APIs and existing sole writers.
4. Verify authentication, roles, Turnstile, origins/callbacks, private photos, retry recovery, Financial Story and protected Add Inventory timings. Reconcile pending browser commands before switching normal staff entry.
5. Make a separately reviewable web DNS/cutover plan with email/subdomain preservation, old-link checks and rollback. Publish only after acceptance.
6. Expand the new site feature by feature. Hide legacy clutter in normal navigation before considering service retirement; retire only after replacements and required consumers are proven.

No current domain move or old-system retirement is implemented by this report.

## Updated variant/comps plan: what actually happened

The quoted “No application code or live behavior changed during this review” was true **at review time**. Mark then approved implementation after Atlas coordination. That first implementation exists in two local commits:

- `b89cb020bde7e538142b26e69198fb992c526f36`: versioned recognition handoff and shared catalog evidence contract.
- `31b8653559d8553208de8591f2d30c419642953a`: private research rejection repairs, source/image diagnostics and bounded provider probe.

| Plan item | Built | Still pending |
| --- | --- | --- |
| Useful matching fixes sooner | Release/design-year, supported grading-label and descriptive sport-word fixes; meaningful wrong-year/product/grade controls preserved. | Release qualification and deployment; real-card outcome measurement. |
| Larger comp images | Provider-supplied larger primary image with bounded thumbnail fallback and diagnostic evidence. | Real provider image/sale-field qualification. Feature flag remains off. |
| One sports and one Pokémon set | Shared contract and synthetic category fixtures. | Actual source-backed sets, reviewed useful images, durable publication/proposal storage and app lookup adapters. |
| Verified reusable references | Full-manifest hashes, applicability, image/source lineage and publication boundary rules. | Operational authorized review/publication persistence and activation. |
| Inventory/Atlas sharing | Recognition package sent; Atlas independently checked hashes and passed 26 tests. | Atlas adoption/release and real evidence improving different cards in both directions. |
| Protect Add Inventory speed | No added awaited intake work; protected paths unchanged; functional concurrency tests pass. | Measured idle/saturated load comparison and real-phone acceptance. |
| Over 90% correct comps across all cards | Metrics/holdout plan. | Independent labeled evaluation of at least 200 cards and disclosed all-card results. |

Prior recorded verification: **303 tests passed** (252 staff/photo, 26 recognition, 25 catalog contract), scoped lint/types and normal migration-disabled production build passed, and all 80 stored research envelopes retained their canonical hashes. Full application type-check retains twelve pre-existing unrelated grader-test diagnostics. These are implementation/compatibility checks, not proof of 90% accuracy or measured unchanged phone latency. This documentation review did not rerun the application suite.

Already live from the earlier release: the quick Photos → Cost → Sales channel flow, Pokémon-specific recognition improvements, and slow-upload recovery using the original photo bytes. The newer research/catalog candidate is **not live**.

The original plan's stale “implementation has not started” header was corrected during this investigation. Frozen historical Ultra-review artifacts were not changed. See [updated plan](2026-09-15-variant-and-sold-comps-improvement.md) and [detailed implementation/remaining qualification](2026-09-16-inventory-research-implementation.md).
