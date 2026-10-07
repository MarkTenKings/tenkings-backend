# Spark operations and acceptance

October 7, 2026. Scope: fixed-price USD Remote Start / PRE_SELECTION for Ten Kings Vault. Stripe remains independently selectable per machine. This runbook supplements the [operations runbook](OPERATIONS_RUNBOOK.md), [API contracts](API_CONTRACTS.md), and [manual review](NAYAX_SPARK_V3_REVIEW_2026-10-07.md). The source now supports separately qualified SANDBOX/OFFICIAL_TEST and PRODUCTION/LIVE bindings; no installed live mode is enabled by this implementation. Synthetic results do not certify Nayax, a real terminal, installed Linux, or a physical cabinet.

## Offline provisioning

Build contracts and machine first (`pnpm --filter @tenkings/vault-contracts build`, then `pnpm --filter @tenkings/vault-machine build`). Use a private, non-secret JSON input with `schemaVersion:1`, `machineId`, `stage:"SANDBOX"`, HTTPS `callbackOrigin`, lowercase `callbackHeaderName`, and `profile`. The profile fields and vendor confirmations are specified by `SparkProvisioningInput` in `packages/vault-machine/src/spark-provisioning.ts`; the appliance example is `deploy/vault-linux/templates/nayax-spark.test.example.json`. Confirmation fields must reflect Nayax's actual response, not assumptions. The automated test fixture contains synthetic identities and is never a provisioning source.

```sh
node packages/vault-machine/scripts/spark-provisioning.cjs validate /private/input.json
node packages/vault-machine/scripts/spark-provisioning.cjs generate /private/input.json /private/new-output
node packages/vault-machine/scripts/spark-provisioning.cjs compare /private/input.json /private/new-output/cloud-bindings.json
node packages/vault-machine/scripts/spark-provisioning.cjs check-secrets /private/input.json
```

`generate` creates four private files in a new directory: local profile, matching cloud bindings, disabled cloud environment, and the plan with exact digests/callback URLs. It rejects existing destinations and does not install credentials or modify a running machine. Preserve generated binding/method digests with the onboarding record. `check-secrets` reads only presence/shape from the process environment and reports booleans; `ready:false` returns a failing exit status. Use the appliance's protected credential mechanism for installation, never the kiosk, source control, chat, or a support bundle. Sandbox names: `VAULT_SPARK_TOKEN_SECRET`, `VAULT_SPARK_SIGN_KEY`, `VAULT_NAYAX_SPARK_CALLBACK_SECRET`. Production uses only `VAULT_SPARK_PRODUCTION_TOKEN_SECRET`, `VAULT_SPARK_PRODUCTION_SIGN_KEY`, and `VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET`; its callback secret must differ from the sandbox secret.

Register these exact case-sensitive paths at the confirmed HTTPS cloud origin:

- `/api/vault/v1/spark/TransactionCallback`
- `/api/vault/v1/spark/DeclineCallback`
- `/api/vault/v1/spark/TimeoutCallback`

Production generation uses `stage:"PRODUCTION"`, `environment:"PRODUCTION"`, `sandboxConfirmed:false`, `productionConfirmed:true`, and a fresh non-secret UUID `credentialGeneration`. Its callback paths insert `/production/` before the callback name. The generated environment uses `VAULT_NAYAX_SPARK_PRODUCTION_` for `CALLBACKS_ENABLED`, `ENVIRONMENT`, `CALLBACK_HEADER`, `CALLBACK_SECRET`, and `BINDINGS_JSON`. Production has no fallback to sandbox values. Generated bindings carry `stage:"PRODUCTION"` and the full `paymentBindingDigest`; the cloud parser and local adapter require exact agreement. The selected callback route owns the stage; request bodies, headers and query parameters cannot change it.

