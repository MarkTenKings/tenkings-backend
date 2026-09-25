# ATLAS submission and capture release — 2026-09-25

**LIVE; software verification passed. Acceptance on the original iPhone remains pending.** The public promotion passed at **03:16:47 UTC**, final strict preservation passed at **03:17:18 UTC**, and all **34 canonical read-only checks** passed at **03:17:29 UTC** on 2026-09-25. These checks establish the deployed release and its access boundaries; they do not establish a successful physical-iPhone upload or grading completion.

The application release is `e4a75df58d0f8c54423b845f1e5e4ffc4d8995bb`. The native runtime image is `sha256:65f6d935c5147788ccc64e6faa1f406cbfb127c255b7beaa8ac6b159a1de036f`, with source manifest `8b22beaed6147f327d1f2d64c789f8f1973a8e339f09154a1ca22137bb86cc00`.

## Live identities and preservation

| Surface | READY deployment | Immutable hostname |
|---|---|---|
| Staff | `dpl_GP7dsyGzdX3anJq3jYBPJfyx4aYi` | `atlas-grading-staff-edv9r7pw0-ten-kings.vercel.app` |
| Customer | `dpl_HtGqts71JmBA8LKUquAidKuwbZXt` | `atlas-grading-customer-pym3l1q2q-ten-kings.vercel.app` |
| Public | `dpl_BK6FzdB6YvRtziR27m6tKT2MhVWW` | `atlas-grading-public-1b9kdylap-ten-kings.vercel.app` |

The public deployment serves `atlasgrading.com`, with `www.atlasgrading.com` redirecting to it. Its router binds to the exact staff and customer deployments above. All three READY receipts identify the same frozen source.

The serving container is `9a21d430649a60d7bb16205f07085d9c157df222d0f481791571500bd50435da`. Cutover retained the stopped predecessor `780b01eb99076d3ede3084a07ced5b3071f5cc07880a25aaf0707cfeeab2acdd` and its image `sha256:532cfa57c6f86404db62a378094fa4d7af9fada38877ff649fe8dbc4a6ec252a`. Caddy and unrelated containers passed preservation checks.

The reviewed runtime plan SHA-256 is `08bf520ce2e02a3b66158f0261f37ea100b7e238dd8d39df02f1b495b5899e1e`. Runtime derivation changed exactly three binding fields: `ATLAS_MANUAL_WEB_DEPLOYMENT`, `ATLAS_MANUAL_WEB_RELEASE_SHA`, and `ATLAS_CUSTOMER_SERVICE_BINDING_JSON`. Existing secrets were preserved. Offline constructors opened and closed both clients with no network, database calls, provider calls, or worker starts.

The atomic control update changed exactly six rows: Staff 30→31, staff SMS 28→29, Public 8→9, Customer 10→11, customer SMS 8→9, and the customer service binding. Final checks preserved all 30 history tables and 21 customer tables. Customer intake and identification remain enabled; commerce, dealer operations, and stations remain disabled. This release did not activate a dealer kiosk or rotate service credentials.

## Delivered behavior

The customer service comparison now has aligned, integrated service timelines beneath full 16:9 videos; readable italic speed and price text; animated lightning for dealer service and flowing wind for mail-in; and a compact motion control. Both timelines share one cycle, reaching their delivery marks at seven and fourteen seconds. Pause, hidden-tab behavior, and reduced-motion preferences stop the relevant animation/video. Local visual checks passed at 320, 390, 820, and 1280 pixels without horizontal overflow.

Dealer search now opens an interactive Google map for the selected verified dealer after a search, location, or map action. The desktop finder heading stays on one line. An unmatched literal ZIP/city search explicitly falls back to the authorized directory, without claiming proximity or distance. One selected dealer pin is displayed at a time. Device coordinates are not sent to Google by the component, and the map does not load before user action.

**CenterCourt Cards, 307 Lincoln St, Roseville CA 95678 US**, remains a contact-only directory entry marked setup in progress. The signed private directory read returned **zero operational locations**. Continue cannot treat this contact as an operational drop-off station. No schedule or registry coordinates were invented. The actual Google embed was separately observed under the app's CSP in Chrome, including its CenterCourt pin and a zoom change from 16 to 17. The live canonical probe verified delivered markup, assets, and policy; it did not execute the map or request device location.

Staff screens now use ATLAS naming. The bulk importer distinguishes originals uploaded to ATLAS from originals saved for upload, then displays the current server job's queued, processing, review, attention, or approved state. Current-job projection excludes superseded work, and polling continues while Add cards is open. Existing card/review links lead to the same card.

## Capture, recovery, and queue findings

The affected iPhone JPEGs were being refused by a metadata boundary even though their full-resolution sRGB base was usable. The native fix admits the narrowly validated Apple primary capture-date/region metadata. Three exact affected originals passed replay in the qualified Linux image: all encoded original bytes and gain-map data were retained, the working image remained **3024×4032**, orientation was applied exactly once, and decoded/working pixels matched an independent full-size reference with no resampling. Processing uses the explicitly evidenced **sRGB SDR base**; this is not a claim of HDR radiance processing. Unknown HDR claims, malformed metadata, ambiguous color, and invalid gain-map structure remain refused.

