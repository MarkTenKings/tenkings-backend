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
49 PostgreSQL assertion groups and 14 required CI jobs passed. The serving runtime is unchanged; the later local recovery repair below is not yet deployed. See the [native qualification](../2026-09-17/native-release-qualification.md).

The five additive staff migrations have now applied, bringing the staff ledger
from 35 to 40. The second deployment was a no-op, and an independent database
check passed. All 97 applied public migrations and 13 historical rolled-back
attempts are unchanged; there are no unfinished migrations. The initial role
transaction rolled back when a validation query evaluated a sequence privilege
check against a toast relation. A separate role-only action corrected that type
guard without changing any grants. The restricted role was first created NOLOGIN and passed all
13-table/four-function effective privilege checks; receipt SHA256
`494d828314681bddd2c130c01b8ab770185a833400eae21e7b7772b034f27a6a`.
The role now passes actual TLS login with the new private credential, retaining
NOINHERIT, connection limit two and the same restricted privileges. Both hosted
builds are READY and the qualified private service is running. Caddy now routes
the manual endpoints to that service. Actual signed HTTPS transport passed, and
the eight control updates passed independent exact-delta readback. All four public aliases and the production target now select the new release;
the existing www308 redirect is preserved. Ordinary owner sign-in, new-card identification and paired geometry are now observed; hosted long-response and the complete findings/Astra acceptance remain pending.

Multiple Astra Extra High specialists cover storage, web/control release,
database/private-host release and independent review. Their prepared actions have exact before-state
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

That distinct qualification subsequently **passed live**. Manifest
`8f57fd8d95cd189e13c6330238eddc7523fcb4ad459a5cf5f13d1f2f9b4f1b98`
produced result
`5db8cb533bd1d1070d8c6abdda74218845846c218fabff1aaec43bd85e1bd06b`:
43 requests, five PUTs totaling 325 bytes and three verified-owned DELETEs.
Actual `decodeOriginal` rejected altered bytes with `PHOTO_STORAGE_CONFLICT`
and zero decoder calls. Exact original SHA256, signed browser read/CORS and
actual artifact-store content/SHA256/lineage verification passed. An incorrect
artifact input hash was rejected without HTTP. Both overwrite attempts returned
412 and preserved original bytes. Both final objects were deleted and verified
absent by HEAD and GET. A second specialist independently checked every dispatch
against the response journal. Native checksum refusal remains unqualified.

The eight reviewed staff-project environment operations have completed with
per-operation readback and unchanged unrelated rows. Existing bridge values are
preserved in private rollback custody. The new transport key is stored privately;
provider metadata alone does not prove its runtime value. The actual READY staff build uses
these settings, the public gateway selects that immutable staff deployment, and
the database controls now match the new release.
Environment result SHA256:
`ee2e958356535a11bf95b6afadf91b04f43bc436e3362930a4f05fcac579a70b`.

## Remaining acceptance

Ordinary sign-in, original intake, successful identification on a subsequent card and both-side geometry are observed. Continue through findings, Astra assistance and reviewed learning. The public aliases and live staff sign-in page are verified. The
five staff migrations, restricted role activation, private service, Caddy route
and eight-row control transaction are complete; consumed actions must not be
replayed. A real signed-in session is required to exercise the actual hosted
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

The first staff upload was refused locally before any deployment or file POST.
Three metadata GETs completed; provider readback found no new deployment. A
second upload stopped after a definite missing-files response and incomplete
content uploads, with no deployment created. Both consumed intents remain
preserved. The corrected third staff upload succeeded with exact-byte source
uploads and authentic provider Git metadata; application code did not change.

A direct read-only OpenAI model-access check returned HTTP200 for
`gpt-6-astra` using the retained configured account. It made no inference request
and does not establish the account balance or real-card result quality.

Hosted staff: `dpl_D2d5usjWgiRMxJ3yLhY3XU4NRoNo`,
`atlas-grading-staff-5cnmp4jnf-ten-kings.vercel.app`.
Hosted public: `dpl_8SLu6tEzN9EXhG1sVbHvcLBVrK5C`,
`atlas-grading-public-mzh92wy4i-ten-kings.vercel.app`.
Both actual provider readbacks confirm source `30dbea77`, their respective
project roots and Node20. Final readback verifies all four public aliases and the production target on
this new public deployment, preserving the www308 redirect. The live browser
renders the ordinary staff sign-in page at https://atlasgrading.com/admin.
The private service emitted its actual listening event for the same new staff
host/source on port4319; all22 other container identities/states were preserved.

