# ATLAS rapid capture and customer submission release — September 24, 2026

## Delivered experience

Staff intake and customer submission share a persistent full-screen camera: Front, Back, immediately the next Front. Each side is durably saved on the device before advancing; uploads and identification run separately. A large card guide, maximum available native still capture and full native-frame PNG fallback preserve image data without cropping or downscaling. Partial Front and queued pairs survive refresh. Staff ordered bulk import previews and reorders pairs; filename matching is optional.

The customer account now uses a moving decorative slab wall, scrim and slab-shaped GRADE YOUR CARDS action. The four-step wizard presents service comparison, photo capture, name/address, then review and available checkout. It never requires a card name/category before capture. Two generated photoreal service clips depict kiosk deposit and FedEx handoff. Both are silent 1080p, 24fps, 5.04-second containers from five-second Runway jobs; 400 credits were used without a purchase. The clips illustrate a service, not a verified operating location.

The customer intake/identification service is enabled. Commerce, dealer operations and the physical station remain disabled. An uploaded draft can be saved without pretending a payment or submission order exists. Existing SMS destination restrictions still apply to approved accounts.

## Exact deployed identities

Application source for all three web deployments: `4d3de84419242bfa245dbd652a8c28d812e2ea6b`.

| Component | Deployment |
| --- | --- |
| Staff | `dpl_7nVEg9HaCAbLtvgP8yep98xm7iKG` / `atlas-grading-staff-frrx74ah9-ten-kings.vercel.app` |
| Customer | `dpl_9s2et59CgUET9aRs42PdzbRND4Zt` / `atlas-grading-customer-kh9z6goex-ten-kings.vercel.app` |
| Public router | `dpl_EXR4NcZo1uKxS3ULmvwp8SRm7EMV` / `atlas-grading-public-9vhvxzfyk-ten-kings.vercel.app` |

The private service retains qualified native code `7b42f51c418b815f838bb910cf7599a0dcd5313c` and image `sha256:fefc50f83e2e15ce1685c138f0ca69a618931e3972e9e8924a4b219b625b340e`. Its new web-source binding is `4d3de844…`; the private code is not described as rebuilt from that frontend commit. Actual container `f06442b1dc5ce61f4e207a61e135c2e2f2b8a474a635aa65e7caed6403656065` started 17:13:55 UTC with no OOM or restart. The prior container was stopped gracefully and retained. The service rebind preserved Caddy and all unrelated containers. A subsequently discovered missing customer ingress matcher was fixed by the separate scoped gateway correction documented below.

## Qualification and preservation

- All three production builds and source boundaries passed. The release verified 1,038 build-source files and 38 supplementary staff test files against immutable source.
- Staff 643/643 tests; customer 48/48 and public 29/29. Shared/staff capture tests 20/20. Customer browser fixtures cover the actual disabled-commerce 200 DTO, UNKNOWN payment recovery and paid receipt precedence.
- Actual Chrome synthetic capture continued through ten pairs with server work deliberately stalled. Reload, partial Front, quota and multi-tab preservation checks passed. These prove no network-completion barrier; they do not prove optical quality or human ten-cards-per-minute performance on a real phone.
- Packaged additive migrations 49–52 were applied once. All 48 predecessor staff entries and 112 public ledger entries were preserved. The new private customer role passed exact least-privilege verification.
- Exactly six control changes were applied atomically: Staff 28, STAFF SMS 26, PublicReader 6, Customer 8, CUSTOMER SMS 6 and the new customer service control. Service/intake/identification are enabled; commerce/dealer/station remain disabled.
- Independent actual post-cutover readback passed for all 30 grading history tables, all 19 non-control customer tables, catalog, roles, memberships, ACLs, private privileges and staff/SMS authority. No auth traffic differences were observed at 17:18:18 UTC. The independent final post-promotion check repeated this result at 17:31:07 UTC, with all 19 customer table fingerprints unchanged and zero verification writes or provider effects.
- Provider environment changes were exactly four customer additions, one replacement of the new service-key row, and two public upstream origin updates. Existing account credentials were preserved.

## Credential diagnostic incident

Before any customer deployment or activation, a release diagnostic printed a newly created, unused transport credential into its tool output. Activation was held, a separate 32-byte random replacement was generated, and only the new Vercel service-key row plus the proposed private configuration were changed. Existing account credentials and the new role password were not changed. Secret checks now use fixed-message boolean assertions. The actual replacement signed request succeeded with HTTP 200 and the original key was rejected with HTTP 401 after the ingress correction. This closes the exposed-key replacement check; canonical deployed-key verification is recorded below.

