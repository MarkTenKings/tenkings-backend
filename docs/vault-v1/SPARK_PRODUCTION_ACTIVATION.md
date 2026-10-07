# Spark production activation authority

October 7, 2026. The code now has an explicit `NAYAX_SPARK_PRODUCTION` path. It is dormant in this checkout. No real acceptance, production signature, installed activation, terminal transaction, or cabinet actuation is established by the synthetic tests described here. Use the [operations runbook](SPARK_OPERATIONS_AND_ACCEPTANCE.md) for financial recovery and coordinated snapshots.

## Authority and effect boundaries

A production machine requires a signed clean Linux x64 release, an independently trusted signed promotion, and a signed activation lease for the exact machine. The promotion authorizes issuance for at most 24 hours. The activation lease lasts at most 30 days from its signed `activatedAt`; routine operation does not require daily manual approval. Renewal requires fresh promotion and a newly signed activation. The runtime verifies the original promotion at the signed issuance time and verifies the lease against current time at every new effect.

The activation binds:

- Machine UUID and the exact active signed machine configuration digest.
- Production provisioning configuration digest and exact Spark account, device, method/replay policy and credential generation binding.
- Full Waveshare configuration binding, including LIVE mode, serial identity, endpoints, firmware expectations, mapping/profile and qualification reference.
- Exact release manifest SHA-256 and source commit. The manifest's Ed25519 signature, complete payload membership, hashes, sizes and modes must verify. `source-build.json` must attest `CLEAN_COMMITTED`, `buildCompleted:true`, `releaseAuthorized:true`, and the same source commit/Linux x64 native build. Candidate provenance is rejected even if someone signs it.
- Five reviewed external acceptance records and their corresponding report/archive bytes.

There is no environment boolean that grants production authority. The runtime requires its actual packaged Linux x64 executable beneath the release tree and protected root-owned configuration/trust files with protected ancestors. Launch fixes the actual release root and public-key paths; credential settings cannot override them. On startup every release payload byte is hashed. Before each effect the runtime rechecks immutable ownership/mode/inode/device/size/mtime/ctime and tree membership, plus current signed authority/evidence. Any release change invalidates that process's verified baseline until a full restart re-verifies the release.

Checks occur before reservation, new payment intent, original-request replay, paid void, customer retry and door dispatch. Provider and controller queues recheck immediately before transport/pulse. A callback proving payment may still be recorded after authority expiry; it does not bypass the door gate. Read-only financial outcomes remain readable. Once a permitted pulse begins, OFF inspection and completion continue despite lease expiry/revocation. No expiry rule permits another charge or extra customer retry.

The main database's retained wall-clock high-water mark and monotonic clock checks reject clock rollback, including after restart. A cryptographically valid expired lease can boot for read-only reconciliation, but cannot create effects. Missing, untrusted or mismatched installed authority fails startup closed.

## Protected appliance inputs

Use `deploy/vault-linux/templates/machine.spark-production.env.example.json` as an unfilled configuration example. Replace values only from confirmed onboarding and accepted qualification.

| Input | Purpose |
|---|---|
| `VAULT_PAYMENT_ADAPTER=NAYAX_SPARK_PRODUCTION` | Explicit production selection |
| `VAULT_CONTROLLER_ADAPTER=WAVESHARE` | Required physical composition; production plus simulator is refused |
| `VAULT_SPARK_CONFIG_PATH` | Generated exact production local profile |
| `VAULT_SPARK_PROVISIONING_PATH` | Full matching validated provisioning input |
| `VAULT_WAVESHARE_CONFIG_PATH` | Exact reviewed LIVE controller configuration |
| `VAULT_SPARK_ACTIVATION_PATH` | Signed activation envelope |
| `VAULT_SPARK_EVIDENCE_PATH` | Protected external acceptance record/report directory |
| `VAULT_SPARK_PRODUCTION_TOKEN_SECRET`, `VAULT_SPARK_PRODUCTION_SIGN_KEY` | Protected assigned production credentials; distinct from sandbox configuration |
| `/etc/tenkings-vault/spark-activation-public.pem` | Independently installed Ed25519 promotion/activation trust root |
| `/etc/tenkings-vault/release-public.pem` | Independently installed release trust root |

Never install a public key merely because it accompanies an approval envelope. Never copy signing private keys onto the service account. The protected systemd credential remains the source of secrets; report files and source control contain no secrets/card data. Production and sandbox callbacks have separate cloud configuration/routes. Production receipt queries include the exact stored binding digest; they cannot mix generations.

## External evidence format

The required names remain `NAYAX_CERTIFICATION`, `TERMINAL_SANDBOX`, `CABINET_ACCEPTANCE`, `LINUX_RELEASE`, and `PRODUCTION_ACCOUNT`. Each has a `KIND.evidence` JSON record and a nonempty `KIND.artifact` containing its actual report or archive (maximum 32 MiB). The signed promotion hashes every record; each record hashes its artifact bytes. Arbitrary fixture strings, missing reports, `PENDING` results and explicitly synthetic evidence classes are rejected.

