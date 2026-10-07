# Vault Stripe account, sandbox, and arrival readiness

Verified against source, official Stripe documentation, and the Ten Kings Stripe test Dashboard on 2026-09-28. This runbook is a procedure and acceptance checklist, not a claim that deployment, hardware commissioning, or real payments have occurred. See [implementation status](STRIPE_PAYMENT_IMPLEMENTATION_STATUS_2026-09-28.md) for recorded test evidence.

## Existing Ten Kings account

Use the existing Ten Kings Stripe account for Vault if it is the same legal business and its country/business eligibility covers this unattended deployment. A separate Vault API key supports independent permissions, rotation, and request-log attribution; it does not create a separate account, balance, settlement stream, or object-level security boundary. The account was verified in Ten Kings' test Dashboard; account onboarding, accepted Terminal terms, payout readiness, UX700 ordering eligibility, and the actual merchant/business details have not been inspected.

On 2026-09-28, after the owner signed in, Ten Kings Test mode initially showed no Terminal Locations or readers. A dedicated test Location, simulated reader, and restricted test API key were then created as recorded below. Live mode showed no Locations or readers during inspection. Existing online paths read `STRIPE_SECRET_KEY` in `backend/pack-service/src/index.ts` and `frontend/nextjs-app/pages/api/live-rip/purchase.ts`; both pin Stripe API `2024-06-20`. Do not replace their credential or change the account default API version as part of Vault setup. Give Vault its own secret names, webhook endpoint/signing secret, and explicit reader/location/machine mapping. Different keys alone do not keep one integration from accessing another integration's payments when resource permissions overlap; the Vault code must enforce its metadata and amount bindings.

