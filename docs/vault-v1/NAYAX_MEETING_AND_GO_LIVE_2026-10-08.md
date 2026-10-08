# Nayax meeting and Vault go-live worksheet

Prepared October 7 for the owner's October 8 meeting. Product: fixed-price USD, Remote Start / PRE_SELECTION, one payment for the selected occupied Vault doors. Spark is the selected provider for this machine. Stripe remains an independent machine configuration. The source implements separate sandbox and production paths; this worksheet does not certify external acceptance or authorize a payment.

## Short request to Nayax

1. Spark sandbox **and production** access: assigned API hosts, integrator/sign-key ID, token ID, and credentials delivered securely.
2. Our terminals enabled for **Spark Remote Start / PRE_SELECTION in USD**, with exact terminal ID/type, machine ID, hardware serial, site ID and firmware/configuration.
3. Register/test our three authenticated callbacks; confirm the signing format, callback terminal identity, acquiring-card fields, limits, cancellation and retry rules.
4. Assigned engineer's test checklist, certification/sign-off requirements and explicit production go-live approval.

Keep secrets out of chat, Git, screenshots and the acceptance reports. The protected local/cloud credential configuration stores them separately.

## Confirm with the engineer

| Item | Record the confirmed answer |
|---|---|
| Sandbox and production API base URLs | Pending |
| Integrator/sign-key ID and token ID | Pending; secrets stored separately |
| Device terminalId, terminalIdType, nayaxMachineId, hwSerial and siteId in each environment | Pending; preserve decimal IDs as strings where required |
| Remote Start/PRE_SELECTION, USD and maximum total | Pending |
| Signing profile, body hashing and wire API version/header convention | Pending; current software supports only explicit `wireApiVersion:null` (unversioned `/api` requests). If Nayax requires a version selector, record exact name/placement/signing rules; that transport needs implementation and verification before use. |
| Callback terminal representation and authenticated header convention | Pending |
| Approved acquiring card brands/method fields and CardUid semantics | Pending; loyalty/prepaid/ambiguous evidence cannot release doors |
| Callback retries, timeout, duplicate and late-callback behavior | Pending |
| Trigger retry and full-sale cancellation retry/idempotency behavior | Pending; retry is disabled until confirmed |
| Full-sale cancellation eligibility, time window and financial reconciliation | Pending |
| Test credentials/cards, terminal firmware and network requirements | Pending |
| Certification evidence and production permission | Pending |

Generate the exact callback origin/paths from the non-secret provisioning input after confirming the deployed cloud origin. Sandbox paths are `/api/vault/v1/spark/TransactionCallback`, `/DeclineCallback` and `/TimeoutCallback` under the same Spark prefix. Production paths add `/production/` after `/spark/`. Each stage has its own callback secret and enabled flag. Provisioning produces an exact cloud/local binding comparison; do not activate a guessed host or example terminal identity.

## Tonight: computer and cabinet

The last recorded SSH address is `tkvault@192.168.2.36`; it was unreachable while powered off. Once connected, inspect the current installation, free space, clock, USB identities, controller mapping and display without replacing the prior preview or data. Use a new build/test directory and the pinned Linux x64 runtime. Preserve existing service listeners and packages.

| Acceptance step | Required evidence | Status |
|---|---|---|
| Clean reviewed source and signed release | Commit, manifest hash, public-key fingerprint, build/tests and packaged native SQLite probe | Built and signed from `faedb613`; full Linux suites and 34 isolated authority checks pass; installed test remains separate |
| Installed computer | Service account/permissions, display, kiosk startup, restart and update | Pending computer connection |
| Recovery | Coordinated multi-journal backup, held restore, reboot/power/network recovery | Pending installed test |
| Cabinet | Actual door/channel mapping, one controlled pulse, OFF/recovery, restock and correct occupied-door behavior | Pending supervised cabinet test |
| Terminal | Correct device registration, network and firmware; engineer-confirmed Spark mode | Pending Nayax |

The standalone controller bench and installed appliance tests can establish their own evidence before the combined payment pilot. A sandbox terminal test never implies permission to enable public live checkout. Preserve all existing and rotated provider/controller journals.

## With Nayax: run the acceptance cases

Record expected and actual outcomes, exact device/configuration/release identities, timestamps, provider references, reviewer and a hash of each saved report. A successful HTTP trigger acknowledgment alone is not payment proof.

- Approved payment: one exact acquiring callback settles one sale; only its paid occupied doors receive the permitted commands.
- Decline, timeout and customer abandonment: no unpaid door commands and no invented successful payment.
- Late/duplicate/out-of-order callbacks, dropped response and restart: retain the original transaction and durable evidence; no extra charge or unauthorized repeated opening.
- Wrong device, amount, currency, unsupported method and invalid callback authentication: reject/quarantine; no door release.
- Full-sale void: fresh Admin approval, one original cancellation identity, confirmed provider outcome; ambiguous outcomes remain reviewable and do not become successful refunds.
- Cloud/terminal/controller outage, recovery and actual controlled power cycle: preserve paid/unknown history and technical holds until reconciled.
- Supervised production pilot after accepted qualification: compare Vault, Nayax transaction/report totals and actual cabinet result; keep public checkout held if any discrepancy remains.

Use Nayax's required cases in addition to these application cases. A certification waiver, changed acceptance requirement or approved pilot arrangement must be recorded as the actual vendor decision, not inferred by software.

## Production activation and handoff

Keep five actual reports: Nayax certification, terminal sandbox, cabinet acceptance, installed Linux release and production account permission. The activation tooling requires each reviewed `KIND.evidence` record and the corresponding nonempty `KIND.artifact` report bytes, bound to the exact machine, release, payment/controller configuration and their hashes. See [Spark operations](SPARK_OPERATIONS_AND_ACCEPTANCE.md) for filenames and commands. Do not copy the synthetic test fixtures into an acceptance packet.

Issue a fresh signed promotion and a separate signed activation only after reviewing those reports. Promotion issuance is limited to a 24-hour window; the runtime activation lease lasts at most 30 days. Record its expiry and responsible operator, and renew deliberately before expiry. No automation has been scheduled. Expired/revoked or changed authority blocks new financial/door effects while preserving reconciliation and required relay OFF cleanup.

Release signing and activation signing use separate offline keys. Only public keys go onto the appliance. Public DER SHA-256 fingerprints created October 7:

- Release: `762f2a08c84cff3b2e9c3d5291dda4df60b360d4b9523ddb2b4e4b7dfdec8f30`
- Activation: `06af3b48d8ea8a2924d7298e9bcb700b02f8659a52e5a131f95da7f21394588d`

Final go-live depends on observed installed/terminal/cabinet results and Nayax's permission. A software test pass or a calendar deadline cannot fill a pending acceptance row.
