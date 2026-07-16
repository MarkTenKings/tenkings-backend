# Feiju iPhone-assisted NFC profile

## Classification and bounded qualification authority

This profile is additive to the existing NTAG215 workstation workflow. It covers only the same-lot product qualified through the documented sacrificial iPhone test:

- Product: OKAVAD `FPC-215-126`, ASIN `B0GX1LSPJ2`.
- Manufacturer reported by NFC Tools: Shanghai Feiju Microelectronics.
- Technology reported by NFC Tools: ISO 14443-4 / IsoDep.
- Direct T=1 PC/SC selection of both standard NFC Forum Type 4 NDEF applications returned `6A81`.
- Therefore the product is classified as `FEIJU_PROPRIETARY_ISODEP`, never NFC Forum Type 4 and never NTAG215.
- The same-lot sacrificial iPhone qualification result is `ios_consumer_write_protection_verified`: NFC Tools wrote the exact test URL, reported a successful lock and `Writable: No`, rejected one alternate-URL overwrite, retained the original URL, and normal iPhone scanning continued to open it.

That result proves only consumer iPhone/Core NFC overwrite resistance for the qualified sample and same-lot workflow. It does not prove hardware-level permanence, originality, unclonability, cryptographic tag authentication, card authenticity, or slab authenticity.

## Profile contract

The exact persisted profile is:

- chip/profile identity: `FEIJU_PROPRIETARY_ISODEP`;
- security/workflow mode: `manual_ios_locked_static_url_v1`;
- profile and qualification version: `feiju_iso_dep_ios_static_v1`;
- registration kind: registered static NFC link;
- write-protection evidence: `ios_read_only_status_observed`;
- `workstationOperationalAttestation=false`;
- `cryptographicTagAuthentication=false`;
- clonable static URL: true.

The profile never accepts, reads, fingerprints, stores, returns, or requires a Feiju UID. It adds no proprietary Feiju APDUs, PC/SC commands, ACR1552U path, helper route, driver requirement, firmware action, or arbitrary NFC-content access. The existing NTAG215 helper protocol and ECDSA workstation-attestation contract are unchanged. The `NTAG424_DNA` / `ntag424_sun_v1` seam remains unimplemented.

## Feature gates

```dotenv
AI_GRADER_NFC_PROGRAMMING_ENABLED=false
AI_GRADER_NFC_MANUAL_IOS_ENABLED=false
AI_GRADER_NFC_REQUIRED=false
```

The manual iPhone feature is available only when both the general programming gate and the separate manual-iOS gate are true. It does not require the NTAG215 attempt-token secret or workstation public-key allowlist because it never claims workstation attestation. `AI_GRADER_NFC_REQUIRED` remains a separate inventory policy and must remain false until independently approved.

## Operator workflow

The authenticated operator opens `/ai-grader/nfc?reportId=...` and explicitly selects **Feiju -- iPhone assisted**. The workflow is then:

1. Reserve the normal server-generated `https://collect.tenkings.co/nfc/{publicTagId}` identity for the exact published report, CardAsset, Item, certificate, and label.
2. Copy that exact URL. In NFC Tools by Wakdev on iPhone, write exactly one URL record. Do not add another record, format, erase, password-protect, or use a PC reader.
3. Close NFC Tools and use a normal iPhone background tap. The public route records a bounded pre-lock setup-verification event and returns only generic setup state; it exposes no report, card, item, certificate, operator, or private identifier.
4. In NFC Tools choose **Other -> Lock a tag** and perform the irreversible confirmation.
5. Re-present the tag in NFC Tools and confirm that it reports `Writable: No`.
6. The authenticated operator records that exact confirmation. This stores `writeProtectionEvidence=ios_read_only_status_observed`; it does not claim a hardware lock or cryptographic proof.
7. Remove the tag from the phone field, then perform a final normal background tap to the same exact URL. The public route records the bounded post-lock setup-verification event.
8. Only after both exact-URL tap gates and the lock confirmation may the authenticated operator complete activation.

Do not attempt an alternate-URL overwrite on a real report tag. That destructive discriminator was authorized only for the sacrificial qualification sample.

## Persistence, privacy, and integrity

`AiGraderNfcManualIosAttempt` is separate from `AiGraderNfcProgrammingAttempt`. It stores only the exact linkage, authenticated operator, hashed idempotency keys, expected/readback payload SHA-256, bounded timestamps, profile/qualification version, workflow state, and the fixed evidence/assurance values above. It does not store IP address, phone identifier, UID, arbitrary NFC content, NFC Tools secrets, browser secrets, or workstation evidence.

The state machine is bounded and idempotent:

`awaiting_prelock_tap -> awaiting_lock_confirmation -> awaiting_postlock_tap -> ready_to_complete -> consumed`

Attempts expire within 30 minutes, with the hosted service creating the normal bounded short-lived attempt. Public taps advance only the exact live Feiju registration for the exact server URL. Replays are idempotent, an alternate URL cannot complete activation, and completion requires the stored expected/readback digests to match. Existing report/CardAsset/Item uniqueness, report advisory locks, immutable audit events, revoke-before-replace behavior, published-report checks, public-route privacy, and inventory enforcement remain shared with the NTAG215 workflow.

Approved public wording is **Registered Ten Kings NFC link** or **Write-protected registered NFC link**. Never describe this profile as tamper-proof, unclonable, cryptographically verified, or cryptographically authenticated.

## Migrations and rollout

The additive migrations are:

1. `20260716190000_ai_grader_nfc_feiju_profile_enums` -- commits the new chip and security-mode enum values.
2. `20260716190500_ai_grader_nfc_feiju_ios_profile` -- creates the separate manual-attempt table and updates the tag strategy/evidence constraints.

PostgreSQL requires the enum values to be committed before they are used by table constraints, so the two migrations must remain separate and ordered. Apply them only through the deployment runbook after review. Deploying code or migrations does not authorize enabling the manual-iOS flag or programming a real tag.

Rollout order is migration review, migration application, hosted-code deployment with the manual flag false, authenticated readiness/privacy checks, separate approval to set `AI_GRADER_NFC_MANUAL_IOS_ENABLED=true`, and a separately authorized controlled production operation. Keep `AI_GRADER_NFC_REQUIRED=false` unless its independent inventory gate is approved.

Rollback begins by setting `AI_GRADER_NFC_MANUAL_IOS_ENABLED=false` and, if required, `AI_GRADER_NFC_PROGRAMMING_ENABLED=false`. Preserve registrations, attempts, and immutable audits; deleting or rebinding NFC data requires a separately reviewed destructive migration and explicit approval.

## Validation expectations

Required regression coverage includes feature-disabled behavior, human authorization, init/completion idempotency, exact URL integrity, both public tap gates, missing lock confirmation, replay, expiry, activation, revoke/replace, public privacy, inventory enforcement, unchanged NTAG215 workstation attestation, and the unimplemented NTAG424 seam. Migration proof must use a new disposable loopback-only PostgreSQL database and must demonstrate clean first deploy, exact catalog/lifecycle behavior, second-deploy ledger stability, and scoped teardown.
