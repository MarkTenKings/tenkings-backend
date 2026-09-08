# ATLAS approved-report NFC protocol

Local implementation candidate; no operational activation. This package has no database, network, device or provider dependencies. Its Node ECDSA code is server-only. It does not grant report approval or access to a Ten Kings card writer.

Mark's ATLAS grading workstation is a MacBook browser. The Windows device helper documented here is solely the existing NFC integration and is not a grading/review/approval prerequisite. Direct MacBook tag encoding would require a macOS device/signing adapter and hardware acceptance; cross-platform protocol tests do not establish that support.

The current ATLAS public route is `https://atlasgrading.com/reports/ar_<24 base64url characters>?v=<positive approval version>` (`frontend/atlas-app/lib/server/access/reports.mjs`). Every job and result binds `specimenId`, `approvalId`, `approvalVersion` (integer), `publicToken`, and `publicHash` (SHA-256 of the approved public canonical bytes). URL comparison is byte-exact; no alternate host, unversioned URL, extra query, redirect or fragment is accepted.

## Hosted integration

Import `@atlas/finishing/nfc`:

- `signNfcJob({ approvedReport, privateKeyPem, now, lifetimeMs? })` creates a random 32-byte nonce and P-256 signed job. Default lifetime is ten minutes; maximum fifteen. The dedicated server key is supplied explicitly; this function reads no environment.
- `verifyNfcJob({ job, trust, now })` validates the exact schema, purpose, token, URL, lifetime, canonical encodings, allowlist and signature. It throws on invalid input.
- `verifyNfcResult({ job, result, approvedReport, trust, now })` additionally verifies all approval bindings against trusted stored authority, the job-envelope digest/nonce, exact URL readback SHA, F8215/ACR1552U/GoToTags 4.37.0.1, permanent lock, completion window and allowlisted workstation signature. It returns a frozen verified result or throws.
- `atlasReportUrl`, `validateApprovedReportBinding`, `validateNfcTrust`, `canonicalNfcJob`, `canonicalNfcResult`, `nfcJobEnvelopeSha256` expose the same strict protocol rules. Type declarations include the helper response.

The hosted caller must authenticate and authorize the human, read the exact immutable approved version, and recheck its publication/approval and current finishing policy in the write transaction. Never treat a request-body approval tuple as authority. Bind label and NFC to that same tuple. Persist the successful verification as an informational finishing fact, with original job/result digests and actor. Idempotently return an already recorded exact success before applying the unexpired-job gate again; reject conflicting linkage. First receipt must arrive before job expiry. An unrecorded late result cannot silently become success: remove/discard the tag and retry a fresh tag if required. Approval, learning, inventory, assembly and sonic welding are separate authorities; this module writes none of them.

Hosted private configuration (`NfcTrust`) uses `schemaVersion: "atlas-nfc-trust-v1"`, one or two `serverKeys`, and one to sixteen `workstationKeys`. Entries contain `keyId` (SHA-256 of exact DER SPKI) and `publicSpkiDerBase64`. Workstation entries additionally require `enrollmentPolicy: "windows-current-user-nonexportable-p256-v1"`. This is an explicit enrollment policy for vetted Windows identities, not a claim that JavaScript can remotely inspect private-key exportability. Server/workstation keys must be distinct. ATLAS must provision its own server key; no Ten Kings job trust or display-name substitution authorizes an ATLAS job.

## Existing Windows helper extension

Additive source lives in `packages/ai-grader-nfc-helper`. Existing V1/V2 routes and jobs keep their formats. ATLAS uses the existing ACR1552U/F8215 GoToTags operation factory, callback parser, protected directory and single operation gate, plus the existing named current-user nonexportable Windows CNG P-256 signer. That workstation must be separately allowlisted for ATLAS. Every conflicting protected V1/V2/ATLAS state fails closed before startup recovery changes it. ATLAS retains `active-atlas-job.json` plus its temporary operation until acknowledged; restart preserves verified success, and incomplete work becomes uncertain. No raw UID or UID digest is saved or returned by this path.

ATLAS configuration is disabled when `ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON` is absent. To enable in a separately reviewed installation, provide exactly:

```json
{
  "schemaVersion": "atlas-nfc-helper-trust-v1",
  "purpose": "atlas-program-approved-report-url-v1",
  "keys": {
    "current": { "algorithm": "ecdsa-p256-sha256-p1363", "keyId": "<SHA-256>", "publicSpkiDerBase64": "<DER SPKI base64>" },
    "prior": null
  }
}
```

