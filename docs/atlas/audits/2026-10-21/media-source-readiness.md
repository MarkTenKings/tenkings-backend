# Detail media source readiness — October 21, 2026

This audit continues the approved marketplace plan from source `5d50a719` (detail/optional-3D implementation `c54e871f`) in the isolated `codex/atlas-marketplace-foundation` worktree. It records source inspection and local qualification, not production activation, a physical holder qualification, or a new image-generation pipeline. The current owner-approved presentation remains pure white (`#fff`) and emerald (`#047857`), the enlarged gallery slab shared with detail, Front initially selected, separate Grade Report navigation, and optional experimental 3D. There is no detail Inspect/zoom control or invented reverse label.

## Actual integration defect and correction

The approved media helper already supported Front, Back, an actual saved slab photograph, and retained label artwork. SQL008 and the gallery supplied all four sources. Before this correction, SQL009 omitted the retained label row and `card-provenance-service.mjs` forwarded neither label evidence nor its already-loaded same-approval presentation to that helper. Real detail therefore lost optional media that the gallery could show. `CardDetail` consumes the provenance response directly, so it could not recover those sources from the gallery.

The actual-component browser fixture returned an already-enriched gallery object for its synthetic provenance response. It qualified UI composition and interaction, but masked this backend projection gap. A passing screenshot or frontend fixture alone was insufficient evidence for source parity.

The correction keeps one media projector:

- SQL009 selects the exact retained `label_item` for the same card, approval and authenticated original actor, only when that actor remains the card owner or an approver, the item is READY with retained artwork, and no newer approval publication exists. Both `created_at` and `updated_at` must be at or before the fixed history snapshot. Creation alone cannot prove that rendering was READY at that time.
- The service forwards that narrow label evidence and the existing `presentationEvidence` to `archiveApprovedMedia`. The presentation creation instant is valid and at or before the same snapshot; the helper verifies the saved digest and card/action/report binding. Sold references and slab media consequently use the same retained presentation revision.
- Missing or invalid optional media is omitted independently. It cannot replace the exact approved Front/Back pair, change an award, or manufacture reverse artwork. A newer approval also suppresses an old label endpoint that the existing label reader would no longer authorize.

The registered, still additive SQL009 checksum for this correction is `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`. Root owns its service, migration, manifest and release integration; this lane owns the focused provenance regressions and this audit.

## What each source establishes

| Surface | Exact source binding | Limit |
| --- | --- | --- |
| Front / Back | Immutable approval report token, approval version, public hash, explicit side and verified inspection bytes | Current inspection contract is 1350 × 1858 WebP. These are approved grading derivatives, not untouched full-resolution originals. |
| Actual slab photo | Hashed saved `atlas_manual.presentation`, same card/action/report binding, exact revision, image digest, byte count, MIME and dimensions | Optional uploaded photograph. It is not generated holder geometry or a promise that every card has a slab photo. |
| Label | Existing READY retained item, same actor/card/action/version/source revision/source hash/report hash/public hash and renderer/material identifiers | `artworkHash` hashes retained **print SVG**. It is not the digest of the different preview SVG. The preview endpoint independently checks actor access and retained print integrity. |
| Front / Back digital holder | The same verified approved photos and saved front label composed by the shared gallery/detail viewer | Illustration. Back has no invented label or NFC detail. An enlarged shell does not add image information. |
| Optional 3D | The same Front/Back photo pixels as unlit textures and exact retained front label; independent decorative NFC source | Exterior proportions use supplied dimensions; interior placement is illustrative. This is not calibrated CAD, a scan, real 360° photography or proof of physical assembly. |

The label workflow reuses artwork derived from the human-approved report. This audit adds no separate label-approval action, label rendering job, print, NFC write or readback. An existing READY record is not a new physical effect.

`APPROVED_MEDIA` already retains original descriptors, pair/side identity, the decoded/selected grading frame, decode plan and prepared inspection descriptor. Those are useful lineage, not an implemented paired-master renderer. The staff route named `images/{side}/original/{hash}` returns `readGradingSource`'s selected `workingFrame`; its name does not establish untouched original pixels. Existing Photoroom presentation PNG sources are also distinct from raw intake originals. Follow the immutable original/decode relationship explicitly for any future full-resolution composition.

## Transport, roles and gateway review

The exact provenance HTTP handler is private and no-store. It accepts GET only, authenticates the existing staff cookie, parses bounded approved query fields, and invokes the read-only service. The signed native transport validates the exact UUID route and raw query before dispatch, rejects unsupported/duplicate query fields and encoded or malformed paths, and binds method/path/query/body/session context into its signed envelope. It does not supply an ownership or write capability.

Native serving composition includes provenance only in the serving role, alongside the graded archive. The variant worker receives neither service nor grant. Serving startup validates SQL009 and the exact execute privilege. SQL009 independently authenticates the current session, browser, release, roster and reviewer and applies live card ACL/discard checks on every page; public projection excludes staff, submission and private media identifiers.

