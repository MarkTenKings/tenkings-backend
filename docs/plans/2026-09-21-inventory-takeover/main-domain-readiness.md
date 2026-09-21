# Main-domain readiness — September 21, 2026

The integrated main Preview is qualified for the retained checks, but it is not a Production-configured artifact and apex/www have not been attached or switched. The concrete remaining work is the pending real-phone result, two missing Production routing settings, a qualified Production build, exact attached-domain targets/TLS, current origin acceptance, and preservation/readback of the existing DNS zone. Mark's September 16 approval already covers the qualified Vercel release and domain cutover; no generic reapproval is required.

This packet performs only source/retained-evidence reads, authenticated Vercel metadata GETs, public DNS/HTTP HEAD, and auth OPTIONS checks. No account/configuration, deployment, DNS, database, cron, business record, provider-research, browser, shared-host, or ATLAS mutation occurred. The lead owns integration and SESSION_LOG.

## Accepted baseline and superseded notes

- Inventory application `e286ea0a190bfdc6807fe8ca58c47b34c94b55c1`; main application `895a3b34cc9cd7c8f6d2267ad4d763fb2ff0949d`. Lead verification proves all non-documentation blobs equal. Main local documentation head is `6e507b39`; Inventory takeover head was `297fd302`.
- Exact main Preview `dpl_FpG7zsUwoyFHEqjiPfk44qmDE2ja` is READY. Retained September 20 evidence proves Linux/native Sharp, 13 hosted assertions, and the normal human-session inventory read. Its stable origin is `tenkings-backend-nextjs-app-git-codex-main-sit-3a8ce9-ten-kings.vercel.app`.
- Fresh September 21 metadata still identifies Production `dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj`, immutable host `tenkings-backend-nextjs-htr00ov35-ten-kings.vercel.app`, with collect and both platform aliases. Source `38c95335` is inherited release-record evidence; provider metadata does not expose its Git SHA.
- The old “main-only” smaller code slice, login pending, missing Preview DATABASE_URL, unqualified timing, and unqualified default-cron wiring headings are historical. The current integrated scope is the complete Inventory candidate. The exact branch-sensitive database metadata exists; sensitive env-pull omission is not missing configuration. Do not redo the closed provider experiment or controlled timing study.
- Auth hostname support was already released as source/image `6c953662`; retained September 17 receipts bind the exact collect/apex/stable-Preview roster. No new auth deployment is presumed necessary.
- Root's September 21 parent catalog-selection repair is local and not in either Preview. Root reports 17 focused UI checks, lint, and zero changed-file type diagnostics; the same 12 unrelated diagnostics remain. Freeze the eventual integrated source after that decision, then qualify its actual Production build. Do not label the current Preview as containing the repair.

## Fresh infrastructure facts

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

## Exact Production configuration and origin acceptance

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
- **Phone and pending commands:** the sports/Pokémon front/back → cost → channel → save → reopen result is already requested by the lead; do not ask again. It remains required before the planned rollout. For each device changing entry, preserve original collect/Preview tabs and resolve only its actual pending command using its original exact retry/receipt path. Do not copy tokens/drafts between origins, clear storage, or recreate uncertain stock. Apex sign-in, camera and geolocation permissions are new-origin checks even after Preview phone success.
- **Private data:** qualify signed-in reads and original photo reads on the final origin, alongside unsigned rejection/private cache headers. Keep uploaded photos private and out of page props/shared image optimization. No synthetic live save, provider research run, or DB write is necessary to verify domain plumbing.

## Ordered release and rollback packet

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

Next bounded coordinator action: finish integrating the local repair and phone outcome, then prepare the exact Production-configured build and Wix/Vercel attached-domain record sheet. The missing items are execution facts and acceptance, not renewed permission to implement or publish. Optional catalog/comp activation, ATLAS adoption, independent all-card accuracy and Wix marketing recreation are not new prerequisites for this default-off main shell.
