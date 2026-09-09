# ATLAS website deployment runbook

Prepared September 9, 2026 from the current three-app candidate. This is a release procedure, not evidence that projects, credentials, DNS, SMS, grading or NFC have been activated. Record the final commit, deployment IDs, configuration hashes and observed acceptance in the release handoff. The owner-approved route and customer requirements remain in the [blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md) and [customer specification](CUSTOMER_ACCESS.md).

Mark authorized the website pilot. Preparing and testing that release does not require another general permission request. Live setup still needs the approved staff phone number, an explicit pilot spending ceiling, access to the relevant Vercel/domain and Twilio accounts, and the selected provider/worker resources. Do not invent these inputs or describe a synthetic run as the authorized live pilot.

## Projects and build settings

Create or resolve three distinct Vercel projects in the intended team. Record their actual project IDs; the labels below are responsibilities, not claims that named projects already exist. Only the public project receives the `atlasgrading.com` domain.

| Project responsibility | Root Directory | Build Command in that directory | Routes at the apex |
| --- | --- | --- | --- |
| Public website, approved reports and signed path router | `frontend/atlas-public` | `pnpm run build` | `/`, `/reports/[token]`, approved report APIs and public assets |
| Private staff workspace | `frontend/atlas-app` | `pnpm run build` | `/admin` and descendants, including `/admin/api/staff/...` and `/admin/_next/...` |
| Private customer accounts | `frontend/atlas-customer` | `pnpm run build` | `/account` and descendants, including `/account/api/customer/...` and `/account/_next/...` |

