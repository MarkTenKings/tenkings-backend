# Connected manual grading

Connects native Front/Back intake, full-resolution SDR working images, shared
Google Vision/Astra eight-field identification, durable card details, paired
geometry/defect review and separately approved report snapshots. Standard-size
sports and Pokémon use the existing geometry and grading calculations.

The untouched native original, rich decoded primary and SDR working frame are
three distinct immutable assets. HDR-primary admission is explicit. Working
images use sRGB RGB8 without spatial resampling; preparation retains the existing
1270×1778 card grid and 1350×1858 inspection views. This is not full-HDR rendering
or a claim of physical optical acceptance.

## Runtime boundary

The dedicated Vercel staff app owns pages at `/admin`, ordinary sign-in, gateway
validation and browser CSRF. `manual-frontend-runtime.mjs` proxies only new card
routes to a fixed private HTTPS origin. `transport.mjs` signs the exact method,
path/query, body, cookie, CSRF, public Origin, content type, timestamp and nonce.
The private process verifies that evidence, rejects replay and reauthenticates
the ordinary staff cookie. A signature alone never becomes a staff identity.

`node packages/atlas-connected-manual/scripts/serve.mjs` starts the private CPU
service. Its explicit private runtime config binds the actual admitted Vercel
release/deployment and the same auth configuration hash. It does not expose a
second login or pretend the private host is Vercel. Use one private process with
the supplied nonce store; multiple replicas require a shared atomic nonce store.
TLS termination must pass the exact request path and headers without rewriting.

JSON requests/responses are bounded; the web proxy has a 210-second deadline
within the existing 240-second Next route budget. Large working images use
short-lived private object GET grants. The browser checks streamed size, expected
byte count and SHA-256 before decoding. Refreshed URLs preserve the verified Blob
and unsaved edits for the same pixel lineage. Storage CORS must allow the exact
staff origin for both direct PUT and GET.

## Persistence and recovery

Use the existing ordinary staff role and a separate restricted manual DB role.
Apply the reviewed additive SQL proposals only through a recorded release:
`atlas-manual-service/sql/proposal.sql`, `atlas-manual-intake/sql/proposal.sql`,
this package's `sql/proposal.sql`, `atlas-defect-memory/sql/proposal.sql`, and
`atlas-defect-analysis/sql/proposal.sql`, followed by their narrow grant functions.
They have been applied to disposable fixtures; this code does not migrate a live
DB at startup. Existing commercial inventory and old operator ledgers are not
part of the new manual schemas.

Original uploads are independent per side and version. The browser retains the
original Blob and exact upload identity across interruption. Missing replies
reconcile the same upload/action; uncertain requests are not silently replaced.
A definite refused plan with no possible dispatched grant can be discarded;
verified device copies can be explicitly cleared. Source replacement invalidates
only the changed side, and final CAS prevents stale source/report adoption.

Partial identity edits remain durable before geometry initialization. Suggestions
fill untouched fields only. After initialization, identity edits use the manual
workflow's report identity. A printed variant is not silently asserted to be a
parallel. Saved traces precede CPU remeasurement and survive a measurement failure.
One Confirm findings action accepts the corrected, inspected list; trained-human
approval separately records the exact computed report hash and immutable artifact.
Earlier approvals remain history after later changes.

Identification uses a unique card/pair claim and exact immutable request/reply
artifacts. New attempts persist `card-identification-v2` in the immutable input
envelope before dispatch; historical bare inputs and saved results retain V1
validation. Unknown or mismatched versions fail without provider fallback.
The shared V2 identifier issues two OCR calls with Google's text-only response
selection and one Astra request. Sports requests retain their original bytes;
Pokémon OCR hints add the reviewed instructions and an internally derived lower
Front PNG with exact interpretation-image provenance. Grading originals remain
unchanged. The request artifact retains the exact serialized envelope/model
request and its hash, including the crop bytes; provider transport sends the
OCR envelope's body and response-fields query separately.
Missing provider results become UNKNOWN and do not automatically redispatch.
The narrow append-receipt function can retain a matching already-dispatched
response after staff expiry, without authorizing adoption or new provider work.
Provider usage and unknown outcomes remain evidence; no guessed costs or invented
successful responses are recorded. This is identification, not an Astra grading
operator, market research or finishing system. The separate opt-in defect assistant
and reviewed-memory path below do not change identification behavior.

## Qualification and release

See `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md` for exact config boundaries,
building the pinned Linux image, rollout checks and owner acceptance. The owned
`local-browser.mjs` and `validate-postgres.mjs` scripts use only disposable fixture
DBs, synthetic SMS/model replies and private test storage. They are never serving
entry points. `qualify-linux.mjs` compares the retained original-derived pixels
against independently checked Mac reference pixels using read-only mounts.

## Reviewed defects and Astra

