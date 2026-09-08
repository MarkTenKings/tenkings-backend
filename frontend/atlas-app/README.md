# ATLAS staff application

Working local foundation for the private staff application. It runs on `http://127.0.0.1:4318` with fictional identities, illustrated sample cards and a synthetic verification transport. No provider client, production credentials, database adapter, grading engine or certification route is installed here.

## Run locally

Use the repository's Node 20 / pnpm 9.12.0 toolchain from the repository root:

```sh
pnpm install --filter @atlas/staff-app --offline --frozen-lockfile --ignore-scripts
pnpm --filter @atlas/staff-app dev
```

The launcher uses a scrubbed child environment, refuses app `.env` files and binds only to IPv4 loopback port 4318. It does not load the Ten Kings environment. Use the sample-number button, then code `424242`. The fictional reviewer is `+12025550141`; `+12025550142` is a read-only fixture identity assigned only Northstar.

The workflow includes phone/code entry, assigned queue search/status filters, protected Front/Back illustrations, image inspection, per-side observations, a review checklist, draft status, explicit save/reload and prior-revision metadata. Saves preserve full previous drafts server-side. Conflicting or failed saves keep the browser's notes. Readiness cannot be saved without both sides and identity review. The third card intentionally lacks Back evidence.

All state is **process-local**. Page reloads retain saved drafts; restarting the server clears identities, challenges, sessions and drafts. This is not a durable store or a production authentication implementation. No actual trained-human approval is issued, including when a draft is marked ready for human review.

## Implemented boundary

- `NODE_ENV=production`, every Vercel mode and a missing explicit local flag deny access even if the fixture flag is copied. `next start` serves the unavailable page and denies the API. Unknown/consumer/preview hosts and non-loopback peers are denied. Client forwarding headers cannot substitute for the exact Host and socket.
- Only a server-defined fictional roster can authenticate. Challenges bind browser nonce, phone, account/service, exact synthetic Verification SID, channel, expiry and attempts. Serialized consumption returns the same active session on an exact retry. Logout, expiry and roster removal revoke it. Unknown provider outcomes remain blocked until expiry.
- Separate opaque **local** cookies are HttpOnly, host-only, SameSite=Lax and Path=/. They intentionally use `atlas_local_*` names on HTTP loopback and cannot become the future Secure `__Host-atlas_staff` session. Every mutation checks exact Origin, JSON and the applicable browser/session CSRF token. Only token hashes are stored; an HMAC recreates the same token for a lost verification response.
- Every card/evidence/draft request rechecks access and server-owned assignment. Only the fixture reviewer can save. Draft CAS binds card, evidence hash/revision and expected draft revision. Unknown body fields, grades, certification and learning actions are rejected.
- The API catch-all dispatches only the eight explicit method/path combinations in `lib/server/http.mjs`. There is no legacy proxy, arbitrary fetch/storage signer, live SMS transport, machine bearer or provider fallback. Responses and evidence are private/no-store. The content policy confines resources to this app.

The in-memory serialization and rate counters are fixture behavior, not distributed guarantees. The synthetic SVG bytes are hashed, but prove no physical-card identity, prepared-image integrity or optical accuracy. This app owns no scoring implementation.

## Verify

```sh
pnpm --filter @atlas/staff-app test
pnpm --filter @atlas/staff-app build
# With port 4318 free, prove the built production server refuses fixture access:
node frontend/atlas-app/scripts/smoke-production.mjs
```

The build check inspects actual Next routes, browser chunks and server dependency traces. Unexpected pages and legacy/auth/wallet/provider dependencies fail the check. It is an artifact/dependency check, not an independent security audit. The earlier `boundary-manifest.json` remains the historical extraction inventory; its proposed future routes are not mounted by this app. Plain image elements retain same-origin cookie authorization and bypass any image-optimizer proxy/cache; their lint exception is deliberate.

Tests cover denied environments/hosts, allowlisting, CSRF, wrong/expired codes, service/SID/phone/channel mismatch, concurrent/lost responses, unknown sends, rate limits, logout/revocation, assignments/roles, fixed private evidence, missing sides, stale drafts and forbidden authority. Live acceptance still requires a durable identity/session/challenge store, separate reviewed Verify adapter and exact host/old-deployment revocation proof under [STAFF_ACCESS.md](../../docs/atlas/STAFF_ACCESS.md).

## Integration and release

The app uses only the existing locked Next/React versions. Vault cleared the additive app importer; retain its independent `frontend/vault-kiosk` Playwright changes when merging histories. The original dirty checkout, Prisma, financial/card/certificate models and existing preparation worker remain separate.

`vercel.json` disables this app's automatic Git deployment. The legacy project's local config also excludes the exact staff branch. These files are local source, not active provider protection or publication approval. Live hosting/auth/DNS/provider configuration, production data, SMS and issuance remain separate operational gates. The public GPT Pages draft remains an unreviewed future input.
