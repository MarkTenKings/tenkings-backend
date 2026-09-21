# Main-domain implementation preparation

Date: September 16, 2026 (America/Los_Angeles).

Current status: the main-site runtime is isolated on the live Inventory baseline in `codex/main-site-release-20260916`, application commit `d6dfcf4b9737df6bab6915432dcde43496e8e39a`. Exact-config Preview `dpl_7D8zV1YsG45RCYPngMk3rcNE6nvW` is READY;119focused tests, scoped lint, Linux/native Sharp build and12hosted checks pass. Recognition/photo/save/research remain the serving `38c95335` source, so this release does not depend on activating the separate V3/V4 candidate. Cloudflare and the unchanged auth image now support collect, apex and the one exact main Preview hostname. Normal staff sign-in is pending in Chrome; physical handset acceptance, production web activation and apex/www DNS cutover remain open. The catalog branch and its earlier combined Preview remain separate. See `docs/handoffs/SESSION_LOG.md` and the isolated branch's `docs/plans/2026-09-16-main-only-release.md` for exact receipts. The original preparation packet below is historical scope/checklist, not the latest execution status.

Original preparation scope: Mark authorizes discarding the Wix marketing content as having no utility and requests a clean consumer/staff main website; no new content-retention approval is required. The lead has recorded that direction in the canonical blueprint and handoff entry. This packet does not execute content removal, deployment, DNS/provider configuration, old-service retirement or live business writes; domain/provider accounts and email are separate from the disposable website content.

## Decision

Build the new main website inside the existing `frontend/nextjs-app` application in `MarkTenKings/tenkings-backend`. Serve it through the existing Vercel project, `tenkings-backend-nextjs-app`, with explicit hostname/path routing. Use **https://tenkings.co** as the proposed main canonical origin; redirect www to apex. Keep **https://collect.tenkings.co** serving issued card/NFC/QR/report links, customer history and specialist operations.

There is no Wix source import to perform: the new pages/components/assets become ordinary tracked files in the existing GitHub repository. GitHub stores the source; Vercel builds and serves it; DNS selects which hostname reaches that deployment. The domain registrar and email hosting are separate from all three. Replacing the Wix website does not require transferring the domain registration or mail.

Cloudflare may later provide DNS without hosting the application. The smallest cutover changes only the web records at the current DNS provider, after the reviewed app is ready. Vercel explicitly supports website A/CNAME changes at an external DNS provider without moving the rest of the zone. Use the exact project-specific targets presented during cutover, not a copied generic IP or another project's CNAME. [Vercel custom-domain documentation](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

## Evidence and limits

- Source inspected: `ece8223b277ffa272ed87037b8044f17804a8dcb`, origin `https://github.com/MarkTenKings/tenkings-backend.git`, checkout `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`.
- The prior [domain/admin investigation](2026-09-16-domain-and-admin-transition-review.md) verified Wix apex → www, Wix nameservers, Google MX, and READY collect deployment `dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj` at application commit `38c95335`. These are inherited dated observations; this preparation does not claim a fresh infrastructure audit.
- The installed app is Next.js `14.2.5`, Pages Router, React 18, with Node/Prisma/Sharp APIs. No middleware currently supplies the proposed hostname boundary.
- `/admin/physical-inventory` already defaults to the modern staff workspace. Its current local version and the serving version must remain distinguished: local recognition/catalog/research changes after `38c95335` are not automatically eligible for a domain release.
- Mandatory context, the complete approved V2 blueprint, deployment and Set Ops runbooks, handoff header/recent inventory entries, recent session log and prior domain review were read. No production credential, DNS/provider account configuration, live staff transaction or Atlas checkout was inspected or modified.

The prior recommendation to inventory/import Wix marketing content is superseded by Mark's content-discard decision. Preserve provider/DNS rollback information, not obsolete marketing material. Known obsolete paths can return a proper not-found page; do not invent SEO obligations or redirect every discarded article to an unrelated homepage.

## Hosting options

