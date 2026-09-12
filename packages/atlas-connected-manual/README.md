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
Apply the three reviewed additive SQL proposals only through a recorded release:
`atlas-manual-service/sql/proposal.sql`, `atlas-manual-intake/sql/proposal.sql`,
and this package's `sql/proposal.sql`, followed by their narrow grant functions.
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
artifacts. It issues two OCR calls and the unchanged shared identifier request.
Missing provider results become UNKNOWN and do not automatically redispatch.
The narrow append-receipt function can retain a matching already-dispatched
response after staff expiry, without authorizing adoption or new provider work.
Provider usage and unknown outcomes remain evidence; no guessed costs or invented
successful responses are recorded. This is identification, not an Astra grading
operator, detector, learning publisher, market research or finishing system.

## Qualification and release

See `docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md` for exact config boundaries,
building the pinned Linux image, rollout checks and owner acceptance. The owned
`local-browser.mjs` and `validate-postgres.mjs` scripts use only disposable fixture
DBs, synthetic SMS/model replies and private test storage. They are never serving
entry points. `qualify-linux.mjs` compares the retained original-derived pixels
against independently checked Mac reference pixels using read-only mounts.