The additive cloud stage migration defaults all historical observations to SANDBOX without changing their IDs or payload hashes. Production receipts use the distinct `spark-production:` domain, while sandbox receipts retain `spark-sandbox:` and their original normalized bytes. Authenticated production receipt and observation reads require both `stage=PRODUCTION` and the original `paymentBindingDigest`; each journal sees only its own stage and binding. Old binding receipts remain stored and queryable under the authenticated machine. Preserve the original callback route/configuration for historical sandbox callbacks. Any production credential rotation requires a fresh signed credentialGeneration and a separate journal after all prior effects are reconciled; changing a secret alone is not a promotion.

Callbacks remain disabled in generated output. Nayax must confirm the signing profile, body/version convention, terminal representation, authenticated header, acquiring methods, limits, and replay rules before explicit sandbox enablement. The receiver and local profile must match exactly. Unsupported or ambiguous acquiring evidence cannot release doors.

## Financial incidents and recovery

A successful TriggerTransaction response only acknowledges the request. The terminal's authenticated, durably stored, exactly matched successful acquiring callback establishes payment. Missing, delayed, or contradictory evidence must not cause another charge or an unpaid door command.

1. Preserve the support reference and machine identity. Keep the kiosk's pending/review state; do not reset journals or re-submit an unknown operation.
2. In Admin Vault, inspect **sales**, **support cases**, and **financial recovery**. Compare the immutable snapshot generation and evidence digest, unresolved/orphan notices and approved actions. The financial recovery summary shows the latest callback receipt time/age, receipt count/cursor and oldest pending or unreviewed UNKNOWN approval age. Empty or future timestamps have null ages; an idle receipt age does not establish a missing callback or payment outcome. Use the support diagnostics for cloud age and last transport age/status. Export the evidence before review.
3. For an eligible financial discrepancy, obtain independent evidence and record its reference, SHA-256 and reason. A fresh human Admin session may approve only the exact displayed snapshot. The machine rechecks authority and state before application. Changed evidence supersedes the old decision and requires a new review.
4. External human review of UNKNOWN stops that operation's replay permanently. Its original ID and UNKNOWN monetary outcome remain; it never becomes a provider-confirmed void or reduces confirmed net settlement merely because an operator reviewed it.
5. During synchronization, the machine attempts to retire an expired, never-started void approval only after the main database and provider journal prove no intent/transport and persist a tombstone. A replacement requires fresh Admin approval and receives a new approval ID only after cloud acknowledgment of that proof. If proof of absence is missing, conflicting, or uncertain, do not replace it.
6. Review can release only its own eligible financial hold. Technical holds for journal loss, restore, clock faults, unfinished sales/commands or controller uncertainty remain and must follow the relevant recovery procedure. Financial review neither changes stock nor sends a door command.

Full-sale void is a separate fresh Admin approval over the exact captured sale/provider/amount. Durable original intent precedes any bounded same-request attempt; replay is permitted only under the explicitly confirmed vendor policy. UNKNOWN and provider errors do not establish a successful refund; a permitted original-request retry may later obtain verified provider confirmation. External human review alone never confirms a refund. Technical/restore flags, unsafe clocks and changed financial authority block new and uncertain void attempts. The Spark adapter rechecks these gates inside its serialized queue immediately before recording a transport attempt and sending HTTP, so a hold acquired while queued still prevents transport. Stock and door fulfillment history remain intact. Partial refunds and variable-price preauthorization are outside the selected product flow.

Support exports include hashed `spark-operations.json`: binding digest, cloud age, outbox/notice totals, receipt cursor, transport/void counts and recovery alerts. It is diagnostic metadata, not proof of funds. Raw provider sessions, request bodies, card data and credentials are excluded. A missing provider journal with historical Spark sales is a recovery fault, not an empty history.

## Coordinated snapshots and schema upgrades

Use a coordinated appliance snapshot containing the main database and every required payment/controller journal and anchor. Keep the manifest SHA-256 in a separate reviewed record. The verifier checks fixed membership, hashes, database integrity/foreign keys, machine/schema/migration ledger, event watermark, and exact main-history/provider binding parity.

