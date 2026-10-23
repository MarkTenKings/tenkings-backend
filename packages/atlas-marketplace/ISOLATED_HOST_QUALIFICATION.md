# Finite isolated host qualification

This local runner qualifies the marketplace route composition without enabling shared routes, ownership claims or provider operations. It is not a target-host installer or production readiness assertion. The marketplace store is a real owned PostgreSQL cluster; canonical authentication methods and route signatures operate against explicitly synthetic authority rows. No real customer or staff session is copied.

`scripts/isolated-host-runner.mjs` exports `startIsolatedHostRunner({enabled, fixture, limits})`. It accepts only the branded fixture from `scripts/isolated-host-fixture.mjs`, opens three distinct ephemeral `127.0.0.1` listeners, and exposes their addresses, an asynchronous snapshot, `close()` and a `closed` receipt promise. It never calls the complete bootstrap's `start()` or finance's scheduler start. Finance is constructed only to retain fixture-signed raw webhook deliveries. Its provider, tax and alert transports refuse and count external calls.

The fixture owns a fresh private PostgreSQL17 cluster with UNIX sockets and TCP disabled, a dedicated database and restricted writer/function-owner roles. Canonical source and guarded SQL proposals remain unchanged. Closing the runner stops its owned cluster and retains durable files. A separately requested fixture restart creates a new capability around that same owned state; closing does not silently restart it.

Limits cover lifetime, admitted requests, simultaneous handlers/connections, headers, URI/query fields, body bytes, request time and shutdown. The runner intentionally refuses chunked bodies and accepts only bounded Content-Length bodies for this QA profile. It does not qualify every production upload transport. Original fallback handlers receive unchanged method/target values. Socket closure, handler draining, composition closure and fixture shutdown have separate observed receipt fields; a deadline failure is not clean-shutdown evidence.

Run the default-off command without arguments to inspect its disabled status:

```sh
node packages/atlas-marketplace/scripts/qualify-isolated-host.mjs
```

The complete local exercise requires explicit paths to an installed PostgreSQL17 `bin` directory, the cached `pg/lib/index.js` module, and a new receipt file in an existing private directory owned by the current user:

```sh
node packages/atlas-marketplace/scripts/qualify-isolated-host.mjs \
  --enable-synthetic-host-qualification \
  --pg-module /absolute/local/node_modules/pg/lib/index.js \
  --postgres-bin /absolute/local/postgresql17/bin \
  --receipt /absolute/private/qualification/receipt.json
```

The command discovers no credentials or production environment configuration, refuses unknown inputs and existing receipt files, and imports the exercise only after admission checks. SIGINT/SIGTERM request orderly cleanup rather than immediate process exit. Keep the exact runtime/dependency/source hashes with the generated receipt. Use a new receipt path for a retry and retain failed receipts.

The exercise uses true canonical HMAC and cookie/session code with synthetic customer/staff authority adapters, checks raw-target tampering and missing/revoked/expired authority, and preserves the exact raw provider-webhook boundary. Durable fixture intake and restart are separate from settlement: no finance worker, tax reporting, payment/transfer/refund/payout create, carrier purchase or external alert send runs. Financial and physical state must remain unchanged from the empty seed apart from the explicitly observed inbox records.

Passing this local exercise does not qualify real canonical gateway SQL, actual proxy/TLS/admission, hosted provider delivery, genuine reviewer/title/Fingerprint authority, retention policy, physical parcel measurements/coverage, OS decoder isolation, backup/key lifecycle or a real marketplace pilot. The master lead owns shared adoption and release windows. Claims/history/pricing guidance remain disabled and ID27 stays open.
