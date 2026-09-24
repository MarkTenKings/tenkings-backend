# Customer intake, commerce and dealer release readiness — 2026-09-24

**Status: source reviewed; synthetic privacy and48→52 upgrade evidence passed. Actual configuration, final source artifacts and provider acceptance still gate activation.** This is a release checklist and cold configuration template, not a deployment receipt or authorization to run production commands. The review made no production reads/writes, grants, control changes, purchases, messages or hardware actions. Root reports that ordinary Vercel authentication is restored and live metadata contains no customer commerce configuration; that report is not independent provider qualification.

## Findings and reviewed boundaries

1. **Customer intake location exposure — fixed and verified by final SQL fixture.** Migration49 originally returned `CustomerIntakeDraft.locationSnapshot` verbatim. After51 installed the actual registry lookup, that exposed dealer/terminal/printer identifiers through intake reads even after commerce projections were fixed. Root added `intake_public_*` recursive allowlists while preserving the stored location snapshot. Migration50 now independently allowlists customer commerce checkout/quote/order responses. Final dealer privacy fixture passed nine groups against95/52, retaining the full private location snapshot while denying its exposure through customer intake/commerce responses.
2. **Upgrade evidence gap — closed for the synthetic PostgreSQL15.19 fixture.** The original disposable harness applies all52 migrations before creating the customer-serving grant. It proved fresh-schema functionality, not49's transfer of an existing schema48 grant or preservation of existing customer histories. The owned48→52 rehearsal passed nine groups, preserving all238 existing tables (18 populated), old ledger rows, ACLs and original session/request continuity without regranting. Evidence: `validation/atlas-upgrade-20260924/acceptance.json`. Actual production PostgreSQL17 and its historical112-entry public ledger still need target-specific inventory/qualification.
3. **Configuration and actual acceptance remain missing.** No merchant, tax classification/sourcing, FedEx account/package plan, receipt sender, actual kiosk schedule/device registry or fresh operations grant is inferred. Mail turnaround start and charged shipping legs remain owner decisions. The full new customer funnel must not be publicly promoted with uploads or payment unavailable.

No additional actionable source issue was found in this bounded review. The review covered canonical49–52, the original customer gateway/profile constraints, private role verifier, signed customer service, dealer staff service, private server routing and browser policy. It is not a live database census or comprehensive provider/hardware audit.

Confirmed from source:

- Tracked predecessor migrations through48 (`20260924030000_manual_research_effects`) are unchanged. New migrations contain no top-level backfill/update/delete of prior customer or grading histories.
- Migration49 retains the old gateway by renaming it `customer_call_v1`, copies existing explicit non-owner EXECUTE grants to the new gateway, then removes those grants from the old gateway. The wrapper delegates original actions to the retained implementation. Migration50/51 use `CREATE OR REPLACE`, preserving wrapper ownership/ACLs. All new internal helpers revoke PUBLIC execution.
- `valid_profile_legacy` retains the old shape; the replacement validator accepts legacy profiles without email and validates optional email. New checkout review requires email separately. No old profile or submission snapshot is rewritten.
- New `CommerceControl` and `CustomerServiceControl` rows are not seeded; absent rows refuse admission. Their `enabled` defaults are false. Identification has a separate false default. Dealer locations default disabled; no location, schedule, membership or commission balance is invented.
- Immutable quotes/orders/provider records and dealer history remain stored in full. Customer projections omit operational internals. Paid order insertion and dealer paid-card materialization occur in one transaction. No existing old submission is converted into a paid order. Unknown payments/labels are not automatically recreated.
- `customer_private_call` is the only application function allowed to the separate private customer DB role. It checks current customer/service bindings before ordinary work. The narrow `response`/`fail` exception can retain an already-dispatched intake result against its original still-valid lease after admission is revoked; it cannot begin a new effect.
- The dealer staff bridge uses the existing authenticated WeakMap staff handle and reauthenticates through the manual boundary and SQL. Reviewer status is required; location/membership configuration additionally needs an existing exact-deployment operations grant and a staff session younger than five minutes. No UI or transport can mint a human grant.
- Disabled private customer startup returns before constructing any customer database/provider client. Existing manual startup still uses its existing credentials and routes. `node --test packages/atlas-connected-manual/test/customer-runtime.test.mjs` passed4/4 using injected clients and loopback-only HTTP. No customer credentials are required when `ATLAS_CUSTOMER_SERVICE_ENABLED` is absent or false, even if a commerce flag is present. The new packages must still be included in the qualified native source/image closure.

