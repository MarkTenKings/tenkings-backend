# ATLAS submission design and logo release — 2026-09-25

**LIVE; software release verification passed. The owner's upload/Resume report remains a separate active investigation.** Public promotion passed at **05:30:35 UTC**, strict preservation passed at **05:30:51.353738 UTC**, and all **37 canonical production checks** passed at **05:31:05 UTC** on September 25, 2026. This release refines submission presentation and adopts the supplied logo; it does not establish a cause or fix for the owner's reported invisible uploads and Resume no-op.

The application source is `47dffea96b4731395a336b796918d7ca73b41ac0`. The qualified private image is `sha256:f4985716a277a9d9c9277f73a815c0c13709031cd38ff7cea189b72b6fec2c3c`, with 899-file source manifest `20c9c7908f377db15fa66c731198fbddc228988a1ad027f27238afe45863f3a0`.

## Deployed identities and preservation

| Surface | READY deployment | Immutable hostname |
| --- | --- | --- |
| Staff | `dpl_D8qmKC4h37TJSgjaJM7B7JzfugxY` | `atlas-grading-staff-ig3uqh713-ten-kings.vercel.app` |
| Customer | `dpl_7qVPqTtv19UuHw7ra6CxFnW68Yrh` | `atlas-grading-customer-9u6rvsbtq-ten-kings.vercel.app` |
| Public | `dpl_95BZufjt5u6MV3s3wMp8s9GfPhfV` | `atlas-grading-public-fkt2kh6nf-ten-kings.vercel.app` |

All three READY receipts bind the same frozen source. Public promotion made one provider write and verified all four aliases against the new public deployment. The canonical site is `atlasgrading.com`; `www.atlasgrading.com` retains its redirect. The public router binds to the exact staff/customer origins above.

The serving private container is `92ab04be4dcc3ea9636c9725c78db6b611ca87738505edfabe3b9c4f40e09d3b`, started at `2026-09-25T05:28:15.640893775Z`, with zero restarts/OOM in the release readback. Immediate predecessor `9a21d430649a60d7bb16205f07085d9c157df222d0f481791571500bd50435da`, source `e4a75df58d0f8c54423b845f1e5e4ffc4d8995bb` and image `sha256:65f6d935c5147788ccc64e6faa1f406cbfb127c255b7beaa8ac6b159a1de036f`, is retained stopped and disconnected. Caddy, container isolation/networks and unrelated services were preserved.

Protected configuration is `/opt/atlas/design-iteration-20260925/private.env`, SHA-256 `22b6ed6e02e7346a0ffc13992ef583b5f3beee60a71a5afd25a65800f8aeec92`. Derivation changed exactly `ATLAS_MANUAL_WEB_DEPLOYMENT`, `ATLAS_MANUAL_WEB_RELEASE_SHA` and `ATLAS_CUSTOMER_SERVICE_BINDING_JSON`; existing credentials, endpoints and feature settings remained intact. Offline constructors opened and closed two clients with network disabled and zero database/provider calls or worker starts.

The atomic control transaction updated exactly six existing rows: Staff 31→32, STAFF SMS 29→30, PublicReader 9→10, Customer 11→12, CUSTOMER SMS 9→10 and the customer-service binding. Strict post-promotion preservation accounted for all **30 grading-history tables and 21 customer tables**, permitting only those binding changes. Staff schema **52** and public ledger **112**, unrelated controls, policies, grants, privileges and historical rows were preserved. Customer intake/identification remain enabled; commerce, dealer operations and physical station operations remain disabled.

Completed staging/build/qualification, deployment, control, cutover and promotion intents are consumed and retained. Future actions require fresh evidence and a newly scoped plan; this audit is not an instruction to replay an intent or restart a retained predecessor.

## Delivered design scope

- Submission comparison uses short branching gold flashes with dark intervals, forward silver gusts, compact 67-pixel timelines and synchronized 5.333-second cycles. Decorative brown parcels open to reveal miniature slabs carrying the supplied logo. Pause, hidden-page and reduced-motion behavior remain supported.
- Dealer presentation uses a taller map, mobile layouts and the supplied logo in a separate dealer identity block. Existing directory IDs, explicit map activation, device-location handling and operational-station selection gates remain unchanged. Device coordinates are not forwarded to Google by this component; its embed uses the selected directory entry.
- The exact supplied 1098×984 PNG, SHA-256 `4b40262a23bb01decf504dfe740626924d252dd097f44a916f9d52457d3c6e56`, appears on current website brand surfaces and new `atlas-signature-v3` label plans. Historical v1/v2 artwork, PDF/profile hashes and explicit replay remain preserved. A fresh hosted finishing load derives the current v3 default from the immutable publication; saved historical plans retain their versioned rendering. Qualification does not establish an actual printed label, NFC write or finished slab.

CenterCourt remains a contact-only directory entry pending setup. The signed private directory check returned zero operational locations; contact-only entries cannot be selected as working drop-off stations. The ATLAS identity block is not a custom Google marker. **Google custom pins and inline Places photos remain pending the owner's Maps JavaScript/Places configuration.** No unsupported store photo or simulated customer activity was added.

The substantive main-homepage redesign remains [a proposal for owner review](../../plans/ATLAS_HOMEPAGE_DESIGN_PROPOSAL_20260925.md). Main-homepage implementation in this release is limited to the supplied logo. The proposal recommends real approved-report exploration and a permissioned curated gallery; gallery, likes, comments and collector offers were not implemented or activated. No actual report approval or customer marketing permission is inferred from that proposal.

## Verification and limits

