# Vault V1 Stripe payment implementation status — 2026-09-28

## October 2, 2026 direction

Nayax Spark is now the immediate target. Keep the Stripe test integration as a separate machine-selected route; this document records Stripe implementation and test evidence, not an exclusive provider decision. See [Spark integration](NAYAX_SPARK_INTEGRATION_2026-10-02.md).

## Owner decision

Mark selected Stripe Terminal and the Verifone UX700 for future Vault machines. The active Vault payment interface is provider neutral. The Marshall bridge and unavailable adapter were removed; the active machine no longer sends a post-door vend result or selects a Nayax adapter. The deterministic payment simulator models capture before door fulfillment. This decision supersedes the earlier provider plan in historical handoffs.

## Implemented in this checkout

- `PaymentAdapter` provides capabilities, start, cancel, reconcile, and request-key reconciliation. `reportVendResult` is gone.
- `STRIPE_TEST` accepts only Stripe test keys and a configured reader/location, uses server-driven PaymentIntents with automatic capture and idempotency keys, checks amount/currency/reader/location/machine/sale bindings, and holds uncertain results for reconciliation. `MOCK` remains a deterministic local simulator.
- A `SETTLED` result can commit one selected-door group only after the adapter independently confirms capture. The commit and door intents are atomic in local SQLite. Missing or conflicting proof leaves doors locked.
- Both test payment modes reject composition with the physical Waveshare controller. Live payments and live door dispatch remain disabled. No hardware or real-money acceptance is claimed.
- Cloud certification uses provider-neutral payment identity names and requires Stripe Terminal test-mode capture evidence for physical approval. Prisma maps those fields to legacy column names so existing rows can be read without a destructive migration.

## Legacy compatibility retained

The existing SQLite `vend_result_*` columns and old `VEND_RESULT_PENDING`/`SETTLEMENT_PENDING` state values remain in the historical schema and state decoders. New sales do not write a vend result. Pending legacy payments still require reconciliation. Earlier Prisma migrations and archived handoff documents retain their original identifiers as immutable history. The Prisma schema uses `@map` for old cloud column/enum names; a reviewed database migration could rename physical columns later.

## Verification and remaining gates

The Vault machine suite passed 166/166 tests after this change. Two Vault cloud regression files passed 25/25 tests. The Prisma schema validated. Full cloud TypeScript compilation and kiosk Vitest were unavailable in this worktree because the needed package-local tools/client were not installed; regenerate Prisma Client and run those checks in the next provisioned build. These tests use simulated payments, mocked Stripe API responses, and no terminal. Before physical release, provision the Stripe test Location and UX700/simulated reader, run actual Stripe test API calls with test credentials, validate webhooks and durable evidence ingress, test the received UX700 and cabinet/network installation, implement and approve the live credential/reader architecture, and run physical safety/certification. No deploy, restart, migration, payment or door actuation occurred in this software change.

## Continued software work, 2026-09-28

- Hardened test-mode PaymentIntent identity, amount-received proof, offline/busy preflight, decline retirement, cancellation/capture races, and uncertain transport handling. A proven no-effect first preflight restores the machine and cloud sale to `RESERVED`/`NOT_REQUESTED`; an ambiguous create remains held for supervised recovery.
- Added signed, bounded test-mode Stripe webhook ingress at `POST /api/vault/v1/stripe/webhook`. After independent Stripe PaymentIntent and reader retrieval, it stores an immutable `VaultStripeObservation` in a new additive Prisma model. The migration is source-only and has **not** been applied. The enrolled-machine `GET /api/vault/v1/stripe/observations?machineId=...&saleId=...` returns scoped diagnostic hints; webhook data has no door authority. The local machine already polls Stripe directly and independently confirms capture.
- The cloud webhook requires `VAULT_STRIPE_WEBHOOK_ENABLED=true`, `VAULT_STRIPE_TEST_WEBHOOK_SECRET`, `VAULT_STRIPE_TEST_SECRET_KEY`, and `VAULT_STRIPE_TEST_BINDINGS_JSON` with unique machine/reader/location triples. These are not configured in a Stripe account or deployed runtime in this session.
- Added a read-only-default sandbox acceptance helper and [account/readiness runbook](STRIPE_READINESS_RUNBOOK.md). The existing Ten Kings account may be reused for the same business with separate Vault credentials and endpoints; account eligibility, keys, simulated reader, webhook registration, and actual API calls have **not** been verified.
- Current checks: machine TypeScript build and 177/177 tests passed; cloud regression files 26/26; focused Stripe webhook tests 16/16; sandbox helper guards 2/2; Prisma schema validation and bundled route import resolution passed. Full cloud TypeScript compilation, generated Prisma Client, disposable Postgres migration application, kiosk checks, actual Stripe sandbox, UX700, receipts/refunds, and live/physical release remain open.

