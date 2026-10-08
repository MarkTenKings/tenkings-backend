# Vault V1 Nayax Spark integration — October 2, 2026

**Superseded by October 7 implementation:** The owner supplied the correct 150-page Spark API v3.0.0 manual, approved the build, and requested a second complete lead review. The [current review, implemented scope and provisioning requirements](NAYAX_SPARK_V3_REVIEW_2026-10-07.md) govern the integration. This file is a historical record of the October 2 prototype; its no-retry/no-void behavior and single signing profile are no longer the complete source implementation.

## Provider direction and scope

Nayax Spark is the immediate payment integration target. Keep Stripe Terminal as a separate per-machine route. A machine selects exactly one provider; a sale retains its payment adapter and device binding throughout recovery. A provider change must not send an existing sale to a different provider or replace an uncertain payment. This is an extension of the existing Vault software, independent of Speedster and Card Platform V2.

Implementation is in `/Users/markthomas/.codex/worktrees/df09/ten-kings-mystery-packs-clean`, branch `codex/vault-integration-20260917-9ddb13`. Existing Stripe, kiosk, controller and appliance changes in that working tree are preserved. The original chat checkout is stale, dirty and contains an unrelated unresolved session-log conflict; it is not the Vault implementation directory.

The supplied `Solution proposal and SOW for Spark - Ten Kings LLC.pdf` is 11 pages, revision 1.1 dated March 20, 2026. All three flow diagrams were reviewed. Its Developer Zone link supplies the technical reference; there was no 150-page API manual in the provided file. Reviewing the commercial offer, signature page or marketing opt-out does not accept an agreement or authorize a payment.

## Selected transaction flow

Use **Remote Start / PRE_SELECTION**: the customer selects the exact occupied doors, Vault calculates and persists the final USD subtotal/tax/total, then wakes the configured terminal for that amount. Nayax performs a SALE (authorization and settlement); its approved TransactionCallback is the payment evidence. Only after exact adapter reconciliation does Vault atomically commit the original paid door group and queue its controller commands.

`StartAuthentication` approval and `TriggerTransaction` approval prove authentication/terminal activation only. Neither is a successful customer payment. This implementation does not select Device Start, Pre-Authorization, Marshall or a post-vend Settlement call. Spark's separate `/Settlement` belongs to its Pre-Authorization flow.

The terminal must be configured by Nayax for Remote Start and PreSelection Enabled, with the correct currency, terminal identifiers, timeouts and MQTT/VPN/network settings. Remote Start and Device Start cannot coexist on the same Nayax machine. This restriction does not require deleting Stripe from other Vault machines.

## Authentication and durable boundaries

- The assigned HTTPS API base is explicit; no production or QA URL is guessed. Requests use the current `IntegratorId` and `TransactionSignature` headers.
- Signature: SHA-256 over UTF-8 `SparkTransactionId + ";" + SignKey`. This is the documented concatenated hash, not a bearer token or assumed HMAC.
- StartAuthentication uses the original GUID, 17 random ASCII alphanumerics and UTC `yyMMddHHmm`. Encrypt the 64-character `GUID=random+timestamp` plaintext with AES-256-ECB/PKCS7 using the final 32 token-secret characters, then Base64 encode. Verify `HashedSparkTransactionId` against SHA-256 of the original GUID.
- Persist the original request digest, amount, GUID and exact device/provider binding before the first outbound request. Do not automatically replay an ambiguous mutation or mint a replacement GUID.
- Cloud receives bounded callbacks using a separately provisioned static secret header. Nayax must enable that header; the public docs do not document a dynamic callback signature. The outgoing TransactionSignature must not be reused as assumed inbound authentication.
- Store only allowlisted normalized payment facts and their receipt digest. Card hashes, UIDs, last-four digits, authentication ciphers, signing keys and secret headers are not needed for fulfillment.
- The enrolled machine polls its own exact session through authenticated HTTPS. Its local adapter checks the immutable binding and amount before yielding SETTLED. The cloud callback route cannot open a door or write a Vault sale outcome.
- Callback currency can be absent in the documented schema. In that case currency comes from the explicitly configured USD machine binding; a contradictory supplied currency is rejected. Confirm the actual terminal currency with Nayax before vendor testing.
- No public transaction inquiry endpoint, durable idempotency guarantee or safe pre-card remote cancellation semantics were found. Missing/conflicting callbacks and ambiguous transport remain UNKNOWN and retain inventory. Elapsed time alone does not prove cancellation or release funds. No automatic refund/store credit is introduced.