```sh
python3 deploy/vault-linux/appliance.py verify-snapshot --snapshot /private/snapshot --manifest-sha256 REVIEWED_SHA256
python3 deploy/vault-linux/appliance.py stage-restore --snapshot /private/snapshot --manifest-sha256 REVIEWED_SHA256 --machine-id EXACT_MACHINE_UUID --destination /private/new-held-state
# After reviewing the dry-run result, --apply creates the new held staging directory only.
python3 deploy/vault-linux/appliance.py stage-restore --snapshot /private/snapshot --manifest-sha256 REVIEWED_SHA256 --machine-id EXACT_MACHINE_UUID --destination /private/new-held-state --apply
```

For a forward schema change, replace `stage-restore` with `stage-upgrade` and add `--release /private/verified-release --public-key /private/trusted-release-public.pem`. The signed release must contain the offline migration runner and a strictly newer supported schema. That runner executes the release's actual SQL against staged state without starting payment, controller or service code. Downgrades are refused.

Staging is create-only and preserves the source and installed state. It always retains service lock, automation halt and technical recovery, with no remembered cloud freshness. Failure preserves an in-progress marker; startup refuses any database beside that marker. Preserve failed output for diagnosis and use a different new destination when retrying from the original verified snapshot. Do not delete the marker to bypass verification. A successful completion receipt records source and staged hashes but does not authorize installed-state replacement or reopening. Those operations require explicit maintenance planning, installed-machine verification and recovery review. Encryption/protected backup storage and actual installed restore acceptance belong to the appliance qualification.

## Repeatable synthetic acceptance

Use Node 20 for the development/CI path and an explicit disposable local Docker context. The wrapper requires its acknowledgment flag, creates a fresh PostgreSQL database, applies all migrations, verifies legacy receipt preservation and a second-deploy no-op, and removes its own database container on completion. Child processes receive an allowlisted environment that excludes inherited application credentials. The validation setup rejects application environment files and nonloopback database targets.

```sh
pnpm vault:build
pnpm vault:build-next
pnpm --filter @tenkings/vault-kiosk exec playwright install chromium
node scripts/run-vault-spark-validation.mjs --ack-disposable-local-postgres
python3 -m unittest discover -s deploy/vault-linux/tests
```

Record the planned disposable migration in the session log first. CI adds the browser/real-PostgreSQL job and runs offline appliance tests after compiled machine SQL is available. Evidence is written to `outputs/vault-spark-integration/evidence.json` and PNGs. It includes authenticated wire requests, browser checkout/Admin void, duplicate/conflicting callbacks, cloud outage, restart/late callback, unavailable callback, lost auth, unsupported method/wrong amount, transaction lock ordering, concurrent approvals, expired retirement/replacement and UNKNOWN external review. Existing 9/72/125/256-door PostgreSQL projection scenarios also run. Do not infer physical-door or provider acceptance from these simulated fixtures.

## Linux packaging and release boundary

`candidate-bundle.py export --source CHECKOUT --output NEW_DIRECTORY` copies only allowlisted source and binds every file to an unsigned candidate manifest. `build-candidate.py` verifies those bytes, builds/tests on Linux x64 using the pinned Node 22.23.2 archive and pnpm 9.12.0, compiles native SQLite, assembles dependencies and probes the final artifact. `rehearse-linux.sh` is restricted to a disposable Docker Linux x64 container with `VAULT_DISPOSABLE_REHEARSAL=1`; it installs build tools inside that container. It is not an appliance command. Candidate Node test files run sequentially; kiosk tests use one isolated process with a 512 MiB JavaScript heap for bounded memory/emulation stability. Explicit concurrency assertions still run. Record whether Linux x64 was emulated and do not treat it as SER performance qualification.