| Evidence | Observed result | Scope |
| --- | --- | --- |
| Local production builds | Three passed | Staff, customer and public, with boundary checks. |
| Frontend tests | 730/730 passed | Existing source suite. |
| Local finishing/station tests | 93/93 passed | Versioned label/PDF and station coverage. |
| Actual native image | 99/99 passed; no failures, cancellations or skips | 16 focused finishing/station/hosted integration files, including historical v1/v2 hashes and v3. |
| Signed private TLS reads | 3/3 passed | Staff denial without a session, unknown public report absent, current customer directory read. |
| Canonical production checks | 37/37 passed | Anonymous raw GET shells, static assets/media, access denials and delivered logo/motion/map markup. |
| Strict post-promotion preservation | Passed at 05:30:51.353738 UTC | Only the six authorized control changes; 30 grading histories and 21 customer tables accounted for. |

The candidate image used a source overlay on the preceding qualified image. All 16 inherited native artifacts were preserved without native compilation; all 899 source files and native artifacts were verified before/after qualification. The 99-test run used no network, production credentials or host mounts, with a read-only root and zero DB/storage/model effects. It is **not** a rerun of the predecessor's 585-test suite or three exact-original-photo replays. Those remain dated evidence in the [03:17 UTC release audit](submission-capture-release.md).

The local web build seal records verification of existing build artifacts against the frozen source and the release owner's chronology. It does not claim that a pre-build source manifest existed. Local synthetic browser/layout and exact-logo proofs covered 320/390/820/1440 pixels; they do not replace a physical-iPhone acceptance test. The local map harness intercepted the iframe, so it does not establish live Google map interaction.

Candidate-only preview checks were held by Vercel deployment protection without an available bypass token. Protection was left untouched and those checks remain **unperformed**, as recorded in their sidecar evidence. The later canonical checks establish production delivery and access boundaries; they are not described as a successful candidate preview.

A normal production browser check after sealed preservation recorded `LIVE_VISUAL_BROWSER_PASS` at **05:32:07 UTC** for 390/1440 pixels: supplied logos loaded with contained proportions, no horizontal overflow, 67-pixel timelines, synchronized 5.333-second cycles, a pause control and no page errors. It made two normal anonymous session reads returning 200, classified as browser bootstrap after strict preservation; session/rate-bucket effects are separate from the preceding read-only preservation claim. It performed no authenticated action, capture, grading, approval or Google map interaction.

The focused follow-up recorded `LIVE_MEDIA_SETTLED_PASS` at **05:33:46 UTC**: both real submission videos loaded at 1920×1080, reached readyState 4 and positive playback time, then paused, with no media/page errors. The release owner inspected the settled 1440-pixel screenshot and confirmed both scenes rendered. Initial black video panels were screenshots taken before decoding, not evidence of a persistent defect. This visit also occurred after sealed strict preservation and included ordinary anonymous bootstrap; it did not establish physical-iPhone recovery or live Google map interaction.

## Evidence custody

The [sanitized release summary](../../../../validation/atlas-design-iteration-20260925/sanitized-release-summary.json) records deployment identities, verification scopes and receipt hashes. Receipt paths below are relative to private evidence root `/Users/markthomas/.codex/atlas-handoffs/atlas-design-iteration-20260925`. Raw originals, private customer/card/report identifiers, database snapshots, protected environment inventories, signed URLs and raw provider payloads remain outside the repository.

| Receipt | SHA-256 |
| --- | --- |
| `native-build/native-qualification.json` | `119e1529eaf50b26f3d22c541196641704ec64240fc1b36d158ae92a9d54efb9` |
| `runtime/host-readback/derive-result.json` | `7b38076712644736849ac69aac55914c51d492d808ea76081f3ef5af5307f082` |
| `runtime/host-readback/constructor-result.json` | `556436bca6505d620a4080369a64d3fa2d119c6216690090e046018facb8ec52` |
| `runtime/host-readback/cutover-result.json` | `0015a13c6029104c7a097fef4c2f3a5c15f9146a3d50a96c91516e2d77d35c58` |
| `web-release/public-promotion-47dffea9/result.json` | `bafb571eacff83df565aaf37972cbc83f1fee93451681b8bfab664772f6dd6ef` |
| `runtime/host-readback/post-promotion-result.json` | `6d22ae00852d02285ab2d9c3437c38e112ae11ea899d7633eb31f938e5e31a91` |
| `readonly-customer/signed-private-design-1/result.json` | `746edcb2ea589be97293377d99dd44eb7db190e64c8cc06cc207c241013a460a` |
| `readonly-customer/canonical-design-1/result.json` | `25524cb6be2b4dedd575e9f880c2dbb5ed5ccbe14a721e6a4b9dc64017b83906` |
| `readonly-customer/live-visual-1/result.json` | `51d7246a55425b84c6e29c0fcf0aa59fad5a1372636fdf43528ee23044377fb4` |
| `readonly-customer/live-media-1/result.json` | `63974d66fe29d290225fe684b9aa829af64022f601f8d01b106598a935e96b43` |

## Separate investigation and acceptance

The owner reports uploads not appearing and Resume doing nothing. A fresh Astra Ultra specialist is investigating; no final root cause, universal failure stage or remediation is asserted here. This design release changes no capture pipeline or grading rule and does not claim to resolve that report. Preserve original photographs, saved card/upload/action identities and evidence while the investigation proceeds.

Original-iPhone recovery/resume, actual completed grading with required edge/identity review, genuine physical finishing and real commerce/provider acceptance remain separate. An uploaded pair is not a completed grade. Actual worker concurrency remains **two**; **50** is a server batch-request limit. Historical queue findings are not the current owner's test status. Ten Kings Inventory and Set Ops behavior are unchanged.
