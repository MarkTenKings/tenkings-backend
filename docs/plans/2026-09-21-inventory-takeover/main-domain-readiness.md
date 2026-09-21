# Main-domain readiness — September 21, 2026

**Current state at September 21, 20:54–20:57 UTC: main-domain rollout is live.** Production `dpl_2XUGoG74E88eVeFGETVzFkQDBhRC` is READY at exact source `9a12cd3591074dfe692976445fc30f51690ba043`; apex, www and collect resolve to this artifact. Public TLS/routing/assets, inherited specialist aliases, DNS preservation and natural minute-spaced cron HTTP 200 requests pass the independent postflight below. The stable main Preview remains on `dpl_8HebWQWJfa2YiuKbnYf4kd2x1dwx`.

Mark confirmed phone testing complete and authorized the delivery lanes. That closes the old Preview phone gate. Normal apex sign-in, private-data/photo reads and new-origin map/permission acceptance remain distinct; root has already opened the ordinary sign-in and requested owner action. Do not repeat the phone request or ask for generic release reapproval. Sections marked pre-cutover are retained historical evidence, not outstanding deployment prerequisites.

This lane performs only source/retained-evidence reads, authenticated Vercel metadata/runtime-log reads, public DNS/HTTP GET/HEAD, and auth OPTIONS checks. This lane made no account/configuration, deployment, DNS, database, cron, business-record, provider-research, browser, shared-host or ATLAS mutation. Root performed the authorized rollout and owns integration and SESSION_LOG.

## Pre-cutover baseline and superseded notes

- Inventory application `e286ea0a190bfdc6807fe8ca58c47b34c94b55c1`; main application `895a3b34cc9cd7c8f6d2267ad4d763fb2ff0949d`. Lead verification proves all non-documentation blobs equal. Main local documentation head is `6e507b39`; Inventory takeover head was `297fd302`.
- Exact main Preview `dpl_FpG7zsUwoyFHEqjiPfk44qmDE2ja` is READY. Retained September 20 evidence proves Linux/native Sharp, 13 hosted assertions, and the normal human-session inventory read. Its stable origin is `tenkings-backend-nextjs-app-git-codex-main-sit-3a8ce9-ten-kings.vercel.app`.
- Fresh September 21 metadata still identifies Production `dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj`, immutable host `tenkings-backend-nextjs-htr00ov35-ten-kings.vercel.app`, with collect and both platform aliases. Source `38c95335` is inherited release-record evidence; provider metadata does not expose its Git SHA.
- The old “main-only” smaller code slice, login pending, missing Preview DATABASE_URL, unqualified timing, and unqualified default-cron wiring headings are historical. The current integrated scope is the complete Inventory candidate. The exact branch-sensitive database metadata exists; sensitive env-pull omission is not missing configuration. Do not redo the closed provider experiment or controlled timing study.
- Auth hostname support was already released as source/image `6c953662`; retained September 17 receipts bind the exact collect/apex/stable-Preview roster. No new auth deployment is presumed necessary.
- Root's September 21 parent catalog-selection repair is local and not in either Preview. Root reports 17 focused UI checks, lint, and zero changed-file type diagnostics; the same 12 unrelated diagnostics remain. Freeze the eventual integrated source after that decision, then qualify its actual Production build. Do not label the current Preview as containing the repair.

## Pre-cutover infrastructure facts — historical

Normal Vercel CLI 59.3.0 authenticated GETs around 19:21–19:24 UTC inspected project `prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI`, scope `ten-kings`, through `/v9/projects/{id}`, `/domains`, `/env`, selected non-secret setting reads, and `/v6/domains/{name}/config?projectId={id}`. Secret values were neither printed nor retained.