## Ten Kings Stripe test account setup, 2026-09-28

- The owner signed into the existing Ten Kings Stripe account and saved a test Terminal Location for the temporary software test site: `tml_GrfdkgIYV0Y3Qv` (`Ten Kings Vault - software test`). A simulated WisePOS E reader, `tmr_Grfd3goSmo63gj`, was registered to it and showed Online in the Dashboard. This is a protocol test reader; its Location must not be assumed to qualify as unattended/off-premise for a real UX700.
- With the owner's action-time approval, a restricted **test-mode** API key named `Ten Kings Vault Terminal - test` was created. Before creation, the Dashboard showed exactly Payment Intents Write, Terminal Readers Write, and Terminal Locations Read selected. The token was not placed in source, this document, or chat; it has not yet been securely injected into a test process. No live Vault key or webhook endpoint was created, and the existing online integration was not changed.
- The simulated reader and restricted key established account-side prerequisites. Webhook delivery, cloud deployment/migration, UX700 physical tests, live setup, and vending acceptance are still unverified.

## Actual Stripe sandbox acceptance, 2026-09-28

- Mark ran `scripts/vault-stripe-tenkings-acceptance.zsh` locally with the restricted Ten Kings test key. Its Stripe API preflight confirmed reader `tmr_Grfd3goSmo63gj` at Location `tml_GrfdkgIYV0Y3Qv` is `simulated_wisepos_e`; the Location reported `unattended=false`.
- The current Vault adapter created and reconciled three USD 1.00 **test-mode** PaymentIntents through the simulated reader. Success `pi_3UKqdPGgJKBYlzk21G59XTan` returned `SETTLED`; decline `pi_3UKqdSGgJKBYlzk20roGIGzt` returned `DECLINED`; cancel `pi_3UKqdWGgJKBYlzk21ObZ7q3Q` returned `CANCELLED`. Each helper result reported `passed=true`; the owner's terminal returned to its normal prompt without a script error. The token was hidden during entry and was not shared in chat or written to the repository.
- This is account-backed payment-protocol evidence for the test adapter and restricted key. The helper did not load the machine database or controller, exercise webhooks/cloud deployment, test a real UX700, prove unattended Location acceptance, or charge real money. Those gates remain open.
- The touchscreen source calls the local `/api/v1/checkout` and `/api/v1/sales/:id/payment` routes, which in a configured machine can reach the `STRIPE_TEST` adapter. This has not been exercised as a real touchscreen-to-Stripe Test mode checkout. The current appliance has no recorded Stripe test credential/reader binding or released kiosk build in this handoff, and the standalone helper deliberately bypassed kiosk, local SQLite, cloud reachability, and door simulation. Do not claim a customer-facing Stripe test checkout has passed until a disposable or installed bench run proves the complete path.

## Omarchy touchscreen milestone prepared, not yet run

- Added a disposable `--stripe-test --stocked` mode to the existing Vault simulator and a hidden-key `vault-stripe-tenkings-touchscreen-bench.sh` launcher. The local kiosk, HTTP service, SQLite sale, real Stripe Test mode adapter, and simulated reader participate; fake cloud responses and the deterministic door controller keep physical outputs disconnected. The bench presents a test card only for the exact reader action bound to a locally persisted PaymentIntent and prints safe sale/command evidence on shutdown.
- Mac Node 20 syntax checks, eight candidate-bundle tests, and an unchanged 72-door mock HTTP purchase smoke passed. The actual Stripe touchscreen run awaits the SER being powered on, a fresh Linux build, key entry at the hidden prompt, and owner observation of the physical touchscreen. The verified transfer candidate is `2026-09-28-stripe-touchscreen-r3`, manifest SHA-256 `8fce3d913ab465d2ed9c9a8fba7c94a1a5bbbbc670f9748cf216a6b857dd35de`.
- This is an unsigned, uncommitted development candidate and must not be presented as a signed installed release or live vending software. The separate [touchscreen bench runbook](STRIPE_TOUCHSCREEN_BENCH_2026-09-28.md) lists the exact acceptance boundary.
