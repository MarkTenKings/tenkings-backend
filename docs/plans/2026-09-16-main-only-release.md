# Independent main-site release candidate

Base: serving web commit `38c95335614df756c420127e6b94bedd5620fa2d`.
Extract only these frontend paths from `945812ca3a9d0c9e48f3a08d533e34919866d029` (identical through current catalog branch). Remove the unrelated research-qualification Queen exclusion from `_app.tsx`.

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

Required external acceptance: Cloudflare widget origin configuration, normal staff login, phone camera/location and original-origin pending-save recovery. Staff sessions are origin-local, not transferred automatically. Preserve collect entry and original tab; do not create synthetic live inventory. Website rollout and DNS are already owner-authorized; the missing account sessions are execution prerequisites, not a renewed approval gate.

At cutover add only apex/www to existing Vercel project, use its exact supplied A/CNAME targets, preserve Wix registrar/nameservers and all mail/TXT/subdomain records. Record planned operation before mutation and observed source/alias/DNS/TLS/private-route results after. No Cloudflare Workers or DNS-provider migration.