Fresh read-only gateway snapshots were decoded and hashed from `atlas-detail-release-20261021/preflight/{inner,outer}-runtime-gateway-01.private.json`:

| Gateway | Exact current bytes | Provenance handling |
| --- | --- | --- |
| Inner | `51cd257774fb8032f8b10dd25fa42da5ce442a9977abd3a4c58ffd237a16f878` | Existing `@manualRoutes` admits `/api/staff/manual-connected/cards/<id>/provenance` and a raw query, forwarding to native. |
| Outer | `c069ab6a230da62ca8df2632b6d91fefe81288a913a078b59068991b3e05fcb0` | The corresponding existing matcher admits the same route/query and forwards inward. |

Neither matcher names provenance explicitly or restricts its method. The strict signed handler remains the effective GET/query boundary. There is no missing forwarding route to repair. Preserve these exact live configs and prove valid GET plus malformed/unauthorized/method rejections through both boundaries during release qualification. An optional future gateway tightening must also exclude provenance from the generic fallback; adding only a narrower named matcher would not enforce that restriction. `infra/Caddyfile` is not a current replacement for either retained live configuration.

The current CSP supports the source viewer: self-hosted lazy scripts, Blob images and the explicitly configured storage upload origin. Private media grants still require the fixed approved-storage origin and exact approval binding. No broader script, image or connection policy is required for this correction. Source review is not a substitute for the final deployed CSP/route smoke check.

## Qualification and retained evidence

| Check | Observed result |
| --- | --- |
| Focused provenance regressions, Node 22 | 15 passed, no failures/skips; exact gallery helper parity, private-field redaction, 14 retained-label mismatches, corrupt/future/wrong-approval presentation rejection and nonmutation. |
| Root focused service/HTTP/migration checks | 24 passed, no failures/skips; retained `preflight/focused-tests.log`. These overlap the 15 above and are not additive counts. |
| Real owned PostgreSQL | `CARD_PROVENANCE_POSTGRES_PASS`, 10 groups. Real SQL008 archive and SQL009 detail media are exactly equal; original actor plus current owner/approver access is required for the label; reader/editor/other actor and pending-publication cases fail closed. Later-created and later-READY label cases are excluded from earlier snapshots. Slab/comps stay at one snapshot revision. Exact 008→009 upgrade and no-op pass. |
| PostgreSQL cleanup and effects | `stoppedVerified: true`; regenerable owned database files removed; zero production queries, provider calls or ownership writes. Label fixtures are synthetic database rows, with no printer/storage/provider action. |
| Root staff production build | PASS, including boundary audit: 35 browser chunks, 15 server traces, 2,030 traced files, `/admin` base path. Retained `preflight/staff-build-01.log`. |
| Existing detail/media/3D UI evidence | Retained unchanged 80 focused tests, build and browser evidence from `optional-3d-report-return.md`. This lane made no frontend change and did not relabel earlier checks as fresh runs. |
| Changed-file hygiene | Node 22 syntax check for the extended harness and scoped `git diff --check` passed. |

Fresh qualification artifacts are under `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/`, especially `qualification/provenance-pg-01/postgres-result.json`, `qualification/provenance-pg-01/synthetic-card-history.json` and the preflight logs above. Fixture evidence is synthetic and cannot establish ordinary signed-in production acceptance.

## Paired-master readiness and remaining acceptance

The existing source references and viewer are a foundation for deterministic paired masters, not completion of that requirement. A reviewable next implementation still needs:

1. Both original byte sources verified against one physical card/pair and explicit sides, plus qualified full-resolution orientation/color decoding and a recorded relationship to the approved evidence frame. Generated or cleaned historical frames cannot silently donate geometry to originals.
2. Accepted front **and** back holder/card/label/NFC transforms, supported card-format policy and exact template source hashes. Supplied exterior dimensions and front illustrations do not calibrate the reverse or internal fit.
3. A content-addressed pair manifest binding permanent card/certificate, approval/action/version, report/public/source hashes, original pair/side/hash/dimensions, decode/transform/color policy, retained label/artwork/renderer, holder revision/assets, and both output dimensions/digests/status. Record real available resolution; a larger canvas is not additional photographed detail.
4. Bounded rendering and atomic publication only after both sides pass; deterministic retry, stale-input rejection, supersession and access revalidation. Readers across gallery, detail, collection and listings must consume one pair version. No partial pair may appear published.
5. Adversarial swapped-side/card/pair, corrupted/missing source, stale label, invalid transform, partial write, retry and concurrent-publication qualification; one real approved card checked against retained originals/label and visible edges/corners; actual device memory, latency and rendering measurements.

No AI upscaling, reconstructed card boundaries, invented back content, relighting, foil simulation or defect removal is justified by current evidence. Optional 3D remains experimental pending owner visual acceptance and broader device qualification. Release activation and ordinary signed-in detail/history acceptance remain root-owned work, separate from this source audit. The approved continuation order remains detail/media, identity/history release, reviewed ownership and My Collection, bounded comps/pricing, complete R1, R2 fixed-price sales, then R3 offers.
