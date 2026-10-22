# Private staff comp curation — inactive transport composition

Date: October22,2026 UTC. Local R1 plumbing only. Default-off adapters, no registered routes/dispatcher, native listener, environment, credentials, clients, grants, UI activation or production effect.

## Contract and authority

Three new modules complete a testable transport path without enabling it:

- `frontend/atlas-app/lib/staff-comp-curation-transport-contract.mjs` (b32e9faf): exact public curation read/decision grammar and explicit private alias. Optional browser reads are limited to the existing session and exact saved-market status GET. No search, selection/acquisition, arbitrary URL or other method is admitted.
- `frontend/atlas-app/lib/server/staff-comp-curation-proxy-composition.mjs` (4d2f9cdf): exports `createStaffCompCurationProxyComposition` and `createStaffCompCurationPrivateAdapter`. Both return null unless explicitly enabled. No fallback endpoint is created.
- `frontend/atlas-app/lib/staff-comp-curation-response-transport.mjs` (df4478b5): exports `createStaffCompCurationResponseTransport({enabled,staff,fetchImpl,events?})`, returning null when off or `{request,close,assertScope}` when explicitly composed. The request function is the future `CardHistory.compCurationRequest` prop; no current page supplies it.

The frontend proxy requires existing server-owned auth, a synchronous throwing/void ingress guard, public/private origins, a distinct private signing key, the three existing staff key references and explicit fetch capability. It pins capabilities/key material, validates route/method/body/current actor/CSRF, and uses the existing manual private signer. Its outbound alias is exactly `/api/staff/manual-connected/cards/<UUID>/comp-curation` with the exact read query, or `/comp-curation/decision` for POST. This is an **unregistered adapter contract**, not permission to bypass a currently unsupported route. Existing route registration and dispatcher/allowlist files remain unchanged. Direct public curation paths are not accepted by the native alias adapter.

The native adapter requires the caller to supply bounded raw request bytes and reviewed native composition capabilities. It verifies the original method, alias path, query, raw body and bound headers using the existing HMAC/atomic nonce verifier **before** parsing or mapping. It does not mutate the signed original request. Original identity/bytes/headers must remain unchanged across an awaited nonce admission; a private synchronous WeakMap witness admits only the mapped request. Cookie/CSRF/current ACL/approval checks remain in the existing native service; HMAC supplies transport admission, not staff identity. The caller still owns its clients and native raw-body reader/listener.

The existing proxy can emit POST heartbeats. The new wrapper captures all heartbeat/result bytes privately and exposes no successful private response before final frontend authentication and actor/capability checks. It validates the returned curation projection and publishes only bounded JSON with private/no-store headers. No upstream cookie or streaming protocol is forwarded. A failure after a committed receipt is still an unknown outcome, never evidence of rollback.

The browser transport requires an explicit fetch function and captures the exact staff object/ID/role/mode. Requests use `/admin` same-origin credentials, no-store, redirect refusal and no referrer. It obtains the actual current session/CSRF, verifies the exact actor before/after the target response and refuses a changed CSRF/session context. The existing local session HTTP can use top-level `SYNTHETIC_LOCAL` while its actor mode is `SYNTHETIC`; the actor projection is the access binding, not that informational top-level label. Reads and body streams are bounded to2MiB/25seconds. Account/capability changes, invalid in-place actors, pagehide, close and abort clear/cancel in-flight work; late responses are discarded even for noncompliant injected transports. There is no persistence or automatic POST retry.

## Qualification

New tests:

- `frontend/atlas-app/test/staff-comp-curation-proxy-composition.test.mjs` (388a79b3).
- `frontend/atlas-app/test/staff-comp-curation-response-transport.test.mjs` (56daf00c).

Final Node22.16.0 suite: **47pass,0fail,0skip under OS network denial** —17new groups plus30retained native/HTTP/client/controller groups. Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/proxy-qualification-01/qualification.json`, its exact saved sources and `focused-tests.log`.

The combined test invokes the new browser Response transport, actual site-router guard, existing private HMAC signer/verifier/nonce store, new native alias adapter, existing native composition and curation service over synthetic auth/boundary/artifacts, existing HTTP/client/controller. It performs no socket/network or database operation. Separate native-PG qualification remains the earlier audit; this test does not establish the future restricted role or deployed private proxy.

Meaningful checks include:

- Exact nonce replay refusal; valid-but-different query UUID, cookie/signature and raw-byte tampering refused before service.
- Noncanonical JSON whitespace/key order signed as the original bytes; a spoofed pre-parsed body is ignored; adding valid whitespace after signing invalidates HMAC.
- Observed asynchronous nonce wait followed by original-request mutation refuses before native access.
- A committed private decision stays buffered through observed final frontend authentication; account/capability drift returns only an error.
- Actual manual proxy heartbeat remains private; final browser output is ordinary JSON.
- Lost private reply leaves the existing controller unresolved; no automatic retry; explicit same-ID retry returns the exact original receipt with one insert.
- Existing session HTTP wire, current account/CSRF fences, exact saved-read scope,401/403 teardown, overflow/malformed refusal and a genuinely entered stalled transport/body cancelled without a later enqueue.
- Default-off factories consult no capability. Same-origin/proxy key separation, signed ingress and CSRF are mandatory. Published records and saved market evidence are unchanged by the service fixture.

An initial test run had one fixture-only counter error: an optional hook accidentally contained the auth counter increment. The counter and finally-release were corrected. Independent draft review found an invalid in-place actor could throw before closing; the final transport closes/aborts that state and a stalled-body regression proves it. Neither correction weakens an authority or response check.

## Remaining work

The host still needs an independently qualified dedicated native DB role/checker, explicit bounded raw-body/dispatcher wiring, reviewed private proxy registration and actual CardHistory transport composition. Nothing in this increment performs those actions. All existing grading/review/presentation/provider code and configuration remain unchanged.

The native composition remains hard `policy:null`: read, Skip and No suitable comps only; selected guidance stays unavailable. Rights/recency/method adoption and missing grade designation remain separate decisions/contracts. Immutable report comps, private curation and human asking price remain distinct. No production/browser/real-card acceptance or complete R1/all30 status is claimed.

Final independent detail-lane source/receipt review **PASS**: qualification64b57cb53b791fe7bf77ae9c0b5539b2327b1485c8756c14a5f9559def430bdc, all24 refs and23 retained source copies exact, actual47-pass log inspected. The raw-byte HMAC and invalid-actor teardown findings are closed. No remaining concrete blocker for the bounded inactive source; no tests, DB, network or effects repeated for review. The original envelope preserves its earlier review-pending checkpoint; this audit and append-only log record the later PASS. Root owns integration and commit.