## Ordered migration and preservation checklist

- [ ] Freeze an exact reviewed commit and canonical migration checksums after the final privacy/upgrade fixtures. Do not apply a specialist proposal fragment independently.
- [ ] Read the actual target's `atlas_staff._prisma_migrations` and existing public ledger. Confirm the predecessor state is48 with unchanged checksums and no failed/pending partial migration. The fresh fixture's95 public migrations are not a claim about the production historical public ledger.
- [ ] Capture the current gateway function owner/signature/body hash/ACL and existing role census. Confirm exactly one intended `customer_call(text,jsonb,jsonb)`, no preexisting `customer_call_v1` conflict/overload, and no unexpected grant-option dependencies. Use the same authorized migration owner; do not temporarily grant serving roles ownership or schema creation.
- [ ] Capture aggregate counts and stable hashes for existing CustomerAccount profiles, CustomerSubmission, CustomerCard, CustomerCardEvent, customer controls, original grading/approval/finishing histories and relevant ACLs. Do not print phones, addresses, credentials, tokens or row bodies into logs.
- [x] Complete the owned48→52 rehearsal with those categories seeded before49. Verify original gateway usability, `customer_call_v1` denial to the serving role, old history hashes unchanged and absence of new enabled controls. Preserve checksum/no-op evidence.
- [ ] Only within a separately authorized, logged release action, run the staff migration pipeline in this exact order:

| Ordinal | Canonical migration | Effect |
| --- | --- | --- |
|49|`20260924060000_customer_photo_intake`|Add intake tables/worker, compatible profile validator, original gateway wrapper/ACL transfer and safe intake location projection.|
|50|`20260924061000_customer_commerce`|Add cold commerce control, quotes/payments/orders/outbox, private provider functions, safe customer outputs and payment draft locks.|
|51|`20260924062000_dealer_custody_tracking`|Add actual location/membership/session/custody/commission records; attach the paid-order trigger; extend the customer gateway.|
|52|`20260924063000_customer_private_service`|Add cold private-service control and its one-function DB gateway.|

- [ ] Each file is transactional. If one fails, inspect the exact retained ledger/error and use the established migration recovery process. Do not edit applied bytes, skip a failed migration or reset a database.
- [ ] Compare post-migration predecessor checksums/history hashes/ACLs, validate the new52-entry staff ledger and repeat the migration command only as the standard no-op verification. Confirm no provider worker/control was enabled by migration.

## Exact serving-role separation

Real role names and secret values remain unset. Generate grant text with the reviewed helpers and the actual validated role name. Create a new private login with no superuser, role/database creation, replication, BYPASSRLS, role memberships, schema/database CREATE, application table/column access or sequence access. Its sole application EXECUTE privilege must be the function below. Retain the existing customer/public/staff identities; do not reuse them as the private customer role.

| Identity | Exact added/retained privileges | Runtime check / helper |
| --- | --- | --- |
|Existing customer web DB login|USAGE `atlas_customer`; EXECUTE `atlas_customer.customer_call(text,jsonb,jsonb)` only.49 transfers the existing grant; no additional provider/worker function grant.|`frontend/atlas-customer/lib/server/database.mjs`: `customerGrantSQL`, `assertCustomerPrivileges`|
|New private customer DB login|USAGE `atlas_customer`; EXECUTE `atlas_customer.customer_private_call(text,jsonb,jsonb)` only. No direct `customer_call`, `intake_worker_call`, `commerce_provider_call` or dealer-table access.|`packages/atlas-connected-manual/scripts/customer-database.mjs`: `customerPrivateGrantSQL`, `assertCustomerPrivatePrivileges`|
|Existing separately restricted manual-serving DB login|Add only USAGE `atlas_dealer` and EXECUTE `atlas_dealer.staff_call(text,text,text,jsonb,text[],jsonb)`; preserve its previously reviewed manual grants. Do not add these grants to the staff-auth web login.|`packages/atlas-connected-manual/src/dealer-operations.mjs`: `dealerStaffGrantSQL`|
|Public web / report DB login|No new database grant. The public directory uses the separate signed directory transport key.|`frontend/atlas-public/lib/server/runtime.mjs`|

