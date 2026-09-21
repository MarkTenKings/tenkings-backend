# Live manual grading and Astra assistance

Owner direction: September 20 Pacific / September 21 UTC, 2026. Complete a live
manual grading workspace that Mark can test, with human-requested Astra
assistance. Autonomous operation and completed slab finishing follow this
milestone. SAM remains deferred unless real testing establishes a need.

## Current inspection release — September 21, 06:26 UTC

The requested viewer and photo-context improvements are now live on source `406466a089bdd2d34022bc8c06283a0649978b15` and native image `a5159e7478d87e4267e11433f68ba595d6d2e70c1968ad9754a53431fb47be4c`. Staff `dpl_EmKqeZg4wN6PhVQX97DXc9BK71cC`, public `dpl_DnjnMSVL4fKPFsqR1gscuMvsifr5`, private runtime and controls18/16 match, with all four public aliases and the production target verified. No migration, paid analysis or review action accompanied this release.

The viewer exposes real surrounding photo pixels, 16× zoom and drag pan, individual suggestion focus, an image-only 3× magnifier and expanded inspection that preserves drafts and focus. Future explicit analyses use versioned context-inclusive crops; existing saved results retain their original contracts. The owner-observed three Front/four Back Charmander suggestions remain the preservation baseline. See [the full inspection release evidence](../2026-09-21/inspection-release.md) for qualification, runtime identities and remaining acceptance.

## Previous reliability evidence — historical