| Fact | Observed result | Consequence |
| --- | --- | --- |
| Project | `tenkings-backend-nextjs-app`; Next.js; root `frontend/nextjs-app`; Node `22.x` | Use the existing project/repository. |
| Attached domains | Only `collect.tenkings.co` and `tenkings-backend-nextjs-app.vercel.app`, both verified | Apex and www still need attachment. The domain roster does not enumerate every generated alias. |
| Production routing | No Production `MAIN_SITE_ENABLED` or `SITE_ROUTE_LEGACY_HOSTS` record; existing records are Preview-scoped | Set the exact Production values below before building. Preview settings do not establish Production behavior. |
| Existing Production settings | `RUN_DB_MIGRATIONS=false`; `SITE_URL=https://collect.tenkings.co`; auth origin `https://auth.api.tenkings.co`; database and cron-secret metadata present | Preserve them. No global site-origin rewrite or credential duplication. |
| Optional execution | Catalog, catalog consumer, full-resolution, sale-detail and diagnostic activation have no Production records in the inspected metadata; the contribution flag was not included in this fresh filter | Preserve absent/default-off or explicit false in the target build; include the exact contribution key in the final resolved preflight. |
| Scheduler | Exactly one enabled definition: `/api/cron/inventory-research`, `* * * * *`, bound to `dpl_Bo43…` and its immutable `htr00ov35` host | No second project/schedule. Preserve secret and path. Inspect ownership on staging/promotion and observe a natural run; never invoke cron for this audit. |
| Unattached-domain recommendation | Both config GETs report `misconfigured=true`, external Wix nameservers, provisional rank-1 IPv4 `76.76.21.21` and CNAME `cname.vercel-dns.com.` | These are not frozen cutover targets. Re-read after adding the actual domains; use that project's exact current targets. Never copy collect's distinct CNAME. |

Public DNS at 19:21 UTC still reports:

| Record | Current value |
| --- | --- |
| Apex nameservers | `ns14.wixdns.net`, `ns15.wixdns.net` |
| Apex A | `185.230.63.107`, `185.230.63.186`, `185.230.63.171`; observed TTL 3600 |
| Apex AAAA / CAA | No answer in this query |
| www CNAME | `cdn3.wixdns.net.`; observed TTL 3600 |
| collect CNAME | `e22023bfd5f955b5.vercel-dns-017.com.` |
| Mail | Existing five Google MX records; apex TXT, `_dmarc` TXT and `google._domainkey` TXT present |

HEAD requests still show apex 301 → `https://www.tenkings.co/`, www 200, collect Inventory/SetOps page shells 200, and main Preview staff 200 with `private, no-store` / `noindex, nofollow`. These are transport/page-shell observations, not new authenticated data or handset acceptance.

This public query is not a complete zone export: other TXT selectors, verification records, subdomains, record IDs and authoritative TTLs still require the normal Wix DNS account snapshot. Current Wix session availability was not inspected. Preserve registrar/nameservers, MX, all TXT, CAA and every unrelated subdomain. No Wix content import, account cancellation, domain transfer, Cloudflare DNS migration, or Workers migration is required.

## Production configuration and origin acceptance — release requirements

Required routing delta for the chosen Production build:

```text
MAIN_SITE_ENABLED=true
SITE_ROUTE_LEGACY_HOSTS=tenkings-backend-nextjs-app.vercel.app,tenkings-backend-nextjs-app-ten-kings.vercel.app
RUN_DB_MIGRATIONS=false
```

Keep `SITE_URL` and any existing permanent-link `NEXT_PUBLIC_SITE_URL` on collect; the source already defines a separate `MAIN_SITE_ORIGIN=https://tenkings.co`. Production needs no new Preview-host entry. Preserve existing Preview branch settings and pending human tabs. Keep all optional execution off, including `SET_CATALOG_EVIDENCE_ENABLED`, `STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE`, `STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED`, `STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES`, `STAFF_INVENTORY_RESEARCH_SALE_DETAILS`, and `STAFF_RESEARCH_PROVIDER_QUALIFICATION_ENABLED`.