Release activation evidence:

- Corrected isolated Caddy validation passed: `7452ffab6177b78f431173cf7c7a84ca6d7259834dc8fac2d468405a2c0056ef`. The original failure came from the executable's file capability and remains recorded.
- Serving Caddy reload passed: `104676a25437f8a901cbea6c29eeb6f8e6efc2515ea86a2228aa3c112eca7db0`. Exact reviewed bytes retain inode282983 and preserve all other routes and containers.
- Actual signed HTTPS transport passed: `9fad5fd65553648bba643ca008d8178ad5d86b5de11c01ce9507076b2117bc47`. Unsigned manual access returned401, an absent route404, and a signed malformed command400 before authentication or card/model work.
- StaffControl revision16 and STAFF SMS revision14 bind source30d/staff5cnmp/config157135; six legacy controls are disabled. Fifteen-table readback preserved customer and every unchanged row, snapshot `44294dc5bd617ca84af0611de74fc078e6aef89f1c78c2d5b3ced784b6f46a90`.
- The old SMS expiry and caps are historical fields. Actual installed functions match the owner-approved migration removing those admission checks; no policy extension or reset occurred. Genuine phone verification, rate limits, sessions and CSRF remain.

Final public promotion readback: `0f0e32a575710b6283814d858f72584a02983aa975cc8f13bad65006ac625499`. The subsequent hands-on checkpoint below supersedes the earlier pending sign-in/identification status.

Unauthenticated live checks also pass: homepage, staff sign-in and customer pages
return200; protected grading/manual pages redirect to sign-in; all32 observed
JavaScript/CSS assets return200 with correct types. Staff browser cookies retain
Secure/HttpOnly/Path=/admin/SameSite=Lax attributes; no cookie or CSRF values were
recorded. This proves the public delivery and login surface, not authenticated
workspace operations.

## First hands-on result: September21 UTC

Ordinary owner sign-in and real Front/Back intake now succeeded, with both
originals verified and working images prepared. Automatic identification stopped
on a retained HTTP429 `credit_balance_exhausted` response from the API account.
The uploaded photos are intact. This is a confirmed funding rejection, not
accepted identification or Astra-quality evidence. The owner clarified that the
earlier credits funded Codex, then reported funding the API account.

The existing release keeps its terminal attempt immutable. An explicit retry
repair is being built locally to use the same photos and saved OCR with a new
linked attempt, preserving all earlier evidence. The clearer error message and
retry controls are not yet deployed. Hosted130-second verification, full findings/Astra workflow and distinct-card learning acceptance remain open.

After API funding, owner screenshots show successful suggestions for Charmander 004/165, Scarlet & Violet—151 (2023), on card `522610ad-3b06-4657-bf66-90f510fc9435`. Both Front/Back geometry panels subsequently show Ready to review and centering measurements. The owner initially reported a missing Front border, then confirmed it appeared after confirming the Front outline; this is not retained as an unresolved detector defect. The required human Pokémon/Trainer/Energy discriminator was confusingly labelled Pokémon layout. Local UI wording now says Pokémon card kind, explains its design-reference/reviewed-correction purpose, and uses native required-select validation. The discriminator and shared identification contract are unchanged.


## First Astra defect-analysis acceptance result

The owner confirmed both geometry sides and requested Astra’s initial defect inspection. Analysis `0bfd4f94-7b6a-40a7-8bc2-b5140b8e1015` dispatched at04:04:52UTC and recorded UNKNOWN at04:06:52UTC, matching the120-second provider deadline. No HTTP response, response ID, token usage or defect result was retained. A later read confirms no RESPONSE receipt. It is unknown how much provider work occurred; no completed inspection, failure to find defects, absence of charges or safe automatic replay is inferred. A versioned background-response/retrieval repair is under investigation. This live acceptance failure takes priority over releasing the already-reviewed identification retry.
