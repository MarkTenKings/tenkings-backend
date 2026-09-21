# Main-site release record

## Current scope — September20 integrated Preview

The main-site branch now integrates the complete qualified Inventory candidate `e286ea0a190bfdc6807fe8ca58c47b34c94b55c1` through a normal merge. Every application, dependency, schema and configuration blob equals that Inventory commit; only documentation differs. The original smaller release described below is historical and no longer defines the candidate's runtime scope.

The clean site and all 21 site/diagnostic application/test files already matched Inventory. Integration preserves the existing main Preview origin, auth/widget setup and browser session; it requires no new host allowlist or shared-server mutation. Catalog, contributions, full-resolution images, sale details and provider diagnostic execution remain off; database migrations remain disabled. Existing cron ownership is unchanged.

The complete controlled 3,200-save timing comparison and separate default cron functional fixture pass; sports preparation UI/API and isolated PostgreSQL qualification also pass. Their exact scope and limits remain in the [updated plan](2026-09-15-variant-and-sold-comps-improvement.md). Qualify the merged exact-source hosted build and signed-in read; real phone capture/save/reopen and actual feature/accuracy acceptance remain separate. No DNS cutover or production promotion has occurred.

## Historical independent release scope

Base: serving web commit `38c95335614df756c420127e6b94bedd5620fa2d`.
The initial site slice extracted these frontend paths from `945812ca3a9d0c9e48f3a08d533e34919866d029` (identical through current catalog branch). The initial site slice omitted the research-qualification Queen exclusion from `_app.tsx`; the isolated diagnostic addition below now restores that one condition for its new page.

- components/MainSiteShell.module.css
- components/MainSiteShell.tsx
- components/StaffSiteGate.tsx
- components/admin/StaffInventoryWorkspace.tsx
- lib/server/mainSitePage.ts
- lib/siteRoutes.ts
- middleware.ts
- pages/_app.tsx
- pages/api/v2/admin/inventory/access.ts
- pages/main-site/index.tsx
- pages/staff/index.tsx
- pages/staff/inventory.tsx
- tests/siteRoutes.test.ts
- tests/staffSite.test.tsx
- tests/staffSiteAccess.test.ts

Preserve all other runtime, dependency, schema, research and cron bytes from the serving base. In particular engine V2 stays live-compatible; no V3/V4/catalog activation or source is included. Existing empty additive catalog schema remains compatible. Auth-only hostname support is already live at6c953662; no repeat auth deploy.

Fresh read-only project domain receipt shows exactly collect.tenkings.co and tenkings-backend-nextjs-app.vercel.app, both verified. Preserve both exact hosts; keep the Vercel project alias explicitly in the legacy roster if production-primary changes. Existing authenticated cron handler remains sole owner. Do not copy credentials into the new checkout or reports.

After the isolated diagnostic quiet window, create an isolated codex/main-site-release-20260916 branch/worktree. Apply only the reviewed slice and record a source-delta manifest. Run the three site suites plus relevant existing Inventory workspace/save/photo/API and research/worker compatibility checks. Run scoped lint/types; record existing unrelated diagnostics separately. Qualify the exact migration-disabled Linux/Sharp Vercel build. Use branch-scoped Preview configuration and a verified exact branch alias for the new main surface; leave production aliases/environment untouched until exact release acceptance.

Runtime configuration preflight must separately verify server database access, storage signing, auth and optional provider prerequisites for the exact branch. A successful build or signed-out route check cannot prove a private workspace can read its data. Configure the existing DATABASE_URL as a sensitive server-only value restricted to the release Preview branch; do not copy every Production credential or enable migrations. This Preview shares real inventory/storage, so automated acceptance reads existing records and never saves synthetic stock.

Required external acceptance: Cloudflare widget origin configuration, normal staff login, phone camera/location and original-origin pending-save recovery. Staff sessions are origin-local, not transferred automatically. Preserve collect entry and original tab; do not create synthetic live inventory. Website rollout and DNS are already owner-authorized; the missing account sessions are execution prerequisites, not a renewed approval gate.