Verify actual effective privileges under each serving login after provisioning, including PUBLIC and inherited privileges. The customer/private verifiers reject any extra non-system application function or table access. Expected owner migration privileges are not serving privileges. Do not grant `atlas_dealer.reverse_commission` to customer/public/manual-serving roles as part of this release; there is no payout UI/effect.

## Control bindings and activation order

These are different controls and must not be copied interchangeably:

| Control | Required value source | Cold state |
| --- | --- | --- |
|`atlas_customer.CustomerControl`|The actual customer web deployment's `makeConfig(...).binding`: exactly `mode, origin, deploymentId, releaseSha, configHash`. Origin is `https://atlasgrading.com`; deployment ID is its immutable Vercel host, not the public/staff host. Existing revision guard requires each update to increment revision exactly once; existing sessions will be invalidated.|Preserve the current existing customer binding until the coordinated cutover; no blind enable/update.|
|`atlas_customer.CustomerServiceControl`|`binding` must equal both the new customer web binding above and private `ATLAS_CUSTOMER_SERVICE_BINDING_JSON`. `identificationEnabled` is separately reviewed.|Absent or `enabled=false`; identification false.|
|`atlas_customer.CommerceControl`|`binding` must equal `{configHash: ATLAS_COMMERCE_CONFIG_HASH, merchant: payment.binding}`; merchant is exact `{provider,accountId,livemode}` from qualified provider configuration. `merchant`, owner-approved `terms`, and server-measured `shippingPlans` must match private adapters. This is not the five-field customer deployment binding.|Absent or `enabled=false`; terms UNCONFIGURED; shippingPlans empty.|
|Existing staff control / operations grant|Preserve ordinary staff deployment/identity/access checks. To configure actual kiosks/memberships, a real existing StaffOperationsGrant must match staff access version/control revision/deployment and expiry, followed by ordinary fresh staff sign-in.|No grant or human identity is manufactured by this checklist.|

- [ ] Package and qualify customer/public/staff artifacts and the private native image with source closure including `packages/atlas-commerce/src/projections.mjs` and the signed service bridge. Keep new flags cold while qualifying; no public promotion of the incomplete new flow.
- [ ] Provision only the reviewed new private DB role, separate transport keys, storage/provider credentials and explicit ingress routes in protected custody. This document contains no ready-to-use secret or invented account.
- [ ] Build and retain the exact intended customer binding from the actual future deployment. Bind private CustomerServiceControl and private environment to that same customer binding; keep commerce and paid identification disabled until their separate qualification is complete.
- [ ] Plan the CustomerControl revision/binding cutover with the customer deployment/routing change. A bound control switch is not an innocuous environment edit: it invalidates sessions and old deployment access. Reconcile independently before promoting aliases.
- [ ] Populate genuine kiosk configuration and membership through authorized staff setup. An enabled flag does not qualify a terminal/printer; validate the actual merchant-linked reader/location and physical package workflow separately.
- [ ] Activate measured storage/upload verification and approved identification, then actual tax/payment/shipping/receipt adapters and matching CommerceControl only after required owner/provider decisions and acceptance. Native workers start on process admission when their corresponding flags are true; this is an effect boundary, not a read-only smoke test.
- [ ] Promote the complete customer funnel only after real upload, exact quote, approved payment method, receipt/label recovery and customer/dealer tracking acceptance are possible. Do not advertise a usable checkout backed by missing provider configuration.
- [ ] For a failure after paid work begins, stop new admission/dispatch, retain saved records and reconciliation capability, and use a reviewed forward fix. Do not erase new tables, alter paid snapshots or create replacement payment/label IDs to simulate rollback. Merchant/config rotation with unresolved payment/label effects needs a specific recovery plan.

## Cold configuration templates

Runnable template files and a static no-network configuration checker are now in `packages/atlas-commerce/config/` and `packages/atlas-commerce/scripts/check-configuration.mjs`; see `packages/atlas-commerce/CONFIGURATION.md`. It reports missing/invalid key names without values. Local shape checks never establish actual provider qualification.

Commented entries are intentionally **unset**. Supply them only from confirmed deployment/provider/location information and existing protected secret custody. None of these examples is a complete production environment. Keep the existing ordinary manual/customer authentication configuration unchanged while preparing additions.

Private native service additions:

