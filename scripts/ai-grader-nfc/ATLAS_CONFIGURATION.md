# Optional ATLAS configuration in the existing Windows helper

This document applies only when using the existing Windows workstation for NFC tag encoding. Mark uses a MacBook for ATLAS browser grading, review and approval; none of this Windows/PowerShell setup is required for those actions. This helper does not implement macOS NFC encoding.

The stable `start-ai-grader-nfc-helper.ps1` launcher reads the same protected
`C:\TenKings\config\ai-grader-nfc\helper.json`. These optional properties add
ATLAS authority without changing its Ten Kings schema or existing settings:

| Property | Contract |
| --- | --- |
| `atlasNfcEnabled` | JSON boolean. Absent or `false` disables ATLAS. A string, number, or null is rejected. |
| `atlasNfcServerJobPublicKeysJson` | String containing the dedicated public trust JSON below. Required when explicitly enabled. |
| `atlasNfcWorkstationToken` | Separate protected token, exactly 43–192 base64url characters. Required when enabled; cannot equal `workstationToken`. |

The public trust string contains precisely:

```json
{
  "schemaVersion": "atlas-nfc-helper-trust-v1",
  "purpose": "atlas-program-approved-report-url-v1",
  "keys": {
    "current": {
      "algorithm": "ecdsa-p256-sha256-p1363",
      "keyId": "<lowercase SHA-256 of public SPKI bytes>",
      "publicSpkiDerBase64": "<canonical public P-256 SPKI base64>"
    },
    "prior": null
  }
}
```

`prior` may be one different entry of the same shape. Current and prior ATLAS
server keys must differ from both configured Ten Kings V2 server keys and the
existing workstation signing identity. No server private key belongs here.
This is the helper's trust envelope, not the hosted service's workstation trust
configuration. The launcher conservatively accepts at most 4096 UTF-8 bytes,
ordinary unescaped JSON strings, and canonical 91-byte named-curve P-256 SPKI
with a valid uncompressed public point. Those encodings are exported by the
ATLAS signing protocol. Program performs its independent cryptographic import
and trust validation again. A configured V3 or V4 F8215 adapter is required.

The only ATLAS process variables exported are
`ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON` and `ATLAS_NFC_WORKSTATION_TOKEN`, with
their exact configured string values. Before launching, any inherited value
must exactly match enabled protected configuration; any inherited value while
disabled is rejected. Missing values are scoped to the child invocation and
removed afterward. Matching inherited values are restored, including when the
child fails. No user- or machine-level environment is written. Disabled config
can retain its ATLAS fields without exporting them. No token or trust content
is printed by this wiring.

The installer and ordinary updater copy `atlas-nfc-configuration.ps1` with the
stable maintenance payload. Neither creates, enables, changes, or rotates the
optional ATLAS fields. Ordinary update keeps its exact config/task/key snapshots
and generic nonempty job-directory guard. Existing Ten Kings token, pairing,
CNG identity, task, and job files remain governed by the existing procedures.

Provisioning these fields is a separate explicit protected-config maintenance
action. There is no new provisioning, restart, activation, or rotation command.
Do not change trust or disable a helper holding an unresolved ATLAS job: the
helper fails closed if protected state cannot be authenticated. Preserve the
existing generic job guards and use the exact status/recovery/quarantine flow.
Never clear job files to make maintenance proceed.

Hardware-free validation commands from the repository root:

```powershell
powershell.exe -NoProfile -File scripts\ai-grader-nfc\tests\test-atlas-nfc-configuration.ps1
```

That suite uses a committed public-only synthetic key and process-scoped fake
tokens, restores its caller environment, and never launches Program or writes
production configuration. It covers disabled defaults, exact export/restoration,
failure cleanup, inherited activation rejection, malformed trust, key/token
aliases, and invalid curve points. On a host without PowerShell, source and
fixture checks can run with:

```text
node --test scripts/ai-grader-nfc/tests/atlas-configuration-source.test.mjs
```

Source checks do not establish PowerShell execution or Windows acceptance.
The existing maintenance/versioned-update suites and Windows-only C# protected
lifecycle/CNG cases remain separate acceptance requirements.