| Option | Concrete consequence | Recommendation |
| --- | --- | --- |
| Existing Vercel project; same app, host-gated shells | One build/release, same private storage and database, existing API handlers and scheduled research owner. A routing regression can affect collect, so both hosts require acceptance. | First implementation. |
| Separate Vercel project in the same GitHub monorepo | Independent frontend release, but requires intentional API/auth routing, a second environment/configuration surface, and explicit exclusion of the existing cron. Copying this complete app/project is not a clean boundary by itself. | Revisit only when independent release requirements justify it. |
| Cloudflare DNS with Vercel hosting | DNS provider changes; application remains on Vercel. Requires complete zone/MX/TXT/subdomain/DNSSEC reconciliation if nameservers change. | Optional later operation, separate from web cutover. |
| Cloudflare Workers application hosting | A runtime/framework migration plus Prisma, Sharp/image processing, uploads, provider timeouts, cron and deployment qualification. Does not remove the new hostname/auth/navigation work. | Exclude from this slice. |

Cloudflare's current primary documentation recommends vinext for its Next.js Workers path and describes adding it to an existing Next.js 16 app; it retains OpenNext as another path and Pages for static exports. This repository is a Next.js 14 server application. A claim that moving it to Workers is merely changing a GitHub integration would be unsupported. [Cloudflare Next.js guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).

If Cloudflare DNS is selected later, begin with DNS-only web records so requests still reach Vercel directly. Enabling Cloudflare's HTTP proxy adds another request/cache layer and deserves its own private-response and certificate checks. [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/).

## First product slice

### Public home

Create a restrained consumer home with Ten Kings branding and clear links to currently implemented customer experiences: locations, packs, Live Rips and My Collection. Initially those experiences open their explicit `https://collect.tenkings.co/...` URLs. Do not copy their business implementations, market unbuilt V2 commerce as live, or start new ownership/payment/shipping work in this slice.

The public header contains only consumer destinations. A small **Staff** entry leads to `/staff`. No legacy admin tile grid, upload console, internal HQ locations, private inventory, old marketing pages or research data appears in public navigation or public page props. Use already-owned repository brand assets or new approved assets, not a Wix scrape. Main-domain metadata, canonical URL, favicon and social image belong to this shell.

Terms/privacy need actual owner-approved content before new links point to them. The previous audit found Wix 404s there; the domain move does not establish that legal content exists. In preview, expose this as a content acceptance item rather than publishing invented policies or broken production footer links.

### Staff entry

- `/staff`: compact sign-in/home surface, with **Inventory** as the first daily-work tool.
- `/staff/inventory`: reuse `StaffInventoryWorkspace` and its existing capture, cost → channel, location, history, research and exact-retry behavior.
- Locations remains the existing workspace tab for this first slice; no duplicate `/staff/locations` implementation is needed.
- Add a small staff-shell navigation contract to the reused workspace: brand/home target `/staff`, consumer-site target `/`, and an explicit **Specialist tools** link to `https://collect.tenkings.co/admin`.
- **Advanced records** deliberately opens the existing collect inventory entry. Do not imply that the existing page accepts an unimplemented query parameter selecting an advanced tab. It currently defaults to staff mode, from which its existing Advanced records control opens the advanced workspace.
- Keep collect's `/admin/physical-inventory` available at the same URL with its existing browser storage and retry semantics. Moving the default staff entry does not redirect or retire it.
- Reuse current human admin authority. “Staff” is the section's product name, not an invented broader authorization role. Employees without the existing authorized account cannot gain access through a new navigation label.

The main staff page must render its clean sign-in/denied/loading states without the old global header, footer or Queen widget. Page HTML can contain a sign-in shell; inventory data remains server-authorized. A client-side `hasAdminAccess` check or hidden link is never access enforcement.

## Host, path, asset and API contract

Add one pure host/path policy used by lightweight Next middleware and tested independently. Middleware determines which surface is reachable; existing Node API guards determine who may use it. Middleware must not import Prisma, Sharp, database modules or service credentials. The repository's pinned Next 14 middleware supports rewrites/redirects and request matching; implementation must follow that version rather than introducing a framework upgrade. [Next.js 14 middleware](https://nextjs.org/docs/14/app/building-your-application/routing/middleware).

### Route matrix