The browser's saved-Blob metadata was not proof that Safari could still read its backing bytes. Recovery now accepts a second intact local original only when its SHA-256 and byte count match the existing upload plan; verified remote originals can resume without readable local copies. Existing card, upload, and action IDs are preserved. Busy pairs yield to other healthy pairs before bounded retries. Missing bytes cannot be reconstructed when every local copy is unreadable and no verified remote original exists.

The **pre-release** read-only queue census at 02:12:53 UTC found 12 cards with 24 verified sides and nine jobs requiring attention: five geometry reviews, two identity reviews, one analysis action conflict, and one storage failure. There were no analysis runs or terminal analysis refusals in that census. Thus a browser's earlier “queued” count did not establish that those jobs were actively grading. These are historical findings, not a claim that the current queue is cleared.

The analysis conflict came from inconsistent request hashing before execution; assistance now uses the executor's canonical hash contract. The affected saved job with no run/refusal can resume through its existing action and source fences. Background preparation no longer requests display preview URLs it does not need. Temporary `PHOTO_STORAGE_UNAVAILABLE` at PREPARE gets at most two retries, three seconds apart, with a durable retry count that survives waits, worker replacement, and explicit resume. Authorization failures, aborts, lease loss, later paid-analysis stages, and exhausted budgets do not receive this automatic retry. Geometry and identity review still require human review.

The batch worker runs **two jobs concurrently**, and the native operation limiter also allows **two operations**. **50 cards** is the admission limit for one server batch request, not a concurrency setting. The browser picker can retain up to 100 pairs for individual admission. This release makes no claim of 50 simultaneous grading jobs or a measured iPhone throughput improvement.

## Verification and evidence

- All three production frontend builds and **730/730 frontend tests** passed on the frozen source.
- The native image passed **585/585 tests across 55 files**, with zero skipped tests, plus all three exact-original replays. The initial run's two missing test-reference failures are retained in the evidence. The corrected run mounted only the two exact frozen reference files read-only; application source and image did not change. Qualification used no network or production credentials and made no production database/storage writes or model requests.
- Actual desktop Chrome and WebKit checks passed exact-byte persistence, reload, stable IDs, quota atomicity, and recovery using ten synthetic large photo pairs. No physical iPhone was used for those checks.
- Three signed private TLS reads passed: unauthenticated staff access denied, an unknown public report absent, and customer directory access successful. They used no real session and issued no card writes, approvals, or paid requests.
- The 34 canonical checks passed anonymous routes, assets/media, access denials, and delivered motion/map markup. Live motion, capture, map interaction, and real grading were not executed by that probe.
- A subsequent normal Chrome check on the live site confirmed the corrected text/header spacing, uncropped films, matching price/time typography, and integrated timelines. Searching 95678 displayed the actual Google iframe with the CenterCourt pin, address, and interactive controls; contact-only status remained visible. This normal browser visit may bootstrap a customer session and is separate from the strict read-only probes. It performed no card, recovery, grading, submission, or payment action. It does not replace the original-iPhone acceptance check.
- Post-cutover and post-promotion strict preservation both passed. No production grading or upload recovery action was performed as part of these read-only verification probes.

The repository-safe [release summary](../../../../validation/atlas-submission-refinement-20260925/sanitized-release-summary.json) records deployment identities, verification scope, and SHA-256 receipts. Its receipt paths are relative to the private release evidence root `/Users/markthomas/.codex/atlas-handoffs/atlas-submission-refinement-20260925`. Raw photos, photo content hashes, card/customer identifiers, database snapshots, environment inventories, signed URLs, and raw provider responses are excluded from this repository audit.

Key receipts: native full qualification `92be85768fe6de6468293000195b68da71f91fd8a80a66eba29d6aaa2581bcbc`; control preservation `3fcf9b36fb73a27859f5dac4f0e3410ab845acabd48c55fbd4afdbe7141e4c5d`; final strict preservation `06f413c5427008426a41ff066e5d81e2ed8467fb980582e6bc471ca692c2ed85`; signed TLS `1198fe38face77ceeed1594a9bbb33998c12bcec39cdf6e9c0703dc519169fb9`; canonical checks `80c76c7c21a097fc3694f2d8b6d0fe8c7ecd36092688c41c7a33f9187ca4c8a0`.

## Owner acceptance still required

- [ ] On the **same iPhone, browser, and site profile** that hold the saved uploads, reload ATLAS **without clearing site data**. Use **Resume saved uploads** if offered. Confirm the existing cards continue without duplicates or replaced originals.
- [ ] Confirm saved/uploaded totals and actual job states update while Add cards is open. Open the corresponding card or review link.
- [ ] In Needs attention, use **Resume saved processing** for eligible saved analysis-conflict or temporary-storage jobs. Confirm the existing job resumes. Complete edge/identity reviews separately when requested.
- [ ] Confirm recovered originals open and previews have the correct orientation. If an original remains unreadable, retain its saved record and diagnostics; record the failure without claiming that unavailable bytes were recovered.
- [ ] Search Roseville/95678, a nearby ZIP, and use the location button. Confirm the CenterCourt map is interactive, fallback wording is honest, the layout fits, and its contact-only status still prevents operational drop-off selection.

Software release verification is complete. These unchecked items remain the boundary of the physical-device and owner acceptance claim.