Each record follows `SparkAcceptanceEvidence` in `packages/vault-machine/src/spark-activation.ts`: `schemaVersion:1`, exact `kind`, `outcome:"ACCEPTED"`, `evidenceClass:"EXTERNAL_ACCEPTANCE"`, machine/source/machine-configuration/controller/release digests, reviewed date/identity, observation date, and `artifactSha256`. `paymentBindingDigest` must be the original sandbox binding for `TERMINAL_SANDBOX` and the exact target production binding for the other records. The signing reviewer is responsible for truthful observed acceptance; metadata cannot independently prove a physical test happened. Test keys and test fixtures are never an acceptance source.

Create unapproved record templates with:

```sh
node packages/vault-machine/scripts/spark-activation.cjs evidence-templates /private/production-provisioning.json /private/new-pending-evidence
```

This writes `PENDING`/`UNREVIEWED` records with blank acceptance facts, and does not create fabricated artifact reports. Complete them only after reviewing the corresponding actual external results.

## Offline promotion and activation issuance

The offline command never installs files, starts a service, sends a provider request or touches a controller. It verifies the release using the ordinary appliance verifier. Outputs are create-only, private and fsynced. A signing key must be a private regular Ed25519 file. The chosen public key must independently verify the generated signature.

Create a private request JSON containing absolute `provisioningPath`, `controllerConfigPath`, `activationPublicKeyPath`, `releasePath`, `releasePublicKeyPath`, `evidencePath`, plus `schemaVersion:1` and the exact `machineConfigDigest`. For promotion issuance add `previousBindingDigest`, `approvedBy` and explicit `promotionExpiresAt` no more than 24 hours ahead. For activation issuance add `promotionPath`, `approvedBy` and explicit `expiresAt` no more than 30 days ahead. Issuance time is generated by the tool, not supplied as a historical date.

```sh
node packages/vault-machine/scripts/spark-activation.cjs sign-promotion /private/promotion-request.json /private/activation-signing-key.pem /private/new-promotion.json
node packages/vault-machine/scripts/spark-activation.cjs sign /private/activation-request.json /private/activation-signing-key.pem /private/new-activation.json
node packages/vault-machine/scripts/spark-activation.cjs verify /private/activation-request.json /private/new-activation.json
```

Sign only after external acceptance for this exact release/configuration. Review the resulting identity/digests before protected installation. Root-owned installation of the independently trusted public keys, reports and signed envelope is an explicit operational step. A signed output file alone does not deploy or enable the machine.

For immediate revocation, remove the protected active envelope (or replace it with a valid lease that excludes the old authority), keeping its audit copy outside the configured path. Running effects recheck the configured path; no new effect can use a removed envelope. For permanent revocation that must survive attempted restoration of the old envelope, replace the independently trusted activation public key and issue future approvals under its replacement. Restoring the old trust key is itself an explicit privileged trust rollback and must not be part of automatic state restore. Expiry and removed authority preserve outstanding financial/door records; repair by reviewed renewal/recovery, never by editing journal facts.

## Rotation, retained authority and recovery

Production provisioning requires an explicit nonsecret `credentialGeneration` UUID. Every credential rotation must use a new generation and fresh signed qualification. Credential/account/device changes cannot reuse an old provider journal. The current journal is `vault.sqlite.spark-production-<paymentBindingDigest>.sqlite` with its anchor. Controller generations use `vault.sqlite.controller-production-<controllerBindingDigest>.sqlite`. Preserve sandbox and all prior-generation journals/anchors in coordinated snapshots. Outstanding original operations must be reconciled under their original binding before cutover; a new binding cannot silently adopt them. Completed historical financial facts remain intact and do not prevent an otherwise valid new binding.

Local schema 7 adds immutable `sale_controller_binding` and `command_controller_binding` ledgers. A production reservation pins controller identity before any payment. A database trigger copies that exact pin to initial/retry paid commands, including a late captured receipt received after authority expires. Staff commands pin the currently qualified controller in their own creation transaction. Dispatch rejects unbound legacy commands and mismatched controller generations. It never backfills a guessed historical identity. These schema changes require the existing reviewed forward staged-upgrade procedure; older schema releases cannot be an automatic rollback.

Support diagnostics enumerate retained provider generations with their binding/stage and safe counts. They do not export raw sessions, requests, card data or credentials. Reconcile late evidence belonging to an archived generation using its preserved original binding; current production receipt queries intentionally do not transfer those receipts into the new journal. Cloud support review remains necessary for old-generation evidence received after cutover.

## Local verification boundary

The automated tests use generated Ed25519 keys, synthetic reports, injected payment outcomes and fake serial peers. They cover valid bounded issuance, forged/missing trust, report mutation, exact binding mismatches, candidate rejection, expiry/revocation, restart/clock rollback, same-mapping controller rotation, queued effect revocation, output-off completion, paid retry and void gating. Passing these tests establishes software behavior only. Signed clean release assembly and actual installed SER/Nayax/cabinet acceptance remain separately recorded operational evidence.