| Request host/path | Initial behavior |
| --- | --- |
| `tenkings.co/` | Rewrite internally to a new main-home page, leaving browser URL `/`. |
| `tenkings.co/staff` and `/staff/inventory` | New staff shell; authorization required before protected content/data. |
| `www.tenkings.co` safe GET/HEAD pages | Redirect to the equivalent apex path, using one deliberate canonical rule. Do not accept business writes at www or redirect API POSTs with their bodies. |
| Main-host explicit customer navigation | Use absolute collect links. A small explicit GET/HEAD alias list may redirect `/packs`, `/locations`, `/live`, `/collection`, `/profile` to collect, preserving only safe ordinary parameters. |
| Main-host `/c/...`, `/nfc/...`, existing issued report/card/pack routes | Prefer the canonical collect link everywhere. Any compatibility redirect must use an enumerated verified route family, GET/HEAD only, and fixed collect destination. Never mint a new main-host NFC/card URL. |
| Main-host old `/admin/...`, grading, Set Ops, kiosk/packing and unlisted pages/APIs | 404; staff shell links required specialist operations directly to collect. Do not expose all old routes by adding a domain alias. |
| `collect.tenkings.co` existing routes | Existing behavior and canonical URLs remain. No blanket redirect to main and no V1 freeze. |
| collect new `/staff` paths | May link or GET-redirect to main only after activation; existing inventory URLs never redirect. |
| Unknown hosts | Reject rather than silently choosing a product surface. Explicitly classify legitimate Vercel deployment and approved preview hosts as described below. |

Suggested internal public page: `pages/main-site/index.tsx`, reachable through the main-root rewrite. Incoming direct `/main-site` and its page-data alias are not additional public products. It is safe public content, but its direct URL should still follow the route policy. `/staff` pages are real routes with the main-host policy enforced.

### Next internals and public assets

- Permit required `/_next/static` build assets. JavaScript is public code, not an authorization boundary; all secrets and private props stay server-side.
- Test direct and prefetched `/_next/data/<buildId>/...json` requests against the same page policy, including legacy admin and the internal main-page path. Verify pinned Next normalization/rewrite behavior; do not rely on a pathname-only assertion that ignores page-data requests.
- Do not implement a blanket “contains a dot” or file-extension bypass. APIs, route suffixes and data JSON still need correct handling.
- Main public assets use an explicit asset directory such as `public/main-site/` and existing approved `/brand/` assets. Host-specific `robots.txt` and sitemap responses enumerate the main public pages and exclude staff. Preserve collect behavior when adding these endpoints.
- Audit and deliberately permit the favicon/fonts and any `/_next/image` use needed by the shell. Private staff photo URLs must not be fed into a shared image optimizer, public asset folder, pre-rendered props or cached public page. Existing staff rendering already uses private signed reads.
- Strip/overwrite any internal surface-selection header. Neither a user query parameter nor caller-authored forwarded host/surface header grants main/collect/preview treatment. Normalize the request host and compare exact configured names using the platform's trusted request boundary.

### Main-host application API allowlist

Keep the actual existing handlers; do not proxy inventory through a second app or create another writer.

| Path | Required operations and authority |
| --- | --- |
| `/api/v2/admin/inventory/workspace` | GET/POST; existing human session guard, transaction/read projection and sole writer. |
| `/api/v2/admin/inventory/photo` | POST; existing bounded request, Sharp normalization, checksum/retry identity and private S3 storage. |
| `/api/v2/admin/inventory/identify` | POST; existing authenticated recognition and intake capacity contract. |
| `/api/v2/admin/inventory/research` | Existing GET/POST operations, current permissions, revision and retry rules. |
| `/api/v2/admin/inventory/location-map` | GET; existing authenticated saved-location lookup. |
| `/api/admin/locations` | Only existing operations the staff workspace needs; notably POST for Add location. Preserve existing server guard/idempotency and HQ privacy. |
| `/api/wallet/me` | GET as required by the existing SessionProvider's wallet hydration. No new wallet feature or write capability. |
| Proposed `/api/v2/admin/inventory/access` | Small GET-only entry check calling `requireInventoryAdminSession`; returns only the safe authorized display identity needed by `/staff`, with private/no-store/noindex. No new role, static capability or alternate session verifier. |

Resolve actual handler methods before freezing the executable allowlist. Unneeded exact-card/workflow APIs stay on collect because advanced work stays there. Do not allow `/api/admin/:path*` or `/api/v2/:path*` wholesale. Disallowed main-host APIs return a response, not a redirect carrying a bearer token or request body to another origin.