Use the Next.js framework preset and its default output handling. All three app manifests pin Next.js `15.5.25`, React `18.3.1` and Prisma `5.22.0`. The repository pins pnpm `9.12.0` and Node `20.x`; verify the actual build/runtime versions in the deployment evidence. Do not silently adopt a new major because it is the platform default. Vercel permits a project setting and a package `engines.node` override; verify the resulting runtime. [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Set the install command to `pnpm install --frozen-lockfile`, using the repository workspace and root lockfile. Enable **Include source files outside of the Root Directory in the Build Step**: the staff/public builds explicitly use sibling `packages/atlas-*` files, and all three consume the workspace router package. Do not copy an app directory into a standalone repository and lose its reviewed dependency closure. [Vercel monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq).

The staff/public build scripts build grading-core, generate the app-owned Prisma client, run `next build`, then inspect the built boundary. The customer script generates its own client, builds and checks its boundary. Generation uses a deliberately unreachable build-only database URL; none of these build scripts applies a migration or enables access. Do not substitute the repository's legacy `vercel:build` script, a root-level Next build, `prisma db push`, or a shared database client.

The staff API declares `maxDuration: 240`; the customer API declares `30`. The public Next proxy allows 240 seconds. Confirm that the deployed staff function and selected plan actually permit 240 seconds. Only a durably dispatched grading POST emits periodic JSON whitespace; its terminal envelope carries the real result/error. A heartbeat is not a successful grade or an extended spending authorization. Vercel's origin timeout is a separate 120-second initial/between-chunks limit, so test the real rewritten response rather than relying only on the function setting. [Function duration](https://vercel.com/docs/functions/configuring-functions/duration), [origin timeout](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes).

## Source publication and environment separation

Retain the reviewed candidate as an exact committed release SHA. Keep repository visibility unchanged. Exclude environment files, fixture ownership/configuration files, credentials, generated local database data and hardware keys. Preserve the root lockfile and additive migrations with that SHA. Record the three project IDs, root directories, build commands and dependency/boundary results before creating deployments.

All three ATLAS app roots now contain `vercel.json` with Git deployment disabled. Inspect the effective configuration of every project linked to the repository before pushing, including legacy projects outside these roots. The release audit found that a push of the current branch would start legacy Preview deployments with inherited credentials and without adequate protection. Do not use a branch push as this release's deployment mechanism while that remains true. First correct the linked-project configuration, or use a separately verified clean-checkout upload procedure that preserves the exact Git SHA metadata; record which procedure was actually validated. An app-local Git setting does not disable a different linked project.

Keep Preview deployments protected and without production database, SMS, bridge or model credentials. A Preview promotion is not sufficient: private runtimes require the actual production environment and exact release binding.

Vercel supplies `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_GIT_COMMIT_SHA`. Enable the relevant system-environment exposure and confirm that the resulting deployment has `production` mode, its exact generated deployment host and the reviewed 40-character SHA. Do not forge these fields to activate a preview. Never configure `ATLAS_LOCAL_*` flags in any hosted environment. No credential below belongs in a `NEXT_PUBLIC_*` variable or a browser bundle.

## Production environment names

This inventory names settings and their purposes, never secret values. Store each credential only in its receiving project's production environment. A dedicated key means independently generated key material; changing a key or another bound setting requires recomputing the relevant configuration and release activation.

| Public/router project setting | Purpose |
| --- | --- |
| `ATLAS_STAFF_DEPLOYMENT_ORIGIN` | Exact immutable HTTPS `*.vercel.app` origin of the selected staff deployment; no path, branch alias or arbitrary target |
| `ATLAS_CUSTOMER_DEPLOYMENT_ORIGIN` | Exact immutable HTTPS `*.vercel.app` origin of the selected customer deployment |
| `ATLAS_STAFF_ROUTER_KEY` | Dedicated 32-byte base64 HMAC key, shared only with the selected staff runtime |
| `ATLAS_CUSTOMER_ROUTER_KEY` | A different 32-byte base64 HMAC key, shared only with the selected customer runtime |
| `ATLAS_STAFF_DEPLOYMENT_BYPASS` | Optional server-only bypass for Vercel protection on the staff target; use only with the reviewed gateway bypass implementation |
| `ATLAS_CUSTOMER_DEPLOYMENT_BYPASS` | Optional separate server-only bypass for protection on the customer target |
| `ATLAS_PUBLIC_RUNTIME`, `ATLAS_PUBLIC_ORIGIN` | Production report reader selection and exact apex origin |
| `ATLAS_PUBLIC_DATABASE_URL` | Dedicated approved-report reader credential, `atlas_staff` schema and required TLS |
| `ATLAS_PUBLIC_MEDIA_ORIGIN`, `ATLAS_PUBLIC_MEDIA_KEY` | Exact separately activated approved-image service and its dedicated 32-byte base64 key |

| Staff project setting | Purpose |
| --- | --- |
| `ATLAS_STAFF_RUNTIME`, `ATLAS_STAFF_ORIGIN`, `ATLAS_STAFF_BASE_PATH` | PostgreSQL runtime, exact apex origin and `/admin` mount |
| `ATLAS_DATABASE_URL` | Restricted staff serving credential, `atlas_staff` schema and required TLS |
| `ATLAS_ADMIN_PHONES` | Comma-separated approved staff numbers in canonical international-phone format, with no duplicates; obtain the actual approved number |
| `ATLAS_AUTH_SESSION_KEY`, `ATLAS_AUTH_PHONE_KEY`, `ATLAS_STAFF_ROUTER_KEY` | Three independent 32-byte base64 keys; the router key matches only the public gateway's staff key |
| `ATLAS_AUTH_TWILIO_ACCOUNT_SID`, `ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID` | Dedicated staff phone-verification binding |
| `ATLAS_AUTH_TWILIO_API_KEY_SID`, `ATLAS_AUTH_TWILIO_API_KEY_SECRET` | Staff Verify transport credential |
| `ATLAS_OPERATIONS_ENABLED`, `ATLAS_OPERATIONS_DATABASE_URL` | Explicit enablement plus a separate restricted credential on the same staff database; required for operations and customer intake |
| `ATLAS_GRADING_BRIDGE_ORIGIN`, `ATLAS_GRADING_BRIDGE_KEY` | Exact separately activated evidence/grading adapter and its dedicated key; website deployment alone does not provide that service |

| Customer project setting | Purpose |
| --- | --- |
| `ATLAS_CUSTOMER_RUNTIME`, `ATLAS_CUSTOMER_ORIGIN` | PostgreSQL runtime and exact apex origin; `/account` is fixed by the build |
| `ATLAS_CUSTOMER_DATABASE_URL` | Independent customer gateway credential, `atlas_customer` schema and required TLS |
| `ATLAS_CUSTOMER_SESSION_KEY`, `ATLAS_CUSTOMER_PHONE_KEY`, `ATLAS_CUSTOMER_ROUTER_KEY` | Independent 32-byte base64 keys; the router key matches only the public gateway's customer key |
| `ATLAS_CUSTOMER_TWILIO_ACCOUNT_SID`, `ATLAS_CUSTOMER_TWILIO_VERIFY_SERVICE_SID` | Customer verification binding, with a Verify service distinct from staff |
| `ATLAS_CUSTOMER_TWILIO_API_KEY_SID`, `ATLAS_CUSTOMER_TWILIO_API_KEY_SECRET` | Dedicated customer Verify transport credential |

Runtime selector values are `postgres`; origins are `https://atlasgrading.com`; the staff base path is `/admin`; feature flags activate only on the exact value `true`. Set these deliberately in the production configuration. Staff/customer Verify services must be separately configured and checked for their actual ten-minute provider code lifetime; the application's five-minute challenge window and eleven-minute uncertainty quarantine do not reconfigure Twilio. Confirm approved SMS geography/service permissions with the actual accounts before the supervised login test. The first successful customer verification creates the account; it grants no staff authority.

Keep optional staff subsystems disabled until their separate service/control evidence is ready. Their exact configuration names are:

| Optional subsystem | Staff-side names |
| --- | --- |
| Source intake | `ATLAS_INTAKE_ENABLED`, `ATLAS_INTAKE_ORIGIN`, `ATLAS_INTAKE_DEPLOYMENT_ID`, `ATLAS_INTAKE_RELEASE_SHA`, `ATLAS_INTAKE_KEY`, `ATLAS_INTAKE_GRADING_POLICY_HASH` |
| Machine admission | `ATLAS_MACHINE_INITIALIZATION_ENABLED`, `ATLAS_MACHINE_INITIALIZATION_ORIGIN`, `ATLAS_OPERATOR_RUNTIME_HASH`, `ATLAS_MACHINE_ADMISSION_KEY`, `ATLAS_MACHINE_EXECUTION_KEY_HASH`; the execution key itself must be absent from staff |
| Identity correction | `ATLAS_IDENTITY_CORRECTION_ENABLED`, `ATLAS_IDENTITY_CORRECTION_ORIGIN`, `ATLAS_IDENTITY_CORRECTION_DEPLOYMENT_ID`, `ATLAS_IDENTITY_CORRECTION_RELEASE_SHA`, `ATLAS_IDENTITY_CORRECTION_KEY`, `ATLAS_IDENTITY_CORRECTION_GRADING_POLICY_HASH`, optional `ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON` |
| Trusted learning | `ATLAS_TRUSTED_LEARNING_ENABLED`, `ATLAS_TRUSTED_LEARNING_ORIGIN`, `ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID`, `ATLAS_TRUSTED_LEARNING_RELEASE_SHA`, `ATLAS_TRUSTED_LEARNING_KEY`, `ATLAS_TRUSTED_LEARNING_GRADING_POLICY_HASH` |
| NFC signing | `ATLAS_NFC_ENABLED`, `ATLAS_NFC_ORIGIN`, `ATLAS_NFC_DEPLOYMENT_ID`, `ATLAS_NFC_RELEASE_SHA`, `ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM`, `ATLAS_NFC_TRUST_JSON`; leave disabled for this website release |

The public-media adapter lives separately under the legacy-side internal ATLAS service. Its own settings include `ATLAS_PUBLIC_MEDIA_RUNTIME`, `ATLAS_PUBLIC_MEDIA_ORIGIN`, `ATLAS_PUBLIC_MEDIA_KEY`, `ATLAS_PUBLIC_MEDIA_STORAGE_ENDPOINT`, `ATLAS_PUBLIC_MEDIA_STORAGE_BUCKET`, `ATLAS_PUBLIC_MEDIA_STORAGE_REGION`, `ATLAS_PUBLIC_MEDIA_STORAGE_ACCESS_KEY_ID` and `ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY`. Verify its actual source configuration and `PublicMediaControl` on that deployment; never copy storage credentials into the public website. [Public reader/service boundary](../../frontend/atlas-public/README.md).

## Database ownership and migration sequence

All ATLAS migrations are owned by `frontend/atlas-app/prisma/migrations`. The public and customer Prisma schemas generate restricted clients; neither is an independent migration authority. `atlas_customer` references `atlas_staff` in the same reviewed database. Inspect the existing migration ledgers and target database before applying anything; the disposable harness's creation/seeding commands are not production provisioning commands.

1. Retain a current backup and the target database's migration/control inventory. Use an explicit operator/migration credential outside the Vercel projects. Record planned action in `SESSION_LOG.md` before migration or deployment, and observed results afterwards.
2. If there is an active prior staff release, explicitly disable its `StaffControl` and `StaffNfcControl` first. The additive `20260909010000_admin_path` migration deliberately refuses an active production control. It preserves old metadata and forbids re-enabling production NFC. Do not edit old migrations or rewrite their receipts.
3. Apply the reviewed staff migration chain, including `20260909010000_admin_path` and `20260909020000_customer_accounts`, using the app-owned schema. In the isolated migration process only, bind `ATLAS_DATABASE_URL` to the reviewed migration credential and run `pnpm --filter @atlas/staff-app exec prisma migrate deploy --schema prisma/schema.prisma` from the repository root. Inspect pending/status output before and after. Do not run legacy schema migrations merely because this website release is being prepared.
4. Provision separate login roles and generate the exact grants from the source helpers below. Remove ambient `PUBLIC` or role-membership permissions that would exceed the allowlists. The applications check effective privileges, including inherited rights, and will refuse a broader role. Never grant a web role control activation, role provisioning, ownership, schema creation or generic legacy access.
5. Create or update disabled release controls with the exact reviewed deployment IDs, source SHA, mode, origin and computed configuration hashes. Compute hashes with that release's configuration constructors, not a manually reconstructed formula. Install the intended staff identity/training and a bounded operations grant using operator authority; a customer signup or environment phone allowlist alone is not a reviewer assignment or operations grant.
6. Check the restricted credentials against their actual database and exercise disabled denials. Activate only the prepared controls in the cutover sequence below. Keep migration credentials out of all web settings and logs.

| Credential | Authoritative grant generator | Scope |
| --- | --- | --- |
| Staff serving | `staffGrantSQL` in `frontend/atlas-app/lib/server/access/privileges.mjs` | Exact staff table/column writes and named functions; no account tables or activation |
| Staff operations | `operationsGrantSQL` in `frontend/atlas-app/lib/server/access/operations-authority.mjs` | Narrow operations writes and `atlas_staff.customer_operations(text,text,text,jsonb,jsonb)`; no direct `atlas_customer` table access |
| Public reader | `publicGrantSQL` in `frontend/atlas-public/lib/server/privileges.mjs` | Only the three approved-report/image/trace read functions; no table or sequence permissions |
| Customer serving | `customerGrantSQL` in `frontend/atlas-customer/lib/server/database.mjs` | Schema usage and only `atlas_customer.customer_call(text,jsonb,jsonb)`; no customer table access or staff functions |

Staff/customer current controls are `atlas_staff."StaffControl"` and `atlas_customer."CustomerControl"`. Public approved reads use `atlas_staff."PublicReaderControl"`; approved media, grading, intake, operator and finishing have independent controls. Enabling the website is not an instruction to enable all of those controls. Configuration/release changes require fresh bindings and control revisions; preserve session, challenge, submission and operation history.

## Disabled-first cutover

1. Finish the local candidate checks below, resolve the source-publication gate above, and create staff/customer **production** deployments of the exact reviewed SHA with controls disabled and optional worker/NFC features disabled. Capture their immutable deployment hosts and effective Node/function settings. Preview runs remain protected and unprivileged.
2. Configure the public production build with those exact origins and the two distinct routing keys. If a target uses Vercel deployment protection, provide its separate gateway-only bypass setting with the reviewed implementation. The gateway must discard incoming `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie`, then inject only the selected upstream's bypass header. It must not create bypass cookies, use query-string secrets or forward a bypass to another destination. ATLAS's HMAC proof alone does not bypass Vercel's protection layer. [Vercel automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).
3. Deploy the public candidate and bind the apex through the actual domain/DNS account. Verify SSL and the selected project before changing traffic. A branch alias, staff subdomain redirect or generic wildcard rewrite is not the release route contract.
4. With database controls still disabled, verify forwarding at the apex and direct-deployment refusal. Retain redacted evidence of the actual Host/forwarded-host/protocol behavior, path, method, destination deployment and status. Do not log cookies, CSRF tokens, route proofs, bypass secrets, phone codes or database URLs. A Vercel sign-in/interstitial response is a routing failure, not an ATLAS auth result.
5. Match and enable customer and staff controls for the exact deployed releases only after their SMS/identity inputs are ready. Advance revisions, issue fresh sessions and the intended bounded operations grant. Enable the public reader/media controls only with their exact approved-storage bindings. Keep grading/operator features disabled until their separate pilot admission, resource and spending requirements are met.
6. Perform the supervised website pilot below. Record actual results and gaps before expanding traffic or workload. Customer submissions must show only configured dealer-drop-off or mail-in instructions; obtain the real receiving destination rather than inventing an address or promised completion date.

The router owns exact `/admin` and `/account` path segments. It signs method, complete target, zone, apex, destination and time; private server handlers validate the short-lived proof and still perform their own authentication/authorization. Preserve Cookie, Origin and the appropriate CSRF header through forwarding. The staff cookies are Secure/HttpOnly with `Path=/admin`; customer cookies use different names and `Path=/account`. Public report responses set no session cookie. These paths and separate builds do not isolate same-origin JavaScript: all three apps' browser dependencies remain part of the same-origin security boundary.

## Acceptance evidence to retain

Run from a clean, credential-free local environment against the reviewed source. Build commands below generate clients and inspect actual output; they do not activate production:

```sh
pnpm install --frozen-lockfile
pnpm --filter @atlas/staff-app build
pnpm --filter @atlas/public-app build
pnpm --filter @atlas/customer-app build
pnpm --filter @atlas/site-router test
pnpm --filter @atlas/staff-app test
pnpm --filter @atlas/public-app test
pnpm --filter @atlas/customer-app test
```

The lead-owned PostgreSQL acceptance and `scripts/atlas-website/local-pilot.mjs` use an owned disposable loopback cluster and synthetic SMS. Supply `--ack-disposable-local-postgres`, `--postgres-bin` and `--pg-module` for the verified local binaries/modules; add `--serve` only when intentionally retaining the local pilot. Never point these fixtures at production. A loopback proxy or synthetic provider pass does not establish Vercel middleware behavior or live SMS.

Retain production evidence for these concrete checks:

| Check | Required observation |
| --- | --- |
| Whole-path routing | `/admin`, nested card/operations pages and assets reach staff; `/account`, submission details and assets reach customer; `/administrator`, `/accounting` and unmounted private APIs do not fall back to a private app |
| Signed forwarding | Correct requests through the apex work; direct deployment/old-host requests, forged caller routing headers, wrong target/method/zone and expired proofs cannot authorize private handlers |
| Staff access | Approved staff phone completes real SMS login; unapproved phone and customer cookie cannot authorize staff; roles, assignments, current revision and fresh operations grants remain enforced |
| Customer access | New verified phone creates one account; returning formatted number selects that account; wrong/expired codes and uncertain replies do not invent login; customer IDs/cursors from another account are denied |
| Browser navigation | Dashboard → submission → another submission → Back/Forward and direct refresh load the correct data; logout/revocation clears access; retained uncertain submissions reconcile by their own request ID across navigation/reload |
| Receiving and tracking | Address/intake method snapshots remain unchanged after profile edits; staff explicitly binds a physically received exact card; a mixed-card submission keeps per-card stages; revised approvals or replacement finishing records invalidate stale current stages |
| Shipping | Approval, label creation and NFC alone do not mark shipped; only an explicit human dispatch with the current exact approval/finishing chain records a shipment |
| Grading transport | A supervised authorized long request survives apex forwarding; only its terminal envelope determines success; disconnect/lost reply retains the original operation and never triggers an automatic paid retry |
| Public report boundary | Only approved versions and exact approved media/traces render; pinned version URLs retain their version; drafts, private notes and customer/staff credentials remain unavailable |

Do not copy earlier subdomain test totals into this release's acceptance. Record exact commands, source SHA, build outputs, fixture results and hosted observations separately. Actual customer tracking and an approved report do not attest a completed physical finishing pilot.

## Worker, Astra and NFC dependencies

The three website projects do not host the complete grading system. Real Speedster source admission, approved-image storage, grading bridge and worker release still require their own exact deployments, dedicated credentials and activated policy. Current runtime constructors explicitly refuse missing or mismatched bindings. Keep provider/worker tests within the same owner-approved ten-card cohort and the agreed spending ceiling; a software timeout does not prove that work was uncharged.

The Astra runner is a separately packaged process. Its names are `ATLAS_OPERATOR_ENABLED`, `ATLAS_OPERATOR_RELEASE_SHA`, `ATLAS_OPERATOR_BUILD_HASH`, `ATLAS_OPERATOR_RUNTIME_HASH`, `ATLAS_OPERATOR_DATABASE_URL`, `ATLAS_OPERATOR_OPENAI_PROJECT_ID`, `ATLAS_OPERATOR_OPENAI_API_KEY`, `ATLAS_OPERATOR_EVIDENCE_ORIGIN` and `ATLAS_OPERATOR_EVIDENCE_KEY`. Initialization-capable releases additionally need `ATLAS_MACHINE_INITIALIZATION_ORIGIN`, `ATLAS_MACHINE_EXECUTION_KEY`, `ATLAS_MACHINE_ADMISSION_KEY_HASH` and `ATLAS_MACHINE_INITIALIZATION_ENABLED`. Those provider/execution credentials do not belong in the public/customer projects, and the staff project receives admission authority only. [Runner release contract](../../packages/atlas-operator/README.runtime.md).

The current verified artifact packaging supports the reviewed macOS executable/native closure; it is not an accepted Linux deployment artifact or a selected production runner host. A Linux host needs its own reviewed Node/Prisma native closure and release manifest. No synthetic Astra response establishes live model quality, latency or cost. Human review and exact-version approval remain required.

Production NFC is deliberately disabled by the `/admin` migration. The observed Mac test write and phone read do not qualify permanent F8215 locking, the signed native browser bridge, hosted acknowledgement, label/tag association or automatic station progression. Those require separate hardware/protocol acceptance and a reviewed enabling migration. Preserve explicit human assembly/welding and dispatch evidence. [Mac NFC status](MAC_NFC.md).

## Rollback without destructive SQL

1. Stop new admissions and disable the affected current controls, advancing their revisions under operator authority. Preserve unknown/in-flight operation IDs for explicit reconciliation; do not assume a disconnected model/worker request stopped or retry it with a new ID.
2. Remove the affected private target from the public router configuration and redeploy so that area returns its controlled unavailable response, or restore a previously accepted `/admin`/`/account`-compatible release with its own exact controls. Recheck the production environment, immutable destinations, keys and proof behavior after the change. Do not restore the old staff subdomain as a hidden fallback.
3. If reverting the public deployment, update its reader activation to that exact reviewed deployment/configuration before claiming reports are available. Unchanged approved report tokens and versions must continue to identify the same immutable packets.
4. Revoke/rotate a compromised credential and disable its release before reactivation. Keep Preview protection in force and remove an obsolete upstream bypass from the gateway when it is no longer used.
5. Retain every submission/address snapshot, challenge/session history, approval, operation, receipt and migration. Do not drop `atlas_customer`, delete records, reverse the additive migrations, rewrite finishing history or use `db push` to make old code fit. Record the observed rollback result and remaining reconciliation work in the handoff.

For a release-specific failure, an unavailable private area with intact history is the expected rollback state until a compatible release is verified.
