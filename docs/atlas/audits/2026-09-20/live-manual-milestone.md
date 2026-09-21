# Live manual grading and Astra assistance

Owner direction: September 20 Pacific / September 21 UTC, 2026. Complete a live
manual grading workspace that Mark can test, with human-requested Astra
assistance. Autonomous operation and completed slab finishing follow this
milestone. SAM remains deferred unless real testing establishes a need.

## Current evidence

The qualified application remains `30dbea77c484e61de56da522d67a841cb9df25ee`.
Its exact 555-file native image is
`sha256:50ffd1e6ab8a0967a7dbbb214788a9b134ae20625aac9ba9a85cf5967635b2f4`.
The prior native pixel checks, 379 package tests, 42 staff/manual tests,
49 PostgreSQL assertion groups and 14 required CI jobs passed. No runtime code
has changed in this continuation. See the [native qualification](../2026-09-17/native-release-qualification.md).

Fresh read-only production inventory confirms 97 applied public migrations,
13 rolled-back public attempts, zero unfinished migrations and 35 staff
migrations. Exactly five additive staff migrations are prepared. Inventory's
additional public migrations must be preserved. The new restricted manual role,
schemas, service, networks and web deployment have not been activated.

Three fresh Astra Extra High specialists cover storage, web/control release and
database/private-host release. Their prepared actions have exact before-state
checks and separate, deliberate activation steps. Mark's instruction authorizes
completion of this milestone; it does not fabricate a human certification or
real-card acceptance.

## Storage observations

The September 17 sealed qualification ran once under the current owner direction
and failed safely. Its wrong-checksum browser PUT returned 200; its only 65-byte
object was fully verified, deleted and confirmed absent. Its exclusive intent
and the earlier failed canary remain consumed and must never be replayed.

A distinct diagnostic, manifest
`22aa4b49790f12add6b5b9cc48d29669bfe002dfb7e3e376842cd4474cad6dd5`, used fresh
synthetic keys and passed 19 offline tests before execution. The photo profile
established these independent provider behaviors:

- An explicitly signed checksum-algorithm HTTP header still did not cause the
  provider to reject an incorrect upload checksum.
- A create-only collision returned 412 and left the original bytes unchanged.
- A mismatched GET precondition returned 412.
- Anonymous HEAD/GET were denied; complete-byte readback and browser GET passed.
- CORS did not allow the added algorithm header. No CORS change was made.
- Both photo creations were cleaned and confirmed absent with HEAD and GET.

The artifact profile stopped at its first deliberately wrong-checksum SDK PUT,
without an observed HTTP result. A separate sealed reconciliation subsequently
confirmed HEAD404 and GET404: two requests, zero PUT and zero DELETE. All
diagnostic objects are absent. No artifact capability result can be inferred
from the interrupted PUT. Overall diagnostic totals: 31 requests, four PUT attempts totaling 260 bytes,
two verified-owned DELETEs. Result SHA256:
`9b6ad2a1045fadd52f5f4164a757cdb4bbe27896983110f8a02654582dd4f70d`.
Reconciliation result SHA256:
`d003311642ef3717e17525bf27732f82ca6a99540b6223dff00f68b0d2fc04ab`.

This diagnostic can never return release qualification. The existing deployment
runbook already permits bounded full-byte SHA256 verification when the provider
does not return a native checksum. The actual photo adapter performs full-byte
verification before decode/adoption; the artifact store verifies complete bytes
and lineage before returning an immutable reference. Independent review confirms
that the strict provider-checksum-refusal gate exceeded this existing product
contract. A distinct live qualification will require actual application rejection
of altered bytes before decode/adoption, exact correct-byte readback and
create-only refusal, using the default Node SDK HTTP transport. Earlier failures remain
failures; no checksum, conditional-write or read-verification check has been
removed from the runtime.

## Remaining activation and acceptance

Complete application-level storage qualification, then activate the five staff
migrations, restricted role, private service, dedicated staff/public deployments
and exact control bindings. Verify the hosted route, ordinary sign-in and manual
workspace. A real signed-in session is required to exercise the actual hosted
long-response path; synthetic credentials must not replace ordinary access.

Mark's fresh-card test then checks original image quality, paired geometry,
manual corrections, Astra suggestions, save/reload and reviewed-defect memory.
Human optical acceptance, improved model accuracy and final report certification
are not implied by deployment. No autonomous operation, public certificate/label
bridge, physical slab completion or SAM integration is claimed.

External normalized evidence is retained under
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/`
in `storage/compatibility-20260920`, `release-auth-database-20260920` and
`web-control-20260920`. Credentials are excluded from these receipts.