At cutover add only apex/www to existing Vercel project, use its exact supplied A/CNAME targets, preserve Wix registrar/nameservers and all mail/TXT/subdomain records. Record planned operation before mutation and observed source/alias/DNS/TLS/private-route results after. No Cloudflare Workers or DNS-provider migration.

## Observed candidate status — 2026-09-16

Application source `d6dfcf4b9737df6bab6915432dcde43496e8e39a` is pushed on `codex/main-site-release-20260916`. Exact-config Preview `dpl_7D8zV1YsG45RCYPngMk3rcNE6nvW` is READY at [main preview](https://tenkings-backend-nextjs-app-git-codex-main-sit-3a8ce9-ten-kings.vercel.app). Linux/native Sharp build,119focused tests, scoped lint and12hosted checks passed; full types retain the12known unrelated grader-test errors. Independent source-boundary audit passed.

Cloudflare's existing widget now allows collect and apex with its key/secret/settings preserved. Browser Cloudflare sign-in is unnecessary because normal Wrangler authentication works. The exact Preview host has matching widget/auth configuration, with every other setting and the same auth image preserved; normal staff login is pending in the open browser tab. Signed-in staff and physical handset acceptance are not claimed. Production web remains38c95335; apex/www DNS and domain attachments are unchanged.

Production configuration checklist: fresh serving-deployment inspection also reports `tenkings-backend-nextjs-app-ten-kings.vercel.app`. At production build preserve both current platform aliases with `SITE_ROUTE_LEGACY_HOSTS=tenkings-backend-nextjs-app.vercel.app,tenkings-backend-nextjs-app-ten-kings.vercel.app`; collect and exact deployment/branch/production hosts are additionally classified by the existing policy. The project-domain roster alone does not enumerate autogenerated deployment aliases. Qualify this exact configuration before promotion.


## Isolated provider diagnostic addition — Preview qualified

The provider experiment can run inside the normal collect server using its existing sensitive `SOLDCOMPS_API_KEY`, without exporting that secret. To keep this independent from research-engine rollout, a source-reviewed slice from `12e13992` adds only:

- `lib/server/staffResearchProviderQualification.ts`
- `pages/api/v2/admin/inventory/provider-qualification.ts`
- `pages/admin/inventory-research-qualification.tsx`
- The single qualification-route Queen exclusion in `_app.tsx`.
- Its two existing focused test files.

Paths above are relative to `frontend/nextjs-app`. All dependency manifests/locks, normal intake, save writer, research engines/workers, cron and schemas stay at the serving baseline. The diagnostic is collect-only and disabled by default. Execution requires normal current human-admin authorization, same-origin JSON, exact plan hash, a fixed cohort and deliberate action acknowledgment. Each invocation caps experiment requests at one search, one item detail and two supplied-image reads; its instance-local cooldown is not a global quota or billing guarantee. Existing auth/profile/font traffic is separate. The Queen exclusion also prevents a previously connected conversation from receiving page context during the experiment.

The additional slice passed 29 focused provider/site tests, scoped ESLint and source-boundary review of 285 protected paths. Nine unchanged tracked hook files were materialized for local sparse-checkout tests; all temporary dependency symlinks were removed. Exact source `76925de44d249440937402b62da452bb84a3be97` is now READY as Preview `dpl_69hs7AyavyftYSCmHmntdPcpG8jt` (`qtfsg405o`), on the same stable main Preview alias. Hosted Linux build passes, including native Sharp0.34.5 trace/calibration bundle verification; optional Sharp development/wasm module warnings remain nonfatal. Migration-disabled branch configuration is unchanged and no migration command ran. All13 intended hosted checks pass after correcting four mistaken probe expectations/URLs; the original failed harness receipt is retained. Authentication-first diagnostic responses are401 before host/flag evaluation, and the existing Inventory path is `/admin/physical-inventory`. These unauthenticated checks do not qualify the actual provider/image runtime or prove a staff session. No live provider call, secret export, flag activation, production web or DNS change occurred. Keep larger-image research off until actual evidence and its separate acceptance pass.


## September 17 — Authenticated inventory read accepted

Mark's normal login succeeded, but the first workspace load returned503 because this exact Preview branch had no DATABASE_URL. Configure/build and signed-out checks had not established database connectivity. Added only a sensitive DATABASE_URL to codex/main-site-release-20260916 using the same project's existing Production setting. Production and all pre-existing environment records remain unchanged; RUN_DB_MIGRATIONS staysfalse. Existing storage/provider settings were already present.

Redeployed exactfd72c7ea as Previewdpl_BJudnpvTQeJFq6HRW4J8dKxFwhAd, with the same qualified application bytes as76925de4. Linux/native Sharp build passes. The actual human session now loads83 inventory entries /93 cards, with Add inventory enabled and the load error gone. Four unauthenticated route/cache guards pass. This supersedes earlier login/read-pending status; physical-phone camera/location/upload/save and original-origin pending-save acceptance remain open. No inventory write or provider call was made for this verification. The preview uses real inventory/storage; it is not a disposable data sandbox. Production web and DNS remain unchanged.


## September17 — Bounded provider check on the authorized Preview

The earlier collect-only diagnostic boundary is extended only by an explicitly configured Preview branch hostname. `STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST` must equal the platform's `VERCEL_BRANCH_URL` and `VERCEL_ENV` must be `preview`; production/apex and other Preview hosts cannot use it. The execution flag, human-admin authorization, same-origin POST, fixed plan/cohort and limits remain unchanged. Existing provider secret metadata already targets Preview, so no credential transfer or production release is needed. The main host router admits only the diagnostic page/page-data and API on that exact configured Preview. Intake, writer/research, schedules and domain rollout stay independent. The diagnostic returns to the correct staff Inventory path on Preview.

Independent source review,25 focused fixture tests and scoped lint pass. Exact source5aeff411 passed hosted Linux/native Sharp qualification; all four fixed cohorts subsequently executed through the normal human-admin Preview session. The experiment is now disabled and the closing deployment cc1ccc10 is READY. See [actual provider observations](2026-09-17-sold-comps-provider-observations.md). This narrow source update supersedes the earlier claim that the diagnostic is exclusively collect/local; it does not enable the larger-image research flag or prove comp accuracy.


## September20 integrated candidate acceptance

Merged source895a3b34 is READY asdpl_FpG7zsUwoyFHEqjiPfk44qmDE2ja on the unchanged [main Preview Inventory URL](https://tenkings-backend-nextjs-app-git-codex-main-sit-3a8ce9-ten-kings.vercel.app/staff/inventory). Linux/nativeSharp verification and13hosted access/routing checks pass. A fresh new Chrome tab reused the normal existing human session and visibly read99entries/109cards with Add Inventory enabled. No card/provider write, token transfer or original-draft-tab reload occurred.

The exact branch-sensitive database setting is present; its omission from env-pull is expected sensitive-value handling. Migrations and optional research/catalog flags remain off. Physical-phone save/reopen acceptance remains outstanding before the authorized domaincutover. Productioncollect aliases and DNS remain unchanged. See the current session log and updated plan for exact receipts and remaining product gates.


## September 21 — Phone acceptance and reviewed catalog selection integration

Mark confirmed that he tested the phone workflow a couple of days earlier and considers that acceptance complete. This supersedes earlier phone-pending entries; it is owner confirmation, not a new exact-device/build measurement. The new apex origin still needs normal routing, login, private-photo and map checks.

The main release now integrates committed Inventory `7c7b61fc` (application `de6fa5b6`), including only the reviewed catalog set-selection repair beyond the previously qualified application. All concurrent uncommitted comp/Pokémon implementation stays outside this candidate. Merge conflicts are documentation-only; both original release histories are retained. The previously passed controlled timing/default-cron/sports SQL evidence remains applicable to unchanged runtime. The narrow UI delta passed17focused tests and independent review.

Planned release sequence under existing authorization: exact-source Preview build and hosted guards, complete Wix zone snapshot, attach only apex/www to the existing Vercel project and read exact DNS/TLS requirements, apply scoped Production routing configuration, create an unassigned Production-environment build, qualify it and promote the exact deployment, then change only apex/www web DNS and verify routing/normal authentication/private photos/maps plus retained non-web DNS and the single research cron. No migrations or optional feature activation. Every provider mutation and observed outcome will be recorded in the session log.
