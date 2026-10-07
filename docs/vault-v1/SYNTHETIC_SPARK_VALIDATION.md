# Synthetic Spark integration validation

This harness exercises the actual Vault kiosk, local HTTP service, SQLite authority and provider journal, Spark wire client, production Next callback/Admin/machine routes, and a disposable PostgreSQL database. A local synthetic Spark peer independently validates the authentication cipher, signatures, terminal binding, amount and full-void identity. Simulated controller receipts do not establish physical retrieval or qualify a cabinet.

Prerequisites: Node 20, the repository's installed workspace dependencies, a local Docker daemon, and Playwright Chromium. Use a checkout without Next environment files. The harness refuses external databases and does not inherit provider credentials or production configuration. It needs no Nayax account or payment terminal.

```sh
pnpm vault:build
pnpm vault:build-next
pnpm --filter @tenkings/vault-kiosk exec playwright install chromium
node scripts/run-vault-spark-validation.mjs --ack-disposable-local-postgres
```

On macOS, existing Google Chrome is used. On CI, install Chromium with `--with-deps`. An explicitly selected local Docker socket can be supplied with `DOCKER_HOST`; the harness uses a temporary empty Docker configuration for the public PostgreSQL image and leaves the user's Docker configuration unchanged.

The runner creates one uniquely named PostgreSQL 15 Alpine container. Its database uses bounded tmpfs storage and a randomly assigned port published only on `127.0.0.1`. The complete migration chain is applied in two stages around the legacy Spark inbox, with a seeded receipt proving that original payment facts survive the upgrade and receive ambiguous method defaults. A second deployment must be a no-op. All container removal targets are created by this invocation, and normal completion or test failure removes that exact container.

The existing PostgreSQL profile suite exercises legacy, 72-, 125- and 256-door contracts. The Spark/browser suite covers successful capture and a full paid void, pending refresh, one group retry and Done, minimal decline, duplicate and conflicting callbacks, wrong binding/amount/payment method, missing receipts, outage and restart, uncertain transport, technical recovery holds that prevent any new void intent or provider transport, human review of an UNKNOWN void without confirming money, expired unstarted approval retirement and replacement, immutable PostgreSQL authority, and concurrent receipt/approval delivery. Explicit PostgreSQL advisory-lock contention proves receipt sequence allocation follows the per-machine commit boundary.

The browser denies all nonlocal network requests. Its API responses are served by the real application. The Spark peer receives actual request bytes over HTTP; the injected transport maps only the reserved synthetic origin to that loopback server. Production endpoint validation remains unchanged.

Compact evidence is saved under `outputs/vault-spark-integration`: migration count/digest and legacy/no-op results, a list of passed checks, and five screenshots. CI runs the same command in the `vault-synthetic-spark-postgres-browser` job and retains these artifacts for 14 days. Passing proves the synthetic software path; real Nayax sandbox qualification, credentials, terminal binding and actual cabinet/controller qualification remain separate work.