```dotenv
ATLAS_CUSTOMER_SERVICE_ENABLED=false
ATLAS_CUSTOMER_INTAKE_ENABLED=false
ATLAS_CUSTOMER_IDENTIFICATION_ENABLED=false
ATLAS_COMMERCE_ENABLED=false
ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED=false
# ATLAS_CUSTOMER_SERVICE_BINDING_JSON=
# ATLAS_CUSTOMER_PRIVATE_DATABASE_URL=
# ATLAS_CUSTOMER_SERVICE_KEY=
# ATLAS_CUSTOMER_DIRECTORY_KEY=
# ATLAS_CUSTOMER_STORAGE_ENDPOINT=
# ATLAS_CUSTOMER_UPLOAD_ORIGIN=
# ATLAS_CUSTOMER_STORAGE_BUCKET=
# ATLAS_CUSTOMER_STORAGE_REGION=
# ATLAS_CUSTOMER_STORAGE_ACCESS_KEY=
# ATLAS_CUSTOMER_STORAGE_SECRET_KEY=
# ATLAS_CUSTOMER_OPENAI_KEY=
# ATLAS_CUSTOMER_GOOGLE_VISION_KEY=
# ATLAS_COMMERCE_CONFIG_HASH=
# ATLAS_COMMERCE_PROVIDER=
# ATLAS_COMMERCE_MODE=
# ATLAS_COMMERCE_STRIPE_ACCOUNT_ID=
# ATLAS_COMMERCE_STRIPE_SECRET_KEY=
# ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY=
# ATLAS_COMMERCE_STRIPE_API_VERSION=
# ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET=
# ATLAS_COMMERCE_TAX_CODE=
# ATLAS_COMMERCE_SHIPPING_TAX_CODE=
# ATLAS_COMMERCE_TAX_ADDRESS_SOURCE=
# ATLAS_COMMERCE_TAX_SOURCING_POLICY=
# ATLAS_COMMERCE_FEDEX_CLIENT_ID=
# ATLAS_COMMERCE_FEDEX_CLIENT_SECRET=
# ATLAS_COMMERCE_FEDEX_ACCOUNT_NUMBER=
# ATLAS_COMMERCE_FEDEX_ENVIRONMENT=
# ATLAS_COMMERCE_MAIL_CLOCK_START=
# ATLAS_COMMERCE_MAIL_CHARGED_LEGS=
# ATLAS_COMMERCE_EMAIL_PROVIDER=
# ATLAS_COMMERCE_EMAIL_API_KEY=
# ATLAS_COMMERCE_EMAIL_FROM=
# ATLAS_COMMERCE_SMS_PROVIDER=
# ATLAS_COMMERCE_SMS_ACCOUNT_SID=
# ATLAS_COMMERCE_SMS_API_KEY_SID=
# ATLAS_COMMERCE_SMS_API_KEY_SECRET=
# ATLAS_COMMERCE_SMS_SERVICE_SID=
```

The private DB URL must identify the new function-only login, the intended existing database, `schema=atlas_customer` and `sslmode=require`. Do not output it in evidence. Customer service/ directory keys each need canonical base64 encoding of distinct32-byte values and must differ from existing manual service/public-read/customer session/phone/router keys. The runtime currently supports a configured Stripe payment adapter, SendGrid receipt email and Twilio receipt SMS; their presence in source does not select or qualify a merchant/sender. The FedEx environment must agree with the payment live/test mode. Do not substitute zero tax for missing classification/sourcing. Mail terms remain unset until the owner answers both open decisions.

Customer Vercel server additions, separate from its existing customer authentication variables:

```dotenv
ATLAS_COMMERCE_ENABLED=false
# ATLAS_CUSTOMER_SERVICE_URL=
# ATLAS_CUSTOMER_SERVICE_KEY=
# ATLAS_CUSTOMER_UPLOAD_ORIGIN=
```

`ATLAS_CUSTOMER_SERVICE_URL` is only the canonical private HTTPS origin, with no path/user/password. The server key is the same dedicated service transport key held by the private service; it must never be a browser/NEXT_PUBLIC variable. The customer site's `ATLAS_COMMERCE_ENABLED` controls payment CSP admission only; it does not itself authorize payment or replace the private SQL control. The upload origin must exactly match the private signer's resulting upload URL origin. Do not copy provider secrets or the private DB URL into the customer web environment.

Public Vercel server additions:

```dotenv
# ATLAS_CUSTOMER_SERVICE_URL=
# ATLAS_CUSTOMER_DIRECTORY_KEY=
```