The current rehearsal uses QEMU 10.2.3 on an ARM host. The locked esbuild 0.21.5 x64 build tool crashed in its Go runtime under emulation; an exact-version Linux ARM64 esbuild binary, verified against the lockfile archive integrity, successfully built the kiosk diagnostic. The complete candidate rerun uses that binary only through the container's build-time `ESBUILD_BINARY_PATH`. Application runtime and tests remain pinned Linux x64 Node 22.23.2 with better-sqlite3 11.10.0; the ARM64 build tool is not an installed runtime dependency. The complete candidate build passed 245 machine, 12 contract, 106 kiosk and 44 appliance tests, then passed final assembly and the artifact's native SQLite probe (Node 22.23.2/ABI 127, SQLite 3.49.2, WAL, rollback, reopen and integrity). Artifacts, source manifest, exact environment, final log and hashes are retained in `outputs/vault-spark-linux/`. Retain this emulation/build-tool caveat with the result; it does not establish physical-appliance acceptance.

The unsigned artifact retains `UNCOMMITTED_CANDIDATE` provenance and `releaseAuthorized:false`, including after interrupted builds. The ordinary signing tool refuses it. After source review and an actual clean commit, the normal `build-release.py` and signing workflow create the deployable release. Do not relabel a candidate or manufacture a clean-commit claim. A container rehearsal checks Linux code and native ABI; the SER's firmware, filesystem, power behavior, Chromium, permissions, service lifecycle and cabinet still require installed acceptance.

## Production preparation and evidence packet

`verify-promotion INPUT APPROVAL PUBLIC_KEY EVIDENCE_DIRECTORY` verifies an Ed25519 authority bound to the exact machine, new configuration digest, prior/target binding, real source commit and a maximum 24-hour approval window. Each of the following exact files must contain the reviewed evidence whose SHA-256 is signed:

| Evidence file | Required observation | Current external status |
|---|---|---|
| `NAYAX_CERTIFICATION.evidence` | Assigned engineer's checklist, reviewed results and Nayax acceptance | Pending Nayax |
| `TERMINAL_SANDBOX.evidence` | Actual configured terminal, success/decline/timeout, late/duplicate evidence, restart and full-void financial reconciliation | Pending access/terminal |
| `CABINET_ACCEPTANCE.evidence` | Exact cabinet/profile, occupied door selection, no unpaid/wrong/repeated actuation, controller recovery and restock | Pending physical test |
| `LINUX_RELEASE.evidence` | Reviewed clean signed release plus exact SER install/update/restore and power/network recovery evidence | Pending signed release and installed test |
| `PRODUCTION_ACCOUNT.evidence` | Confirmed production device/account/credential mapping, callback activation and vendor go-live permission | Pending Nayax |

The promotion verifier still returns a reviewed plan with `activationAllowed:false`; it does not enable the stage-aware LIVE runtime. Production runtime additionally requires independently trusted signed activation for the exact payment, controller, machine configuration and installed release. Its synchronous authority hook is rechecked inside the provider queue and immediately before every authentication, trigger/replay and full-sale void/replay. Revoked, expired or changed authority blocks new effects; confirmed durable outcomes remain readable. Preserve old bindings, callback routing and journals while reconciling old operations. Credential/device rotation must preserve historical identity; it cannot reuse a journal under a new binding. Provision a separate target journal with a new production credential generation and exact target profile, then qualify and deliberately activate a reviewed production release after external acceptance. Local schema 7 pins production sale/controller command identity and requires a reviewed forward staged upgrade. Never treat changed secrets or a signed planning document as sufficient activation.

For each real test record: date, operator/reviewer, machine/device/firmware, app/source/manifest/config/binding/schema identity, case and expected result, actual result, provider reference, artifact SHA-256 and any unresolved discrepancy. Keep secrets and card data out of this packet. Failed and inconclusive cases remain visible. Synthetic evidence may accompany the packet but cannot fill an external acceptance row.