One prior key may replace `null`. The strict existing SPKI parser is reused as a cryptographic primitive; overlap with any configured Ten Kings V2 job key is rejected. The helper also requires separately protected `ATLAS_NFC_WORKSTATION_TOKEN` (43–192 base64url characters, different from the legacy token). Its HTTP header is the existing `x-tenkings-nfc-token`. No secret or real key is supplied in this candidate.

Only `Origin: https://app.atlasgrading.com` can call ATLAS routes. Exact loopback Host, no query, bounded JSON, duplicate/unknown-field rejection and the dedicated ATLAS token are required. Legacy Origin/token cannot invoke ATLAS, and ATLAS cannot invoke legacy endpoints. All responses use the existing `{ ok, result }` / error envelope.

| Method and local path | Request / result |
| --- | --- |
| `GET /atlas/capabilities` | No body; `helperCapability`, `workstationKeyId`, `trustedJobSigningKeyIds`. No reader operation. |
| `POST /atlas/prepare` | `{job, freshTagConfirmed:true}`; returns `NfcOperationResponse`. |
| `POST /atlas/status` | `{jobEnvelopeSha256}`; returns exact operation state/result. |
| `POST /atlas/success-ack` | `{jobEnvelopeSha256, tagRemoved:true}`; send only after hosted durable success and human removal. Returns `{cleaned:true}`. |
| `POST /atlas/discard-ack` | `{jobEnvelopeSha256, acknowledgementNonce, phase, tagRemoved:true}`. Phase is `failed`, `uncertain`, or `completed_unrecorded`; exact nonce comes from status. Human removes/discards the tag. |

Only the protected random GoToTags integration URL may call `/gototags/atlas/callback/<identity>`; it requires local non-browser callback rules and exact correlation/readback/lock evidence. Callback identity is not exposed in browser responses. This is operational attestation, not unclonable chip/slab authentication.

Preparation requires the human to confirm one unused F8215 from controlled inventory kept off the reader. It opens the protected operation in GoToTags; the human still clicks **Start Encoding** and places exactly one tag. Freshness/removal are human operational controls, not electronic blank-state/removal measurements. Failed, interrupted or uncertain tags must be removed/discarded before retry. Encoding is never automatic, and no helper result attests to physical assembly or welding.

The existing installer and pairing flow are unchanged. This candidate does not deliver an ATLAS browser token, alter shortcuts or register an ATLAS installation. A reviewed ATLAS token bootstrap/provisioning extension and explicit maintenance authorization are required before real use; do not reuse the Ten Kings pairing code as ATLAS authority.

## Wire format and validation

Signatures use SHA-256/ECDSA P-256, 64-byte IEEE P1363, canonical unpadded base64url. Canonical statement order is exported as `JOB_FIELDS` / `RESULT_FIELDS`: UTF-8 field values separated by one LF, no trailing LF; version uses decimal integer representation. Job envelope SHA-256 hashes `canonicalJob + LF + signature`. Timestamps require `YYYY-MM-DDTHH:mm:ss.sssZ`. Results must be observed within the signed job window; a server clock allows only 30 seconds of forward skew. Public-only synthetic `test/nfc-vector.json` lets Node and C# verify identical bytes without retaining fixture private keys.

`node --test packages/atlas-finishing/test/*.test.mjs` passes seven hardware-free tests, including mutation of every signed field, approval/version/nonce isolation, expiration, URL variants, trust/key separation and the shared vector. The C# suite adds protocol/vector tests plus a synthetic protected lifecycle/HTTP test (Windows ACL boundary, fake GoToTags/backend, ephemeral keys only). A task-owned Microsoft .NET SDK 8.0.424 was downloaded from the official source, SHA-512 verified, used temporarily and removed. The full `net8.0-windows` solution compiled on macOS with zero warnings/errors and offline package sources. The synthetic C# executable passed 18 groups (including actual ATLAS Node/C# signature interoperability), skipped eight Windows-only groups, and failed none. Its fake loopback listeners were disposed; the helper Program, real reader, GoToTags UI and production key store were never started. Windows protected-state/CNG tests and real tag acceptance remain separate requirements. No persistent installation, operational restart, real tag/provider call or live write occurred.
