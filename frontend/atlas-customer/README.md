# ATLAS customer accounts

This private Next.js application owns `/account` on `atlasgrading.com`. The public website owns `/` and public reports; the independent staff application owns `/admin`. Next's `basePath` scopes customer routes and assets. Customer cookies, CSRF tokens, configuration, verification service, session storage and database authority are separate from staff access.

## Customer flow

The same phone → SMS code form handles signup and returning login. No profile or account is created before successful verification. The database transaction creates the first account for a canonical international phone number or opens another session for its existing account. Names, addresses, email and passwords are not required for sign-in.

Creating a submission requires the customer's name, return address, explicit address confirmation, one to 25 card descriptions and either `DEALER_DROP_OFF` or `MAIL_IN`. The profile is saved for later review and editing. Each submission retains its own immutable confirmed profile and intake-method snapshot. Intake locations, postage, prices and turnaround promises are not fabricated when they have not been configured.

Submission requests use a customer-bound UUID. An exact request with an uncertain response is retained in the current tab's `sessionStorage` and checked by its request ID before another attempt. Recovery stores the submitted profile and card descriptions; it stores no SMS code, cookie or credential. A confirmed response or logout clears it. Page changes reload the requested private view; browser history restoration revalidates the session before displaying private state.

Each card has separate recorded progress: submitted, received, grading, final review, approved, encapsulated and shipped. A sibling card does not inherit progress. Receipt requires an explicit staff confirmation. Approval must match the current report and specimen heads; encapsulation also requires the latest exact label, NFC verification, assembly and sonic-weld chain. Correction or replacement work can move the current stage back. Shipment is a distinct explicit physical-dispatch record with carrier and tracking information. The customer receives no private review notes, draft report content, staff identity or specimen identifiers.

## Database authority

The additive migration is part of the existing staff migration chain:

`../atlas-app/prisma/migrations/20260909020000_customer_accounts/migration.sql`

It creates `atlas_customer` explicitly and fully qualifies cross-schema references. It does not create credentials, enable customer access or seed accounts. Apply the complete existing migration chain with its authorized migration identity; this app's generated Prisma client is not a separate migration authority.

Provision a dedicated customer login with `CONNECT` and only these application grants:

```sql
GRANT USAGE ON SCHEMA atlas_customer TO atlas_customer_runtime;
GRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb)
  TO atlas_customer_runtime;
```

`customerGrantSQL()` in `lib/server/database.mjs` emits the schema/function grants for a validated role name. The role must have no memberships, elevated attributes, database/schema creation, application table or sequence access, or other application function privileges. The runtime checks effective privileges inside every operation. Account ownership is resolved inside the SQL function from the customer session and browser binding; caller account IDs are never authority.

The independently restricted staff operations role uses `atlas_staff.customer_operations(text,text,text,jsonb,jsonb)`. That gateway separately verifies a fresh approved human staff session and an exact current operations grant. Its bounded commands are `list`, `bind`, `action` and `ship`. Customer credentials cannot call it. The staff adapter and DTO contract live in the staff app's `lib/server/access/customer-intake.mjs` and `lib/customer-intake-contract.mjs`.

## Production configuration

Production remains unavailable unless all runtime and database controls agree. The app expects:

| Variable | Value |
| --- | --- |
| `NODE_ENV`, `VERCEL_ENV` | `production` |
| `ATLAS_CUSTOMER_RUNTIME` | `postgres` |
| `ATLAS_CUSTOMER_ORIGIN` | `https://atlasgrading.com` |
| `VERCEL_URL` | Exact deployment hostname ending in `.vercel.app` |
| `VERCEL_GIT_COMMIT_SHA` | Exact 40-character lowercase release commit |
| `ATLAS_CUSTOMER_DATABASE_URL` | Dedicated restricted PostgreSQL login, `schema=atlas_customer`, `sslmode=require` |
| `ATLAS_CUSTOMER_SESSION_KEY` | Dedicated canonical base64 32-byte secret |
| `ATLAS_CUSTOMER_PHONE_KEY` | Separate canonical base64 32-byte secret |
| `ATLAS_CUSTOMER_ROUTER_KEY` | Separate canonical base64 32-byte secret also held by the public path gateway |
| `ATLAS_CUSTOMER_TWILIO_ACCOUNT_SID` | Approved Twilio account SID |
| `ATLAS_CUSTOMER_TWILIO_VERIFY_SERVICE_SID` | Dedicated customer Verify service SID |
| `ATLAS_CUSTOMER_TWILIO_API_KEY_SID` | Approved Twilio API key SID |
| `ATLAS_CUSTOMER_TWILIO_API_KEY_SECRET` | Matching API key secret |

Do not configure `ATLAS_LOCAL_*` variables in production. The `CustomerControl` row must be explicitly enabled and match `makeConfig(...).binding`: mode, origin, deployment, release commit and configuration hash. Every control update must advance `revision` by exactly one. Sessions are bound to that revision and the account's access version, so revocation and control changes invalidate prior access.

Both page requests (including Next data requests) and API requests require a valid signed customer gateway proof. Setting `Host` or forwarded-host headers cannot authorize direct deployment access. The proof binds the zone, deployment, method, external `/account` request target and recent timestamp. POST endpoints additionally require exact origin, same-origin fetch metadata when present, JSON and the customer-purpose CSRF token.

All private responses are non-cacheable. Secure HTTP-only production cookies use `Path=/account` and `SameSite=Lax`. Provider calls use durable claim/finish transactions, bounded expiry, rates and replay windows. SMS requests are sent once per claim, with no automatic network retry. Unknown provider outcomes are quarantined instead of silently resent. Logs and API errors do not expose codes, phone numbers or provider responses.

## Local verification

From the repository root:

```sh
pnpm --filter @atlas/customer-app test
pnpm --filter @atlas/customer-app build
```

The build generates only `.generated/customer-database`, then checks route ownership and browser chunks for server-only boundaries. It needs no live database or SMS credentials.

`scripts/postgres-scenarios.mjs` exports `customerScenarios(scenario, check)` for the shared disposable PostgreSQL harness. It uses the dedicated restricted customer database URL and covers durable verification, canonical account uniqueness, own-account reads, immutable submissions, request recovery, revocation, privilege denial and explicit staff intake actions. `scripts/tracking-regression.mjs`, when present, adds current-approval and replacement-finishing regressions against real database records.

The repository's `scripts/atlas-website/local-pilot.mjs` owns the complete local website fixture and route proxy. It serves the logical origin `http://127.0.0.1:4318`, with this app listening on `127.0.0.1:4320`. The customer fixture accepts only a private, owned harness configuration file under `/private/tmp/atlas-staff-db-*/`; it cannot be enabled in production. Its code `424242` is synthetic and never sends SMS. Fixture credentials and mutable databases are not checked into the repository.

Database and HTTP fixture success are evidence for local behavior. They do not establish production configuration, a live SMS delivery, a physical intake, an encapsulation, a shipment or an authorized production launch.