The existing photo API is a bounded browser-to-Next upload processed into private S3 objects; it is not the grader's direct browser-to-storage protocol. Keep that distinction. `requireInventoryAdminSession` rejects missing bearer sessions, static operator keys and the Financial Story read token, then verifies existing human authority. Workspace/photo responses retain `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Signed URLs are transient read capabilities, never source records, logs or public catalog media.

### Cron and deployment hosts

Retain exactly the existing `vercel.json` research schedule and its authenticated handler. Domain aliases do not call for another job, worker or project. Vercel schedules invoke the production deployment URL, which can be a `vercel.app` hostname; a new middleware that allows only collect and apex could otherwise break research. [Vercel cron operation](https://vercel.com/docs/cron-jobs).

Classify exact platform-owned deployment host values from trusted deployment configuration. Permit the existing cron path there to reach its existing `CRON_SECRET` guard without redirects; the host alone never authorizes execution. Do not use a client-controllable `*.vercel.app` wildcard as privileged authority. Preserve current production generated-URL behavior intentionally where required. Preview uses an exact approved hostname and server-selected surface mode, never a public `?host=` switch. Preview jobs must not run against production business data or introduce another scheduler.

## Authentication and origin prerequisites

1. **Keep one auth system.** `useSession.tsx` stores `tenkings.session` in origin-local localStorage. `lib/api.ts` sends login-code, verification and profile calls to configured `NEXT_PUBLIC_AUTH_SERVICE_URL`; inventory APIs and wallet hydration use same-origin paths. Main and collect therefore share the existing auth service and account identities, but each browser origin signs in separately. Do not promise cross-subdomain SSO, copy bearer tokens in URLs/postMessage, or add domain-wide cookies in this slice.
2. **Qualify the existing auth transport.** `backend/auth-service/src/index.ts` currently installs permissive `cors()`. This is source evidence, not proof of the public proxy's complete deployed CORS behavior. Verify real main-origin send-code/verify/profile requests, preflight, headers, body limits and bearer handling against the configured service origin. The first slice can preserve this existing transport; no new generic auth proxy is needed. If its deployed proxy uses an allowlist, add only the exact main origin while preserving collect. Avoid unrelated CORS/auth redesign.
3. **Extend Turnstile server validation before activation.** The service defaults to one `TURNSTILE_EXPECTED_HOSTNAME`, collect, and `turnstile.ts` compares equality. Add a backward-compatible explicit allowed-hostname configuration with default collect; accept only exact configured results and retain the `send_code` action, token timeout and failure checks. Do not replace collect with apex and break existing sign-in. Do not trust an expected hostname supplied by the browser.
4. **Qualify the widget separately.** Register the new intended origin through Turnstile provider configuration at release time. Widget root-host entries permit subdomains according to Cloudflare's documentation, so retain strict exact server checks even when provider settings are broader. Use isolated test keys/local fixtures or an exact approved preview origin; no global hostname-check disablement. [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).
5. **Preserve browser drafts.** Staff pending commands/drafts are per-admin sessionStorage on their original origin/tab. Prior to moving a device's default entry, resolve any uncertain collect save by its existing exact retry/receipt path. Preserve the old tab and collect entry. Do not clear storage, fabricate a successful receipt, copy a draft across origins or re-enter an uncertain saved card as a new purchase.
6. **Qualify main-origin permissions.** Camera and geolocation require their normal permission prompts on the new origin. Check Maps HTTP-referrer restrictions against the new origin and private location behavior. Do not relocate NFC/capture-helper pages; their loopback origin/signature settings remain on collect.
7. **Keep distinct URL constants.** Existing `NEXT_PUBLIC_SITE_URL`/`SITE_URL` values generate permanent links and are consumed by other services. Leave canonical card/NFC/QR, pack/kiosk and Live Rip origins on collect. Add a dedicated main-site canonical constant for the new shell rather than globally replacing site-base environment values. Payment callbacks and hardware origins remain untouched because those flows remain on collect.

Authentication provider configuration and auth-service activation are a separate, explicit release dependency, even though the application/DNS change is web-only. Preparing code does not establish that the running auth service now accepts apex challenges.

## Exact source touch list for the next slice

Paths below are repository-relative implementation targets, not files changed by this packet.

| Target | Bounded change |
| --- | --- |
| `frontend/nextjs-app/lib/siteRoutes.ts` (new) | Pure exact host/path/surface constants and route decisions; distinct main/collect origins. |
| `frontend/nextjs-app/middleware.ts` (new) | Apply host matrix, safe canonical redirects, allowlisted APIs/assets and internal root rewrite; no Node/database imports. |
| `frontend/nextjs-app/pages/main-site/index.tsx` (new) | New public consumer entry, explicit collect links and canonical metadata. |
| `frontend/nextjs-app/components/MainSiteShell.tsx` (new) plus scoped styles | Public header/footer, responsive navigation and approved owned brand assets. |
| `frontend/nextjs-app/pages/staff/index.tsx` (new) | Clean staff sign-in/loading/denied/home UI after server authority check. |
| `frontend/nextjs-app/pages/staff/inventory.tsx` (new) | Thin session/access wrapper around existing `StaffInventoryWorkspace`. |
| `frontend/nextjs-app/components/admin/StaffInventoryWorkspace.tsx` | Small optional navigation props with collect-compatible defaults; no intake/save/research/state-storage rewrite. |
| `frontend/nextjs-app/pages/api/v2/admin/inventory/access.ts` (new) | GET-only wrapper around existing human inventory session guard. |
| `frontend/nextjs-app/pages/_app.tsx` | Suppress Queen/legacy shell side effects on main/staff surfaces via explicit route/surface policy; retain SessionProvider and existing Stripe behavior for collect. |
| `frontend/nextjs-app/pages/robots.txt.tsx`, `pages/sitemap.xml.tsx` (new, subject to existing-file check) | Host-specific small public discovery output; no staff/private data. |
| `frontend/nextjs-app/public/main-site/` | Only selected/new public brand assets; no private inventory originals or Wix content migration. |
| `backend/auth-service/src/turnstile.ts`, `backend/auth-service/src/index.ts` | Backward-compatible exact multi-host Turnstile verification/configuration; preserve collect default and existing accounts/session service. |
| Existing auth tests and new `frontend/nextjs-app/tests/siteRoutes.test.ts`, `staffSite.test.tsx` | Host/page-data/API boundary, sign-in/access and navigation integration cases. |

Keep `pages/index.tsx` and existing collect `AppShell.tsx` intact if the root rewrite is sufficient. Preserve current `next.config.js` redirects and Sharp tracing. Preserve `vercel.json` scheduling and branch deployment policy, including `main:false`; do not accidentally auto-release unrelated work. Database schema/writers, storage protocol, Financial Story contract, Atlas files and hardware helpers are outside the touch list. Root updates the blueprint/log; this assignment edits neither.

Before creating the implementation branch, the coordinator must resolve its release base deliberately. Current source includes unreleased private-research changes. A hostname/UI release must not silently activate them; either qualify the combined candidate under its existing gates or use a fresh reviewed branch carrying only the web/auth delta onto the agreed compatible source.

## Preview acceptance

No DNS cutover is needed to demonstrate the UI. First use an isolated local/preview environment with fixture inventory, test authentication and non-production storage. Do not give a newly created preview broad production credentials just to make the demo realistic.

Required evidence before a production candidate is accepted:

- Host matrix tests cover apex, www, collect, exact preview/generated deployment hosts, unknown hosts, spoofed forwarded/internal headers, trailing slash, query strings, encoded paths, disallowed methods and `/_next/data`/prefetch routes.
- Main root has only consumer navigation; `/staff` has the clean sign-in/home experience. No old admin grid, Queen widget, internal location data or private page props appear unsigned.
- Every allowed staff endpoint independently returns expected 401/403 for unsigned, expired, non-admin, Financial Story token and static operator-key requests. Successful human access comes from the existing session authority, not browser constants.
- Tests confirm requests from the main shell use same-origin inventory handlers, while login/profile use the deliberately retained configured auth service. Collect and main Turnstile host/action checks pass; unapproved host/action fails. No credential is logged.
- Staff navigation remains on main until an explicit specialist/advanced link opens collect. Existing collect routes retain their original behavior, including pending commands and advanced forms.
- Existing staff/photo/retry tests remain green. Fixture phone/browser checks cover front/back, HEIC where supported, cost → channel, next-card capture, lost photo/save response, exact retry, reload and login changes. Preserve original JPEG/upload ID/request ID and avoid duplicate stock.
- Private photos remain authenticated at issue time, in private storage, with bounded processing/checksums and transient signed reads. No shared CDN/page cache, optimizer or public sitemap exposes them.
- Maps/camera/geolocation function or show honest unavailable/permission states on the new origin. Desktop WebKit does not stand in for a real iPhone acceptance.
- Generated deployment cron URL reaches the existing secret guard, with one schedule owner; no preview cron invokes production work.
- Normal release build with migrations disabled passes on the exact candidate, plus scoped lint/types and meaningful changed-boundary tests. Record existing unrelated diagnostics separately rather than claiming whole-platform green.
- Read-only canonical-link checks cover representative V1/V2 card, NFC/QR/report, customer collection, Live Rip and specialist routes on collect. Do not encode a tag or create cards/stock to test a navigation change.

## Web-only cutover checklist

This is a later reviewed operational checklist, not a command executed by this preparation.

### Before activation

1. Freeze the accepted commit/build identity, main/collect route matrix, hostname configuration and real provider prerequisites. Ensure no unreviewed research or Atlas work rides along.
2. Record planned deployment/auth activation in the session log. Confirm current serving source and remote parity, the migration-disabled build setting, and one research cron owner.
3. Capture exact current apex/www A/AAAA/CNAME values, TTLs, provider/registrar access and the relevant zone snapshot. Preserve Google MX, SPF/DKIM/DMARC/verification TXT, CAA, all unrelated subdomains and collect. Do not cancel Wix/domain/DNS service as part of a web-record change.
4. Prepare/add the explicit apex and www domains in the existing Vercel project, with ownership/TLS verification and one canonical redirect. Use current project-provided targets. Do not introduce a wildcard domain.
5. Activate the compatible auth-service hostname support and widget/Maps configuration through their appropriate release process; verify collect login remains valid before directing staff to apex.
6. Release the reviewed host-aware application with migrations disabled. Verify collect's existing paths and generated cron path before changing normal web traffic. Record exact observed deployment/alias identity.

### Switch and prove

7. Change only the approved apex/www web records. Do not change nameservers in the same operation. Resolve any conflicting web AAAA/CNAME records deliberately using the captured baseline.
8. Verify DNS, TLS, root page, www canonical behavior, main/staff/assets/API matrix and no redirect loops from more than one resolver/client. Check collect DNS and required customer links again.
9. Perform signed-in read-only staff acceptance and a real handset navigation/camera-permission check. Only separately authorized real intake should write business data; synthetic production inventory is unnecessary.
10. Move staff bookmarks/device entry points after original-origin pending saves are reconciled. Leave collect available for unresolved original tabs and specialist work.
11. Verify a naturally scheduled research run remains healthy without manually causing another provider job. Record mail/subdomain record equality and observed application results in the session log; do not send test email without explicit authority.

### Rollback

- For a web DNS/TLS problem, restore the captured apex/www web records and TTLs. Keep collect, MX/TXT and account/stock/photo data intact. Expect DNS caches to expire; verify both fresh and cached clients.
- For a main-shell problem, use a scoped main-surface fallback or roll forward a routing fix while collect remains on its accepted current application. A shared-project rollback changes the app for collect too: do not casually revert the entire project to an older deployment that lacks accepted protocols/data compatibility or current grading runtime authority.
- Keep the last compatible pre-cutover web artifact recorded, but an actual application rollback is permitted only after verifying it honors all current compatibility gates. Never roll back an unrelated grader/worker or migration for this website cutover.
- Preserve valid sessions and original-origin pending saves. Continue existing collect service; do not copy/recreate uncertain main-origin inventory commands during recovery.
- Record the actual restored DNS/deployment identity and observed result. Wix content discard does not require deleting the Wix account or removing the ability to restore its web records during this window.

## Completion boundary

The next bounded implementation is complete when the main consumer home and authenticated staff inventory shell work in a qualified preview, host/API/private-photo boundaries are proven, and the exact domain/auth cutover packet is reviewable. Publishing to tenkings.co, changing DNS, deleting Wix, replacing V1 commerce, freezing old supply or retiring specialist services are distinct actions. None occurred in this preparation.