Stripe recommends restricted API keys with only required resource permissions, backend secret storage, and applicable access policies. Keep keys out of chat, source, URLs, logs, and browser bundles. [API keys](https://docs.stripe.com/keys), [restricted keys](https://docs.stripe.com/keys/restricted-api-keys).

## Credential permission worksheet

The Ten Kings Dashboard now has a restricted **test** key named `Ten Kings Vault Terminal - test`. Its only selected Dashboard permissions were Payment Intents **Write**, Terminal Readers **Write**, and Terminal Locations **Read**, verified before creation. The token is not recorded in source or this runbook. The 2026-09-28 account-backed helper run confirmed these permissions work for its reader/Location reads and success, decline, and cancel test payment operations. No live Vault key was created.

| Credential | Required operations | Exclude unless independently needed |
| --- | --- | --- |
| Vault payment service | PaymentIntent create/retrieve/cancel; Terminal reader retrieve/process/cancel action; Terminal Location retrieve | Payouts, transfers, customer management, subscriptions, account changes |
| Sandbox acceptance runner | Above plus test-helper `present_payment_method` | Live keys, physical readers, deployment privileges |
| Provisioning operator | Terminal Location and reader creation/registration | Do not leave provisioning privileges on the appliance unnecessarily |
| Refund operator/service | Retrieve exact bound payment/charge and create/retrieve refund | Do not give refund rights to the public kiosk |
| Webhook verifier | Endpoint-specific `whsec_` signing secret; API read rights only if its implementation retrieves objects | Existing online webhook secrets |

Confirm each operation with the restricted sandbox key. If Stripe requires an additional permission/dependency, record the exact denied endpoint and add only that capability. Do not broaden to full access to work around an unexplained failure. Same-account permissions are resource scoped, not a guarantee that they are limited to one Vault machine.

## Stripe Location and simulated reader

For the real remotely managed vending deployment, create a dedicated Terminal Location with the actual installation address, `attended_type=UNATTENDED`, and `unattended[premise_type]=OFF_PREMISE`. Stripe currently supports unattended UX700 deployments generally in the US. The attended/unattended state cannot be changed in place, so verify it before registration. Keep an existing attended location intact. [Unattended readers](https://docs.stripe.com/terminal/unattended-readers).

Use a dedicated sandbox reader for software work. Stripe's API documents `registration_code=simulated-wpe` for a simulated WisePOS E. This tests the server payment protocol; it is not UX700 hardware or unattended certification. If Stripe rejects that simulated device on an unattended Location, use a separate sandbox attended Location for protocol testing and keep unattended Location/UX700 qualification explicitly pending. Do not invent a UX700 simulator registration code. [Reader API](https://docs.stripe.com/api/terminal/readers/create), [Terminal testing](https://docs.stripe.com/terminal/references/testing).

Provisioning is a separate account mutation; the helper below never creates/deletes Locations or readers. Record the account/sandbox identity, `tml_` Location, `tmr_` reader, and a dedicated test machine UUID in the secure configuration inventory. Sandbox and live objects are distinct.

**Current Ten Kings Test mode setup (2026-09-28):** The owner saved `Ten Kings Vault - software test` at the temporary software test site in El Dorado Hills, California: Location `tml_GrfdkgIYV0Y3Qv`. `Vault software test - simulated WisePOS E` was registered to it and showed Online in the Dashboard: reader `tmr_Grfd3goSmo63gj`. Do not copy the owner's residential street address into the repository. The later Stripe API preflight reported `unattended=false`, so this is a simulated-reader protocol test Location. A real UX700 installation needs a separately verified `UNATTENDED` / `OFF_PREMISE` Location at its actual site, then physical reader registration and acceptance.

## Executable sandbox acceptance

Prerequisites: build current `vault-contracts` and `vault-machine` using the repo's supported Node 20 or 22 runtime. Securely inject these environment variables; do not paste literal credentials into shell commands or chat:

- `VAULT_STRIPE_TEST_SECRET_KEY`: `rk_test_...` preferred, or scoped test setup credential.
- `VAULT_STRIPE_TEST_READER_ID`: dedicated simulated `tmr_...` reader.
- `VAULT_STRIPE_TEST_LOCATION_ID`: matching sandbox `tml_...` Location.
- `VAULT_STRIPE_TEST_MACHINE_ID`: dedicated lowercase UUID for this acceptance run.

The appliance test adapter and helper use the same key, reader, and Location variable names; the helper additionally requires `VAULT_STRIPE_TEST_MACHINE_ID`, while the appliance uses `VAULT_MACHINE_ID`.

From repository root:

```sh
node scripts/vault-stripe-sandbox.mjs
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=success
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=decline
node scripts/vault-stripe-sandbox.mjs --run-test-payment --scenario=cancel
```

For the current Ten Kings test Location and simulated reader, `zsh scripts/vault-stripe-tenkings-acceptance.zsh` prompts for the restricted test token with echo disabled, then runs those four commands in order. Run it in a trusted interactive terminal; paste the key only at its hidden prompt. The script fixes the verified test reader and Location IDs, generates an ephemeral test machine UUID, and never saves or prints the token. It is a convenience for the current sandbox inventory, not a deploy or live credential configuration.

The first command performs only GETs and prints safe reader/location checks. Each explicit payment command creates one USD 1.00 **test** PaymentIntent through the current Vault adapter. The helper rejects live credentials, physical readers, mismatched Locations, and a currently busy reader. It simulates presentment for success/decline and invokes cancellation for cancel. It neither loads a machine database nor creates door commands. Output contains only test references, expected/observed states, and safe failure codes.

Expected results: `SETTLED`, `DECLINED`, and `CANCELLED`, respectively. Save output with source commit and timestamp. On a timeout or unknown response, use the printed sale/machine/PaymentIntent IDs for reconciliation; do not treat rerunning the script as recovery of the earlier payment. Every new run has a fresh sale identity. Keep the reader exclusively assigned to this test while running. The helper does not refund or delete test objects, and successful output does not prove webhooks, machine persistence, or physical fulfillment.

Local guard regression: `node --test scripts/vault-stripe-sandbox.test.mjs`. These tests call only injected functions, never Stripe. The owner ran the interactive acceptance script against the real Ten Kings Stripe **Test mode** API on 2026-09-28. The reader/Location preflight passed with `readerType=simulated_wisepos_e` and `unattended=false`; three USD 1.00 **test** PaymentIntents produced the expected `SETTLED`, `DECLINED`, and `CANCELLED` adapter results, each with `passed=true` and normal shell completion. Test PaymentIntent IDs: success `pi_3UKqdPGgJKBYlzk21G59XTan`, decline `pi_3UKqdSGgJKBYlzk20roGIGzt`, cancel `pi_3UKqdWGgJKBYlzk21ObZ7q3Q`. This confirms the restricted key permissions needed by the helper and adapter for these scenarios; it does not verify webhooks, machine persistence, physical door control, unattended UX700 behavior, refunds, receipts, or live charging. The key was entered at a hidden prompt and is not recorded here.

## Webhooks and machine delivery acceptance

Register a dedicated sandbox HTTPS endpoint implemented by the current Vault cloud build, with only its supported events. Verify its exact route, event allowlist, API version, signing-secret variable, and mode settings in source before account setup. Do not reuse the online machine endpoint by assumption. Stripe's CLI can forward sandbox events locally, but its generated signing secret differs from a Dashboard endpoint secret. [Webhook setup](https://docs.stripe.com/webhooks).

Acceptance must prove:

1. Exact raw-body signature validation rejects altered bodies, stale timestamps, and wrong secrets before durable processing.
2. Non-Vault online PaymentIntents, other machines/readers/Locations, wrong amounts/currencies, and wrong mode cannot authorize a Vault sale.
3. Duplicate and out-of-order events preserve one durable outcome. Persist an accepted event before acknowledging it; retries after cloud/database/process failures eventually deliver it.
4. Machine authentication limits diagnostic observation queries to the requested machine and sale. This endpoint returns hints only and has no acknowledgement or paid-effect authority.
5. The local machine polls Stripe directly to reconcile an exact PaymentIntent and must independently verify capture before any door commitment. The webhook observation is a durable cloud record; reader action success by itself never proves captured payment or authorizes a door.
6. A late captured payment while the customer has left produces a held support outcome according to the current machine recovery contract; it cannot silently vend to the next customer.

## Machine enrollment and release acceptance

Bind the machine's enrolled identity, signed configuration, physical profile, Stripe reader, Stripe Location, account environment, and secret delivery to one inventory record. Verify a replacement reader cannot take another machine's identity. Validate secret rotation and revocation with pending payments preserved. Payment credentials belong on the trusted service boundary, never kiosk JavaScript.

Before release, run the current contracts/machine/cloud/kiosk checks in a fully provisioned checkout, including generated Prisma client and a disposable PostgreSQL migration validation where schema changes require it. Use the signed appliance release/install process and record the source identity, configuration digest, enrollment, and startup evidence. A sandbox helper pass cannot approve live payments or override controller certification.

## Receipt and refund operations

Offer the customer a physical or email receipt. Stripe prebuilt email receipts include the required card-network fields; set `receipt_email` at payment creation or update the exact PaymentIntent after checkout. Test-mode receipts are not automatically emailed. A QR/support reference alone is not evidence that the required physical/email choice is implemented. Verify email entry, consent to receipt use, delivery/retry behavior, and that the next customer cannot see the previous customer's address. [Terminal receipts](https://docs.stripe.com/terminal/features/receipts).

For captured payment with failed/uncertain fulfillment, first inspect immutable sale, payment, and door evidence. Keep unresolved doors unavailable. An authorized support operator refunds only the exact payment and the undelivered amount; a retry uses the same refund operation identity. Persist the refund ID and confirm its final state before describing it as complete. Refunds must not restock a physically uncertain door or create another dispense. Exercise partial fulfillment, duplicate requests, pending/failed refund, and recovery after response loss. Cancel a still-uncaptured payment rather than claiming it was refunded. Use the current Stripe Dashboard as the manual fallback until application refund operations have passed acceptance. [Terminal refunds](https://docs.stripe.com/terminal/features/refunds?terminal-sdk-platform=server-driven), [refund lifecycle](https://docs.stripe.com/refunds).

## Arrival-day physical acceptance

1. Confirm the delivered device is the Stripe-compatible UX700, correctly mounted, powered, grounded, and networked according to its installation instructions; register it to the intended account and unattended off-premise Location. Record serial, reader ID, Location, and firmware. [UX700 setup](https://docs.stripe.com/terminal/payments/setup-reader/ux700), [reader registration](https://docs.stripe.com/terminal/payments/connect-reader?terminal-sdk-platform=server-driven&reader-type=internet).
2. Test with a physical Stripe test card and the qualified test configuration: success, decline, cancel, amount display, receipt option, door selection, door-open/closed sensors, and exactly one committed group. Prove no door pulse before capture verification.
3. Exercise reader unplug, SER reboot, network outage before and after capture, delayed webhooks, repeated customer taps, helper restart during physical output, and power return with unfinished sales. Verify recovery does not duplicate charge or dispense. Server-driven Terminal has no offline payment collection; loss of connectivity must keep new sales unavailable until the integration is ready. [Server-driven payment flow](https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven).
4. Verify the real cabinet's controller/electrical certification and installed service startup/recovery. Confirm successful software tests did not substitute for real output qualification.
5. Only after live enablement and merchant acceptance are recorded, perform the explicitly authorized small live purchase, supported contactless/mobile-wallet check, receipt, and refund. Real wallet behavior is not established by sandbox tests. Archive safe transaction IDs and final outcomes; never archive secret keys or card data.

The intended delivery-day workload can become short, guided commissioning. Plugging in an unregistered reader cannot complete account binding, network setup, or physical acceptance automatically.