The production app must be built with its Production environment. Use a staged Production build with domains unassigned, qualify it, then promote the exact resulting artifact; do not assume aliasing the Preview imports Production credentials/flags. Inspect project cron metadata before and after staging so schedule ownership cannot silently change ahead of the intended release. Vercel distinguishes staged Production builds from Preview promotion and environment selection. [Vercel promotion workflow](https://vercel.com/docs/deployments/promoting-a-deployment).

Origin evidence and the remaining narrow checks:

- **Auth transport passes this read-only check:** all nine OPTIONS combinations of apex, collect and stable Preview origins against `/send-code`, `/verify`, `/profile` return 204 with authorization/content-type and the requested method allowed. This matches existing permissive CORS source; no redesign is indicated. OPTIONS does not prove Turnstile challenge, SMS, profile authorization or a new apex login.
- **Turnstile/auth host support is already implemented and previously activated:** retained receipts contain exactly collect, apex and the stable Preview. Preserve `send_code` action and server exact-host checks. Current provider/server allowlist readback or successful normal apex sign-in must confirm no drift; only a demonstrated mismatch requires configuration repair. No repeated blanket auth rollout or www login origin is needed because www is a safe-navigation redirect.
- **Maps:** Production browser/server Maps key metadata exists. Current apex referrer restrictions, map-ID applicability and actual map rendering were not proven here. Confirm the existing `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` and browser referrer configuration, and test the map/permission/unavailable states on the main origin. Do not infer success from key presence or change Location records.
- **Phone and pending commands:** Mark has confirmed the requested phone testing complete; this supersedes the earlier pending request and requires no repeat question. For each device changing entry, preserve original collect/Preview tabs and resolve only its actual pending command using its original exact retry/receipt path. Do not copy tokens/drafts between origins, clear storage, or recreate uncertain stock. Apex sign-in, camera and geolocation permissions remain new-origin checks after Preview phone acceptance.
- **Private data:** qualify signed-in reads and original photo reads on the final origin, alongside unsigned rejection/private cache headers. Keep uploaded photos private and out of page props/shared image optimization. No synthetic live save, provider research run, or DB write is necessary to verify domain plumbing.

## Retained release ordering and rollback packet

1. Root freezes the final source and targeted repair evidence, records the phone outcome, current Production identity/aliases/cron owner and exact config in SESSION_LOG. Retain completed unchanged-source timing/SQL/default-cron evidence. This domain operation needs no migration; a later catalog/schema activation remains separately coordinated against the current ledger.
2. Obtain the normal Wix zone snapshot and current account access. Attach only apex/www to the same Vercel project, obtain exact resulting A/CNAME/ownership/TLS requirements, and record them before changing DNS. Keep Wix web records serving during preparation. Changing only A/CNAME at the current DNS provider preserves the rest of the zone. [Vercel domain configuration](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
3. Apply the scoped Production config, create/verify the exact staged Production build, native Sharp/runtime and host tests, then promote it. Inspect both generated platform aliases and the new immutable deployment host. Verify collect Inventory, SetOps, required customer/report/NFC/QR routes and private API guards before switching normal apex traffic. Do not make a project-level blanket www redirect: the existing middleware already redirects safe page GET/HEAD only, rejects www API/writes, and drops untrusted query forwarding.
4. Change only apex A and www CNAME to the newly recorded targets; reconcile conflicting apex web AAAA/CNAME only if actually present. Keep nameservers and every non-web record. Verify TLS/domain verification, apex root/staff/assets/API/page-data policy, www behavior and collect unchanged through more than one resolver/client. Record observed DNS and deployment identities.
5. Complete normal apex human sign-in/read/photo and handset-origin checks, map/permissions and actual original-origin pending-save disposition. Main specialist routes stay hidden; its explicit specialist links open collect. SetOps publication remains a human-reviewed operation and is not part of a hostname test.
6. Confirm project metadata still has one research schedule bound to the intended current deployment. Read a naturally scheduled result without manual invocation. Compare preserved mail/TXT/subdomain records; no test email is authorized or needed. Move bookmarks only after the device's pending work is resolved.

For DNS/TLS failure, restore the freshly captured apex A/www CNAME and TTLs, allow caches to expire, and leave the accepted collect application, mail and all data intact. For a main-shell fault, repair/disable that surface through a qualified current-code build or roll forward. `MAIN_SITE_ENABLED=false` is not an instant environment-only rollback; it needs the applicable rebuilt artifact and may make apex unavailable until DNS is restored.

A shared-project deployment rollback also changes collect and cron. `dpl_Bo43…` is the observed pre-cutover artifact, not automatically a safe future rollback: verify writer/result-reader and every current grading/protocol compatibility boundary before selecting it. Retain new research readers after any corresponding result version is persisted. Never roll back schema, delete evidence, restore retired grading workers, or restart ATLAS. Preserve main-origin pending saves on their original tab/origin even while DNS is restored; reopening collect is not authority to submit them again.

## Evidence and next action

Source checked: `frontend/nextjs-app/lib/siteRoutes.ts`, `middleware.ts`, `vercel.json`, `lib/api.ts`, `hooks/useSession.tsx`, Maps loader/component/API, main shell, and Git-visible auth service source. The router classifies collect, exact Vercel runtime hosts and explicit legacy aliases; it does not rely on a wildcard or forwarded-host authority. It passes the cron path to the existing secret guard, which must never redirect. [Vercel cron redirect behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Retained authority: [lead verified state](verified-state.json), [transfer packet](../../handoffs/2026-09-21-ten-kings-inventory-astra-ultra-handoff.md), and the current main-workspace `docs/plans/2026-09-16-main-only-release.md`. Private September 20 Preview receipts and September 17 auth/widget receipts remain under `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations`; no copies or new secrets were placed in Git.

The Production build, domain/config preparation and cutover described below have now been executed by root. The current remaining acceptance is listed in the postflight, not this historical preflight. Optional catalog/comp activation, ATLAS adoption, independent all-card accuracy and Wix marketing recreation are not new prerequisites for this default-off main shell.

## Archived read-only preflight after phone acceptance and integration

Root merged Inventory documentation head `7c7b61fc` / application `de6fa5b6803000072bb27fb1f0616fec813b701a` into main as **`9a12cd3591074dfe692976445fc30f51690ba043`**. Fresh local HEAD confirms this main commit and `git diff --name-only HEAD de6fa5b6 -- . ':!docs'` is empty. The earlier three-file catalog-selection delta is now integrated; the previous local-only repair note is historical. At closeout root reports its exact Git Preview READY as `dpl_8HebWQWJfa2YiuKbnYf4kd2x1dwx`; that deployment inspection belongs to root.

Root also reports a normal signed-in Wix domain UI and a private authoritative baseline of all 29 zone-record rows/types/TTLs, including five TXT records, at `20260921-main-production/wix-zone-before.json`. This supersedes the earlier missing Wix-session/full-zone facts. Root reports no DNS change at that checkpoint and owns subsequent guarded attachment/configuration/staging.

Fresh metadata-only GETs still show unchanged `dpl_Bo43…` Production/aliases/sole schedule, only the two existing attached domains, no Production main routing keys, and Production database/cron-secret/migration-setting records. This pass fetched no environment values. The exact `STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED` key is now checked and absent; `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` metadata exists for Production/Preview/development. Provider referrer settings and apex rendering remain separate checks.

**Checkout/link boundary:** main is a sparse checkout. Neither release workspace has `.vercel/project.json`. The actual existing link is `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean/.vercel/project.json`, containing the correct project above and organization `team_YaEhDoZXD2WsvqpoUp0KqBDh`. That saved-project checkout is not release source. Do not deploy it or upload the sparse main tree. Normal authenticated `vercel api` can identify the existing project explicitly and build its exact Git source without copying configuration or relinking checkouts.

### Reviewed staged Production request — subsequently executed by root

After the scoped Production configuration and pre-deploy log are complete, place this exact reviewed JSON in `/private/tmp/tenkings-main-production-staging-20260921.json` (re-freeze the SHA if the intended source changes):

```json
{
  "name": "tenkings-backend-nextjs-app",
  "project": "prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI",
  "target": "production",
  "autoAssignCustomDomains": false,
  "gitSource": {
    "type": "github",
    "repoId": 1074431573,
    "ref": "codex/main-site-release-20260916",
    "sha": "9a12cd3591074dfe692976445fc30f51690ba043"
  }
}
```

```bash
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node /Users/markthomas/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js api /v13/deployments --method POST --scope ten-kings --input /private/tmp/tenkings-main-production-staging-20260921.json
```

The live project link verifies GitHub repository ID `1074431573`, `MarkTenKings/tenkings-backend`, tracked Production branch `main`, and root `frontend/nextjs-app`. Explicit target/ref/SHA avoids changing branch tracking or the existing `main:false` deployment policy. Omit `files`, `deploymentId`, `withLatestCommit`, credentials, and project-setting overrides.

The [official deployment API schema](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) and its `https://openapi.vercel.sh` JSON confirm the GitHub `type/ref/repoId` variant with optional exact `sha`. The public schema omits `autoAssignCustomDomains`; support is established by the installed official CLI 59.3.0: `dist/commands/deploy/index.js:1850` maps `--skip-domain` to `false`, and `dist/chunks/chunk-G55RLNFE.js:1547` places it at the top level of the create-deployment request. CLI help says it disables automatic Production domain assignment. This is the same staging control, composed with the documented Git-source request. No request was sent by this agent. `vercel redeploy --help` exposes `--target` but no `--skip-domain`; do not invent that redeploy flag.

Read back the returned deployment ID through `api /v13/deployments/<returned-id> --scope ten-kings`; require the exact Git SHA/project, `target=production`, READY build, intended configuration, domains still unassigned, and current Production aliases/cron still at the recorded baseline. If a request outcome is uncertain, inspect deployments before any retry. After the final hosted checks and logged release decision, the supported promotion command is the same Node/CLI prefix followed by `promote <verified-staged-deployment-id> --scope ten-kings`. Re-read aliases and the sole cron immediately afterward. No link/env/deployment/domain mutation, heavy build, commit or SESSION_LOG edit occurred in this preflight.

## Independent read-only postflight — September 21, 20:54–20:57 UTC

Normal authenticated CLI metadata reads confirm project `prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI` now targets READY Production **`dpl_2XUGoG74E88eVeFGETVzFkQDBhRC`**, immutable host **`tenkings-backend-nextjs-6vjca6li1-ten-kings.vercel.app`**, Git source **`9a12cd3591074dfe692976445fc30f51690ba043`**, branch `codex/main-site-release-20260916`. Apex/www are verified attached domains with no provider-level redirect. Direct `/v4/aliases/{hostname}` reads bind apex, www and collect to this Production, and the exact stable main Preview alias to READY **`dpl_8HebWQWJfa2YiuKbnYf4kd2x1dwx`**. Deployment/project `alias` arrays retain historical assignments and are not the authoritative current alias lookup.

| Postflight | Fresh observation |
| --- | --- |
| Production configuration | Root's retained `env-preservation.json` reports all 148 prior records identical and exactly two added keys, `MAIN_SITE_ENABLED` and `SITE_ROUTE_LEGACY_HOSTS`. No env values were fetched or emitted by this postflight. Runtime host behavior confirms main routing and both legacy platform aliases. |
| DNS propagation | `1.1.1.1`, `8.8.8.8`, `ns14.wixdns.net` and `ns15.wixdns.net` all return apex A `216.150.1.1` / `216.150.16.1` and www CNAME `47388d6720762a26.vercel-dns-017.com.`. Wix remains authoritative. |
| Preserved zone | Independent authoritative comparison against private `wix-zone-before.json` finds all 20 non-web A/CNAME/MX/NS rows retained, including all five Google MX names/priorities; all five prior TXT records across four queried names remain identical. Root reports two additional certificate-validation TXT records and completed TLS issuance. No unrelated service record removal was observed. |
| Public TLS/main shell | Ordinary public HTTPS, with normal certificate verification and no forced address, returns 200 for apex `/` and `/staff/inventory`; both contain empty page props and build ID `n4R4fgngEeWqrNVY4kBZr`. Staff has `private, no-store` and `noindex, nofollow`. |
| Private/specialist isolation | Unsigned apex workspace GET returns 401/private/no-store. Apex SetOps page and its exact build page-data URL return 404/private/no-store. www staff GET redirects 307 to apex and drops the supplied query; www workspace API returns 404. |
| Assets/styles | Both CSS files referenced by the live apex HTML return 200 `text/css`; its `_app` and main-site JS return 200 `application/javascript`, all with immutable cache policy. Brand PNG returns 200 `image/png`. These are delivery checks, not a new visual or signed-in UI acceptance. |
| Legacy tools | Collect SetOps and both inherited platform-alias Inventory/SetOps shells return 200 with empty page props and the same Production build ID. Root's retained corrected 13-route TLS matrix additionally passes customer/NFC/card redirects and collect private guards. |

**Natural cron execution is observed, not merely configured.** Fresh project metadata has exactly one enabled definition, `/api/cron/inventory-research`, every minute, owned by the Production deployment/immutable host above. Normal bounded `vercel logs` with deployment/project, `--since 30m --limit 6 --no-follow --query /api/cron/inventory-research --json` returns six naturally occurring GET requests at **20:49:37, 20:50:37, 20:51:37, 20:52:37, 20:53:37 and 20:54:37 UTC**, all **HTTP 200**, `environment=production`, exact new deployment and `6vjca6li1` domain. Example provider request IDs: `jj4qr-1790023777219-9af026dbd794` and `gl2tq-1790024077495-3050ab6316b4`. No cron HTTP request was made by this agent. The returned records contain no nested application logs or response body, so they prove successful scheduled request handling, not jobs claimed/completed, empty-queue status or business-result correctness. Standing default-cron qualification remains the evidence for those unchanged code paths.

No actionable infrastructure defect was found. Root's existing owner sign-in request remains pending for apex authenticated reads/private photos and new-origin map/permission acceptance; phone acceptance itself stays closed. No repeated old timing matrix, synthetic live stock, DB action, provider research, browser/account change, environment/DNS mutation, manual cron invocation, commit or SESSION_LOG edit occurred. Private rollout evidence remains in `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260921-main-production`. The earlier DNS rollback record and compatibility-aware shared-project rollback rules remain applicable.