`ATLAS_MANUAL_DEFECT_MEMORY_ENABLED=true` enables publication from the existing
committed Confirm findings action. The original confirmer must retain REVIEWER
and card edit authority. Crops and exact masks are immutable private artifacts;
failed publication leaves the manual review saved and exposes same-action retry.
Later confirmations supersede earlier lessons, including a reviewed empty list.

`ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED=true` additionally requires that memory flag,
the new schema grants, and server-only `ATLAS_MANUAL_OPENAI_KEY`. It uses
`gpt-6-astra` with `xhigh`, two exact inspection images and overlapping detail
crops, up to12 relevant reviewed examples plus separately labeled trace overlays.
There is no SAM dependency. Each new request retrieves acknowledged current
knowledge; an empty reviewed bank is explicit, and pending publications prevent
analysis from silently using stale lessons.

The browser journals one exact action before requesting analysis. The server
persists and claims the exact request once; unknown paid outcomes are checked
without another provider call. Raw replies and actual usage are retained before
interpretation. Suggestions stay unreviewed until the human accepts, corrects or
rejects them. Acceptance/correction creates a normal exact trace pending the
existing CPU measurement; model-authored areas or grades are never used.
Later edits and source changes remain subject to ordinary manual CAS checks.

The new migration pair and grants must be activated with the coordinated private
service release. Synthetic tests demonstrate contract behavior, not real-card
defect accuracy or learning improvement. Live card comparisons remain required.

## Approved manual report delivery

A new manual V2 approval atomically saves its existing immutable approval/action
and a `PENDING` publication intent. Numbering follows the established issuer:
`ATLAS-` plus 12 uppercase hexadecimal characters and a separate `ar_` token.
One card keeps that identity; each approval receives the next version under the
card row lock. This does not issue a certificate, slab label or NFC association.

After commit, delivery hydrates the **saved approval action**, verifies its exact
report, geometry and two inspection derivatives, then stores an allowlisted
public packet and private media manifest. Only accepted findings and their exact
traces/measurements appear publicly. Staff identifiers, rejected suggestions,
storage locations, credentials and model provenance are excluded. V2 retains
its persisted half-point award; the legacy V1 parser, records and tenth-point
award are unchanged. A public link is bearer-readable and should be shared only
when the approved report is intended to be public; it exposes no draft access.

Storage or delivery failure leaves the original approval intact and the intent
pending. `POST /api/staff/manual-connected/cards/:cardId/publication` with only
`{actionId}` retries delivery of that exact approval under current staff/card
approval access. It cannot create another approval or invoke a paid model.
Workspace GET includes `publication` status and never starts delivery. Published
manifests are immutable. `/reports/:token?v=:version` preserves an exact version;
the unversioned route resolves the latest **published** version, skipping pending
successors. Browser print / save PDF uses the rendered report; there is no claim
of a separately generated or stored PDF file.

Production manual-only public delivery uses `ATLAS_PUBLIC_RUNTIME=manual`,
`ATLAS_PUBLIC_ORIGIN=https://atlasgrading.com`, no legacy database/media tuple,
and the paired public-app configuration
`ATLAS_PUBLIC_MANUAL_ORIGIN=https://private.atlasgrading.com` and
`ATLAS_PUBLIC_MANUAL_KEY`, a dedicated base64-encoded 32-byte key distinct from the
legacy media key. The native host uses the same dedicated key as
`ATLAS_MANUAL_PUBLIC_READ_KEY`, separate from staff transport/session/phone/router
keys. The manual-only configuration has its own `atlas-public-manual-reader-v1`
hash and constructs no database or legacy media client. First admission creates
`PublicReaderControl` revision1 with the actual public deployment/source/hash.
A complete legacy database/media configuration uses runtime `postgres` and
retains its exact old hash when manual settings are absent; partial legacy
tuples always fail closed. A bridge added to a full legacy configuration changes
its hash and requires a coordinated control binding. Key material stays server-only.

The fixed private `POST /api/internal/atlas/manual-public` port accepts only
signed report/version/media selectors, a 30-second TTL and one-use nonce. It
cannot authenticate staff or dispatch mutations. The native role alone receives
`atlas_manual.read_publication(text,integer,text,text,text)`; the manual-only public app
has no database role or connection. Fully configured legacy public readers
retain exactly their three existing legacy reader functions. The native read
checks deployment/release/config control before and after artifact/media reads.
Failure is bounded, sanitized and never automatically retried. The public app
serves exact inspection bytes from its same-origin report image route and checks
the approved hash again; the viewer independently verifies before display.

Migrations `20260922010000_manual_early_geometry` and
`20260922020000_manual_publication`, their narrow grants, the matching native and
public source, dedicated keys and current public control must be qualified and
activated together. Source implementation and synthetic local qualification do
not establish deployment or owner approval of any real card. The owned
`validate-publication-postgres.mjs` qualifier runs against all 44 current
migrations and is also included in the connected and release-storage qualifiers.
