# ATLAS staff access

Current owner target, September 9: private grading at `https://atlasgrading.com/admin`, with the root website serving customers. The [website release plan](WEBSITE_RELEASE.md) supersedes the staff URL and cross-origin assumptions below. Runtime still enforces the old subdomain. The new path-scoped cookies, authenticated staff boundary, deployment binding and additive database policy must be implemented and tested together; no `/admin` activation is claimed here.

Status: implementation decision and live acceptance contract, September 7 Pacific / September 8 UTC, 2026. The [staff application](../../frontend/atlas-app/README.md) implements separate PostgreSQL-backed identity, verification/session, assignment and immutable review storage, plus a dedicated Verify transport. Local integration is tested with synthetic credentials and evidence. Live production and preview access remain inactive. No live provider service, credential, staff account, environment variable or deployment has been created.

## First version

Use phone-code sign-in for the private grading application at `app.atlasgrading.com`. The owner maintains a server-only `ATLAS_ADMIN_PHONES` allowlist in the staff Vercel project. The staff experience is:

1. The owner adds a staff phone number to the approved list.
2. The staff member enters that number and requests a code.
3. They enter the code received on their phone.
4. Successful verification opens the grading workspace. The first approved login creates their ATLAS staff identity; later logins use the same identity.

Only approved numbers can enter. No separate public registration form is needed for this version. Administrative access does not automatically qualify a person to certify grades or approve trusted learning; those actions retain the trained-human assignment and exact-revision requirements in [CONTRACTS.md](CONTRACTS.md).

The owner's unfinished consumer-facing GPT Pages draft is a separate future input for `atlasgrading.com`. Its design has not been imported or reviewed. It does not determine the staff application's sign-in or grading workflow.

## Why phone verification need not wait for a sending number

Ten Kings source already uses Twilio Verify: `backend/auth-service/src/index.ts` calls the Verify service's verification and verification-check APIs. Twilio's [Node/Express Verify quickstart](https://www.twilio.com/docs/verify/quickstarts/node-express) says Verify handles the sending number, so an application does not need to purchase its own number. Twilio's [US A2P 10DLC guidance](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) directs verification-only applications to Verify without ordinary A2P registration.

Use a distinct ATLAS Verify service and purpose-specific configuration, potentially within the existing Twilio account. Actual account status, destination-country permissions and service readiness must be checked before activation. These documented product capabilities do not prove that an ATLAS service is already configured or promise immediate delivery in every country. Live verification has provider charges; local development uses a stub and sends no messages.

Google sign-in with a verified-email allowlist is the alternative if the owner prefers to avoid SMS entirely. It still needs its own OAuth client and verified identity checks. It is not selected merely to avoid an ordinary SMS sender-registration process that Verify already handles.

## Server boundary

- Parse the allowlist into canonical E.164 numbers, reject malformed configuration, and deny an empty list. Never expose the list or provider credentials through `NEXT_PUBLIC_*`, browser code or public responses. Check approval before sending a code, at successful verification, and on every authorized request.
- Use separate ATLAS provider configuration and staff sessions. Do not reuse the existing Ten Kings auth handler: it creates shared sessions and wallets and has a different product scope. A provider may establish identity; it does not grant access to the Ten Kings wallet, Vault, certification or machine tools.
- Store the challenge durably on the server, binding its random browser nonce, canonical phone number, ATLAS service, exact Verification SID, expiry, attempt budget and consumption state. Check the code against that SID using Twilio's [Verification Check API](https://www.twilio.com/docs/verify/api/verification-check). Accept only an authenticated provider response with the expected account/service/SID/phone/channel and approved status. A client-provided verified flag, phone number alone, stale response or successful code from another service is insufficient.
- Make challenge consumption and staff-session issuance atomic and idempotent. Concurrent checks or a lost response cannot create unrelated sessions or reuse a consumed challenge. Bound send/check attempts and resend frequency per challenge, phone and client, with a global abuse limit. Unknown send outcomes are reconciled before sending again. Do not log codes, full phone numbers, cookies or raw provider responses.
- Use a short, revocable opaque session in a host-only `__Host-atlas_staff` cookie: `HttpOnly`, `Secure`, `Path=/`, `SameSite=Lax`, no `Domain`. Keep only a hash of the session token in the durable store. All writes require the exact trusted Origin and a session-bound CSRF token. A local test configuration must never become a production authentication bypass.
- Keep staff identity, current access and trained-human permissions server-owned. Removing an environment allowlist entry takes effect when the serving deployment receives that configuration; do not promise that editing a Vercel value immediately revokes every session. Production acceptance must prove active-session revocation and denial through retained preview/old deployment URLs. Staff access on the consumer host is denied.

The dedicated store is implemented in the app-owned `atlas_staff` PostgreSQL schema with its own generated client and migration ledger. A shared-repository namespace notice was sent to the active Vault software owner; no public/Vault/financial/card model or migration was changed. The serving role is restricted to exact table/column grants, two fixed-search-path locking functions and one scalar pending-operator read; its effective privileges are checked on each transaction. Machine requests, credentials and opaque continuation are not serving-role data. The original in-memory preview remains a separate fixture, not distributed session authority.

Proposed server-only configuration names are `ATLAS_ADMIN_PHONES`, `ATLAS_STAFF_ORIGIN`, `ATLAS_AUTH_TWILIO_ACCOUNT_SID`, `ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID`, purpose-scoped `ATLAS_AUTH_TWILIO_*` credentials and `ATLAS_AUTH_*` session configuration. These are names, not provisioned values. Production, Preview and local configurations must remain distinct; unapproved previews receive no live SMS or data authority.

## Acceptance before live staff access

Prove allowed and denied login, canonical-number matching, expired/wrong/reused codes, different service/SID/phone responses, concurrent checks, resend limits, lost responses, cookie/CSRF/origin checks, logout and active-session revocation. Verify cross-host, cross-card, cross-role and machine-versus-human denial. Test the exact production host and retained deployment URLs before enabling staff data adapters.

Local development and the separate grading workspace can proceed using synthetic identities. Provider creation, real messages, live roster configuration and auth/domain cutover belong to a concrete operational release; they have not occurred here.

## Local durable acceptance and pending activation

At the durable staff milestone, 41 unit checks, 22 restricted-role PostgreSQL scenarios and 12 actual Next HTTP/SSR checks passed. The latter restarts the web process and verifies the same session, exact saved draft and idempotent retry. All 93 existing public migrations and the separate staff migration applied with source checksums intact; both second deploys were no-ops. Evidence: `/private/tmp/atlas-staff-db-FbxMyy/result.json` and `/private/tmp/atlas-staff-db-fQm2tJ/web-result.json`. Test database files were discarded only after shutdown; results/logs/ledgers remain. This does not establish live Verify or hosted acceptance.

Activation must provision a restricted app serving role and separate operator/migration authority, the purpose-specific API key/Verify service, canonical approved numbers and independent 32-byte session/phone keys. The service's actual verification-token lifetime must match the configured ten-minute lifetime. Activate `StaffControl` only after reviewing the exact `PRODUCTION` origin, Vercel deployment ID, full release SHA and computed config hash. Every change advances its revision; old sessions and retained deployments lose authority. The HTTP boundary requires the exact `app.atlasgrading.com` Host and platform forwarding host/protocol; prove these against the actual deployed request before activation. The current conservative shared-ingress rate bucket intentionally does not trust arbitrary client forwarding headers.

No route grants training or assignments. Operator-side roster/training/assignment commands and the real preserved-evidence adapter must be integrated before real grading access. A valid phone login creates only an untrained reviewer; publication and trusted learning require their separate exact current human permissions.