The combined identification retry and background Astra release is live at
`ada00815447477cbd835e0e762f3c5aac8bd713b`. Its native image is
`sha256:6f06092ff4ddcd78a1c82741c37c58cc311074ab9b80a81c91df85ae42b968b0`;
all 564 source files match manifest
`93e95a507f5ee429463ba39f57904741016587f164f98d0b42d2878380a9d96d`.
Actual Linux/amd64, Node20.20.2 and Next15.5.25 build, source and boundary checks
passed, followed by 429 package tests and 59 staff tests without skips. All 14
exact-source jobs passed in [CI run35561351830](https://github.com/MarkTenKings/tenkings-backend/actions/runs/35561351830).
Native source and actual addon/library hashes are unchanged from the previously
qualified image; its native pixel evidence carries forward on that verified basis.

Two isolated PostgreSQL17.11 runs passed: eight connected assertion groups,
26 identification retry assertions, and 22 memory/analysis groups including six
background groups. Each applied 95 public and 42 staff migrations and verified
both no-op replays. The fresh privilege catalog checked 2,950 columns, 14 manual
tables and six nontrigger functions; grant replay made no change. Both temporary
clusters stopped and their owned database files were removed. These fixture
counts are distinct from the production public ledger of 97 migrations.

Production staff migrations 41/42 and the exact 375-byte grant addition have now
passed, with a second no-op deploy and full 14-table/six-function ACL validation.
The prior 40 staff records, public97 ledger and original card/request/receipt
history are unchanged. The first database preflight stopped before mutation
because it counted nine background processes as client connections. Read-only
reconciliation established 13 clients and nine usable client slots; a distinct,
reviewed executor corrected only that capacity calculation and applied the same
sealed migrations and grants. The refused attempt remains retained.

The new private container
`ae758fb3fcf597f19dd79c0b0768c2896cd0674eba4e891cf80d4ab9ccd55dc4`
started at 05:06:14 UTC on September21 with exact image6f06092f and sourceada00815.
The old source30d container remains stopped, detached and retained; it must not
restart after migration41. Caddy and unrelated services are unchanged. Actual
signed HTTPS proof passed with unsigned401, absent-route404 and signed malformed
command400 before authentication or business effects.

Staff deployment `dpl_79sny3VmF6szxpSVE8Gj6ydnajDc`
(`atlas-grading-staff-3tk29xw6f-ten-kings.vercel.app`) and public deployment
`dpl_5B1MvLxJ7rzREP8SowGw8jC5LA4y`
(`atlas-grading-public-eaa1sly2b-ten-kings.vercel.app`) are READY for sourceada00815.
StaffControl revision17 and STAFF SMS revision15 bind that staff deployment,
source and configHash
`f8f15504b936f697747a421783cc5abca1bfdc44aaf05c578b8ff9a2121a652f`.
All other control rows and original history are unchanged. The public promotion
was sent once; final readback confirms all four aliases and the production target
select the new public deployment/sourceada00815, preserving the www308 redirect
and project settings. Seven unauthenticated routes and all 32 actual JavaScript/
CSS assets passed with the new public/staff deployment IDs; customer delivery is
unchanged. These checks do not establish a new authenticated owner session or
a real Astra result.

Verified reliability receipts (SHA256):

- Native/fixture qualification summary: `f6e1d15761adfbed02443eaffb9c698e28c9014756e6be836379fd5805719e7a`.
- Production staff42 and ACL: `075304314811f11ab9ead518371278b70772db3da7f68b59d3b16b91c289f82b`.
- New private runtime: `5e9e5bb05d73d18e4d767bf29e9d8b59e781f7b0f37cd7f0d97c177efd7c4f48`.
- Signed HTTPS proof: `ccf992254f9fbcf8b8065c2a6ce17769747445969120527dcc3362da0e55a667`.
- Exact two-control rebind: `f4f523857b0e44ce312d85d41beb9f38e25d3657813e92d9042e920304cdd834`.
- Final public alias/target readback: `baf46e28b707df78308e43377df4e48727015b174bbc07bcc4cef9a04fb2bd7d`.
- Seven unauthenticated routes: `aec53478b637f7f1bb36124f211071bf468003b7b67642e10df633ca025d30ba`.
- Thirty-two actual JavaScript/CSS assets: `eb5c788cd1bb38956ad1a6ea81b6316bde383d6794913bc0c3bbba8906db4c82`.

Final independent host/database readback confirmed exact sourceada00815/staff3tk29
startup without errors or restarts, staff42 and the complete 14-table/six-function
ACL, and unchanged prior40/public ledger/all13 original manual history sets.
The background lookup worker was observed with one idle manual connection and
zero new provider events, retry links or replacement links.

No new paid analysis accompanied this release. The original foreground UNKNOWN
attempt and its uncertain accounting remain intact. Real-card acceptance of a
new background analysis, displayed proposals and inspection quality remains
pending; deployment does not confirm findings or issue a human report approval.

## Initial source30d release checkpoint: September20 Pacific / September21 UTC

The initial release used `30dbea77c484e61de56da522d67a841cb9df25ee`.
Its exact 555-file native image was
`sha256:50ffd1e6ab8a0967a7dbbb214788a9b134ae20625aac9ba9a85cf5967635b2f4`.
The prior native pixel checks, 379 package tests, 42 staff/manual tests,
49 PostgreSQL assertion groups and 14 required CI jobs passed. That release is now superseded by the reliability cutover above; its receipts remain historical evidence. See the [native qualification](../2026-09-17/native-release-qualification.md).

The initial five additive staff migrations applied, bringing the staff ledger
from 35 to 40. The second deployment was a no-op, and an independent database
check passed. All 97 applied public migrations and 13 historical rolled-back
attempts are unchanged; there are no unfinished migrations. The initial role
transaction rolled back when a validation query evaluated a sequence privilege
check against a toast relation. A separate role-only action corrected that type
guard without changing any grants. The restricted role was first created NOLOGIN and passed all
13-table/four-function effective privilege checks; receipt SHA256
`494d828314681bddd2c130c01b8ab770185a833400eae21e7b7772b034f27a6a`.
The role then passed actual TLS login with the new private credential, retaining
NOINHERIT, connection limit two and the same restricted privileges. Both hosted
builds became READY and the qualified private service ran. Caddy routed
the manual endpoints to that service. Actual signed HTTPS transport passed, and
the eight control updates passed independent exact-delta readback. All four public aliases and the production target selected that release;
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
initial five staff migrations and reliability migrations41/42, restricted role
activation, private service, current two-control rebind and final public alias
readback are complete; consumed actions must not be replayed. A real signed-in session is required to exercise the actual hosted
long-response path; synthetic credentials must not replace ordinary access.

Mark's fresh-card test then checks original image quality, paired geometry,
manual corrections, Astra suggestions, save/reload and reviewed-defect memory.
Human optical acceptance, improved model accuracy and final report certification
are not implied by deployment. No autonomous operation, public certificate/label
bridge, physical slab completion or SAM integration is claimed.

External normalized evidence is retained under
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/`
in `storage/compatibility-20260920`, `release-auth-database-20260920`,
`web-control-20260920`, `runtime/retry-candidate-20260921` and
`identification-retry-20260921`. Credentials are excluded from these receipts.

## Initial source30d delivery evidence

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

The terminal attempt remains immutable. The qualified reliability release adds
an explicit retry using the same photos and saved OCR with a new linked attempt,
preserving all earlier evidence. Its clearer error message and retry controls are
live in the new staff build after verified public alias propagation.
Hosted130-second verification, full findings/Astra workflow and distinct-card
learning acceptance remain open.

After API funding, owner screenshots show successful suggestions for Charmander 004/165, Scarlet & Violet—151 (2023), on card `522610ad-3b06-4657-bf66-90f510fc9435`. Both Front/Back geometry panels subsequently show Ready to review and centering measurements. The owner initially reported a missing Front border, then confirmed it appeared after confirming the Front outline; this is not retained as an unresolved detector defect. The required human Pokémon/Trainer/Energy discriminator was confusingly labelled Pokémon layout. The deployed UI now says Pokémon card kind, explains its design-reference/reviewed-correction purpose, and uses native required-select validation. The discriminator and shared identification contract are unchanged.


## First Astra defect-analysis acceptance result

The owner confirmed both geometry sides and requested Astra’s initial defect inspection. Analysis `0bfd4f94-7b6a-40a7-8bc2-b5140b8e1015` dispatched at04:04:52UTC and recorded UNKNOWN at04:06:52UTC, matching the120-second provider deadline. No HTTP response, response ID, token usage or defect result was retained. A later read confirms no RESPONSE receipt. It is unknown how much provider work occurred; no completed inspection, failure to find defects, absence of charges or safe automatic replay is inferred. The combined reliability release above now includes the qualified versioned
background-response/retrieval repair. No new paid analysis has been initiated by
the release. The owner may now explicitly request
a linked new analysis for this no-response-ID UNKNOWN attempt. Actual provider
acknowledgement, collection, displayed proposals and inspection quality still
require real-card evidence. Background completion must preserve the human draft
and must not confirm findings or issue report approval.


## Owner-observed background result and inspection improvements: September21 UTC

Mark supplied five screenshots of successful Astra suggestions and traces on both faces of Charmander522610ad: three Front and four Back suggestions are visible, with uncertainty and review controls. He reports that detection and tracing worked well. This establishes owner-observed displayed background results, not objective defect accuracy, reviewed findings or final report approval. His requested next improvements are stronger zoom/magnification, direct focus on a suggestion and visible source-photo margin around all edges for both review and Astra detail crops. The [fresh-lead handoff](../2026-09-21/inspection-viewer-handoff.md) records the local implementation and remaining contract/release work. The currently live application remains ada00815; no new paid request or deployment was performed for this checkpoint.