## Cloud outage behavior

New checkout continues to require fresh Ten Kings cloud reachability. Once approved Spark payment evidence is durably recorded locally, fulfillment and the one original-door retry continue locally through a cloud outage. Before the approved callback has reached local storage, payment resolution depends on the cloud receiver/polling route; an outage must hold the reservation until evidence becomes available. Do not claim Spark supports offline payments or that a terminal wake response substitutes for the missing callback.

## Configuration and next vendor work

Per-machine adapter choices are `MOCK`, `STRIPE_TEST` and `NAYAX_SPARK_TEST`. All current test choices require the simulated controller; live and physical payment fulfillment are not enabled by this change.

For Spark, use a protected absolute `VAULT_SPARK_CONFIG_PATH`, `VAULT_SPARK_TOKEN_SECRET` and `VAULT_SPARK_SIGN_KEY`. The config supplies the Nayax-assigned API base, terminal ID/type, Nayax machine ID, hardware serial, site ID, integrator ID and token ID. Sandbox and PRE_SELECTION confirmation are required. The existing `VAULT_CLOUD_ORIGIN` and enrolled `VAULT_MACHINE_CREDENTIAL` carry machine polling; do not put credentials in the kiosk or source control.

Next acceptance requires:

1. Nayax-assigned sandbox API domain, Token ID/secret and SignKey ID/key; a configured Spark test terminal and confirmed USD Remote Start PRE_SELECTION settings.
2. Nayax provisioning of the custom callback secret header, receiver URLs and required network/IP rules.
3. Confirmation of documented auth ambiguities below, timeout/decline/cancel/retry behavior and terminal payment-versus-callback timing.
4. Reviewed application of the additive cloud observation migration, callback deployment and machine enrollment/configuration.
5. Sandbox success/decline/timeout/restart/duplicate/conflict/end-to-end kiosk acceptance before real hardware or money.
6. Nayax certification and separately approved production credentials, installed hardware/controller/cabinet qualification and release.

Credentials, vendor provisioning, migration application, deployment, actual Spark sandbox testing and certification are not completed merely by fixture tests.

## Documentation conflicts to confirm with Nayax

The current authentication guide/tool includes SparkTransactionId in StartAuthentication while the OpenAPI request schema omits it. The current header is TransactionSignature; older sample code uses Signature over serialized body. A StartAuthentication response description suggests using a hashed ID later, while subsequent endpoint examples use the original GUID. Error-code meanings differ between the auth-specific and global tables. Implement the current guide/tool without silently trying multiple protocols; confirm the original GUID/header/cipher behavior in the assigned sandbox.

## Technical sources reviewed

- [Spark overview](https://devzone.nayax.com/docs/integrate-pos-device/spark/spark)
- [Remote Start payment flows](https://devzone.nayax.com/docs/integrate-pos-device/spark/payment-flows/spark-remote-start)
- [Remote Start machine configuration](https://devzone.nayax.com/docs/integrate-pos-device/spark/machine-configuration/spark-remote-start-configuration)
- [Current authentication](https://devzone.nayax.com/docs/integrate-pos-device/spark/security-authentication/spark-authentication)
- [Current authentication tool](https://devzone.nayax.com/docs/integrate-pos-device/spark/security-authentication/spark-auth-tool)
- [Webhook setup and custom headers](https://devzone.nayax.com/docs/integrate-pos-device/spark/webhook-callbacks/index)
- [TransactionCallback](https://devzone.nayax.com/docs/integrate-pos-device/spark/webhook-callbacks/transactioncallback)
- [Integration and certification process](https://devzone.nayax.com/docs/integrate-pos-device/spark/spark-integration-process)
- [Official OpenAPI](https://devzone.nayax.com/openapi/spark.yaml)

## Validation

Implementation and fixture validation are in progress. Final observed results will be appended here before handoff.
