# September 17 bounded storage qualification

Prepared, reviewed and sealed; **not authorized or executed**. This is a new
qualification of the actual photo upload grant and manual artifact SDK adapter.
The September 12 failed canary and its execution intent remain unchanged.

## Exact action for owner approval

Use the existing private `atlas-grading-private-20260910` bucket in NYC3. Create
at most two synthetic 65-byte test objects, exercise integrity/private access,
then delete only these verified task-owned objects and confirm absence with
authenticated HEAD and GET. No real card, bucket policy, CORS configuration,
credential, database, model or website change is included.

The exact namespace is
`atlas-connected-manual-v1/release-qualification-20260917/b1f6ca96-236f-4d7a-ac7c-c0c163cd05dc/`.
Only these two keys are allowed:

- `originals/probe.bin`
- `artifacts/probe.json`

Across both profiles, hard limits are six PUT attempts, **390 uploaded bytes**,
four DELETE attempts, 60 total HTTP requests and ten minutes. Every GET response
is capped at 4 KiB and each request at ten seconds. No SDK retries are allowed.
The artifact profile starts only after the photo profile passes and is cleaned.

For each key, require initial absence, an unversioned bucket, rejection of a
wrong SHA256 checksum, successful exact creation/readback, denied anonymous
access, rejection of a conditional overwrite, unchanged full bytes, and rejected
nonmatching read precondition. The photo profile also checks browser CORS.
Failed gates stop further qualification. Cleanup requires verified ownership;
uncertain writes or changed versions require reconciliation instead of guessed
deletion. An exclusive intent permanently prevents repeating this action.

## Sealed evidence and validation

The [sealed manifest](/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/qualification-20260917/manifest.json)
binds the exact plans, synthetic payloads and all enumerated source files.
Its SHA256 is
`df241876bd306fb630ac605aa6a9341b442ee253f9ada1587fad4456dc586d1e`.
The executor refuses source, target, key, payload, cap or evidence-path drift.
Inputs were independently validated offline. No execution intent or execution
evidence directory has been created for this new action.

Both independent reviewer and lead ran **57/57 passing offline tests**, covering
the adapters, bounded executor, actual SDK serialization against synthetic HTTP,
failure handling and cleanup. This proves neither live provider checksum
enforcement nor conditional-write behavior; those remain release blockers.

The [connected release runbook](../../runbooks/CONNECTED_MANUAL_RELEASE.md)
requires separate live-storage authorization. The former one-shot permission was
consumed by the failed September 12 test. Approval of this exact manifest
authorizes only this new bounded qualification and its owned-object cleanup.
Production release and genuine human report certification remain separate.