## Live verification

The first private probe passed the actual restricted database role, TLS and READ ONLY transaction checks, then stopped on HTTP 404 for the new private endpoints. Raw bounded checks showed both old-key and replacement-key requests received the same empty 404; this did not admit the old key. The actual Caddy private host lacked the new routes. Original failed evidence is retained. The correction adds exact POST matchers for seven customer operations and the Stripe webhook, anchored raw URIs without queries, 128 KiB / 256 KiB body limits and the existing service upstream. It preserves existing routes and unrelated virtual hosts.

The gateway correction completed at 17:27:37 UTC with one graceful reload, preserved inode 282983, and Caddyfile SHA `d972ea0220849403cb81d9a2cfd30442d4ff7f9d7f18345a6e3694e5525dac6f`. The actual active configuration exactly matched the validated candidate, and all container lifecycle states were unchanged. Receipt SHA `b42770c42a47af44ab900d4afc3221fd2ed7965e3c0a61bffb74002e6944c0c8`.

The unchanged private probe then passed: actual restricted role/TLS/READ ONLY transaction; old key 401; replacement signed directory 200 with zero locations; signed intake sign/complete with impossible session 401 before storage; unsigned 401; Stripe 503 COMMERCE_NOT_CONFIGURED. Customer history, unrelated state and controls remained unchanged, with no observed worker pause. No real customer session, object upload, identification job, payment, shipping or SMS action was performed. Receipt SHA `8f17d844c3b523e4ba89dd5a0e45fe0dd1f41696da2c5c9ab90247948e8a037b`. Separate actual TLS scope checks passed 45/45 for exact operation admission and method/URI refusal.

Public promotion completed with one POST: production target and all four aliases select `dpl_EXR4NcZo1uKxS3ULmvwp8SRm7EMV`. Other projects, settings and environment metadata were preserved. Promotion receipt SHA `9f33217f5a4f700423835b8f1a00a43a9e6537db3d22b84e406a40dee1460e88`. Final canonical raw GET verification passed 27/27: customer/account/submit and staff shells, private caching, media/camera policy, new customer bundle markers, exact hashes for both posters and both videos, protected anonymous API denials and valid unknown public report/image 404. The deployed customer directory returned 200 with zero locations, proving the actual Vercel replacement key reached the private gateway. The verification did not bootstrap a browser/session or execute live customer JavaScript.

Two additional signed private reads passed with authenticated TLS 1.3: signed staff GET with no customer/staff session reached the authorization layer and returned 401 SIGN_IN_REQUIRED; the new public binding's signed unknown report returned an empty 404. Both had no-store/nosniff. Receipt SHA `3e42a29704a12744b6b2e8831ba628bf54e42de34d2402933d6054556021c764`.

The deployment is ready for the approved owner's real-phone capture and identification test at [the account](https://atlasgrading.com/account), [the submission wizard](https://atlasgrading.com/account/submit) and [staff intake](https://atlasgrading.com/admin/batch?tab=INTAKE). Refresh and sign in again after the binding change. This is not live payment/shipping or physical station acceptance.

## Remaining business and physical acceptance

Real Stripe merchant/tax settings, FedEx account and shipping settings, receipt sender, and actual kiosk locations/schedules are absent. Existing templates and a no-network checker are in [the configuration guide](../../../../packages/atlas-commerce/CONFIGURATION.md). No provider credentials, operating locations, shipment or payment were invented. The mail-in turnaround start and charged shipping legs await the owner's decision. Kiosk terms remain $50/card including collection/return, seven days from ATLAS collection, $5 dealer commission excluding tax/shipping; mail-in remains $40/card plus actual FedEx, two weeks.

Real phone optical/throughput acceptance, real payment/shipping/receipt acceptance, signed station distribution and actual printer/NFC/assembly hardware acceptance remain separate. Hardware design is owned by the separate ATLAS automation task. The website release does not certify physical production readiness or unrestricted public signup.

## Operational handoff

Retained protected evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-rapid-capture-20260924`; host activation root `/opt/atlas/rapid-capture-cd08cfdb1c50`. That root records the original activation source `cd08cfdb…` and subsequent explicit web-source `4d3de844…`; do not replay migration/provision/rebind/promotion actions under another source name. All completed mutation intents are consumed. Future actions require fresh actual evidence and a scoped plan; old containers must not be automatically restarted against new controls.

Safe selected receipts and their manifest are in [the release evidence](../../../../validation/atlas-rapid-capture-release-20260924/README.md). No secret files, private environment dumps or full sensitive snapshots belong in Git. The final documentation commit does not alter deployed application source.