The public app receives the directory-only key, never the full customer service key. It has no customer DB grant. Unknown location coordinates/schedules and terminal/printer references belong in no template: supply them as real structured registry records through staff operations after qualification. New location enabled remains false until explicitly approved; authorization expiry and actual pickup/cutoff/return timezone/exceptions must be entered, not inferred.

## Private ingress / Caddy routing

Extend the existing private HTTPS site's explicit path allowlist to the same qualified native server listener; do not change its existing manual/public routes or expose a generic `/internal/*` proxy. The origin/listener hostname and port are deployment facts to inspect, not values supplied by this document. Required exact new paths are:

| Method | Path | Authority |
| --- | --- | --- |
|POST|`/internal/customer-service/v1/intake-sign`|Full customer service signature plus real original customer session/browser/deployment.|
|POST|`/internal/customer-service/v1/intake-complete`|Same; verifies owned exact uploaded bytes.|
|POST|`/internal/customer-service/v1/commerce-checkout`|Same; safe customer response.|
|POST|`/internal/customer-service/v1/commerce-quote`|Same; private provider quote authority.|
|POST|`/internal/customer-service/v1/commerce-pay`|Same; durable reserved payment.|
|POST|`/internal/customer-service/v1/commerce-reconcile`|Same; original payment retrieval.|
|POST|`/internal/customer-service/v1/dealer-locations`|Full service or distinct directory-only signature; no customer identity authority implied.|
|POST|`/internal/commerce/stripe-webhook`|Stripe signature over unchanged raw bytes, followed by exact provider retrieval/binding. No customer HMAC or fake session shortcut.|

Preserve original paths, HTTP method, body bytes and the customer time/nonce/signature or Stripe signature headers through the proxy. Signed requests are bounded at128KiB; customer service responses at2MiB. Webhook raw body is bounded at256KiB. Labels use the separate owner-authenticated customer GET, not the2MiB private transport. Confirm unauthenticated/wrong-key/wrong-method/tampered/replayed requests fail closed before any real provider effect. The default nonce store is one process; use one private serving process until a shared atomic nonce store is explicitly wired and qualified for multiple replicas.

Do not configure provider webhook delivery merely as an ingress test: registering/enabling it is part of the approved provider activation. Keep the unconfigured endpoint cold. Staff `/api/staff/manual-connected/dealer-operations` uses the existing signed manual proxy path; its GET and four POST suffixes (`location-configure`, `membership-configure`, `custody`, `bind-manual`) require the new dealer staff grant/feature switch but no new arbitrary proxy route.

## Browser, storage and payment policy acceptance

- `/account` must retain `camera=(self), microphone=(), geolocation=(self)` on both the customer app and public path gateway. Public non-customer pages do not inherit camera access. Staff camera policy remains separate.
- Customer CSP stays nonce-based. Direct uploads add only the exact configured HTTPS `ATLAS_CUSTOMER_UPLOAD_ORIGIN` to `connect-src`. The private bucket must have actual signed PUT/checksum-required CORS permissions for the customer site's origin and necessary signed headers, reject anonymous/public reads/writes, and retain the source-object guarantees required by the storage adapter. Verify those actual settings; do not guess a bucket/endpoint from existing staff media.
- When the customer payment CSP flag is deliberately enabled: `script-src` adds `https://js.stripe.com https://*.js.stripe.com`; `frame-src` adds those plus `https://hooks.stripe.com`; `connect-src` adds `https://api.stripe.com`. The merchant, key mode and actual secure form must still be qualified independently.
- Customer map frames allow `https://maps.google.com`; only genuine configured coordinates produce location maps. Public dealer directory keeps its existing map policy and directory-only signed server read. Customer permission denial remains usable without location access.
- Check private/no-store headers, no-referrer behavior, owner-scoped label access and saved paid recovery after configuration disables. Verify new payloads do not contain kiosk devices, dealer IDs, merchant/tax/payment/shipment internals or raw photos.

## Evidence still required for release

Exact source/image and three-app artifacts after final edits; actual DB-role/control/ingress inventories; genuinely configured separate transport/storage/provider credentials; owner mail clock/leg decisions; merchant/tax/FedEx/sender qualification; real kiosk authorization/schedule/linked equipment; deliberate human operations grant and ordinary fresh sign-in; end-to-end customer/provider acceptance authorized separately from synthetic tests. The software checks do not establish physical receipt, printing, delivery, grading approval or payout.
