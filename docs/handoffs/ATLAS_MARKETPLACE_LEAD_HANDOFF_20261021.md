# ATLAS marketplace — successor lead handoff, October 21, 2026

**Current successor execution checkpoint:** see [fresh detail release preparation](../atlas/audits/2026-10-21/detail-release-preparation.md). Detail release source is now `ca3a848d`; ownership/collection local contracts are separately committed in `46621dad`. Production release is still pending connector team access and full coordinated qualification. The following original handoff retains historical starting evidence and is superseded by that checkpoint where status differs.

**Original successor handoff after local 3D and report-return qualification.** This document is self-contained operational context for a new **Astra Ultra lead using Astra xHigh subagents**. It carries all 30 original master-plan requirement IDs, completed work, remaining work, the next execution sequence and a copy/paste kickoff prompt.

The canonical scope ledger is [ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md). This handoff does not narrow it to the archive or claim that all Foundation work is complete.

## 1. Immediate handoff state

The **staff Graded Cards archive is live and its gallery design is owner-approved**. The dedicated detail page, dependable Front/Back media, reviewed Sports identity and read-only grading/custody history are locally implemented and qualified. Ownership/My Collection, bounded comp curation/pricing and the marketplace transaction system remain unfinished.

The latest requests are now **implemented and locally verified**: an optional experimental **3D** tab beside Front/Back and **← Card Detail** on the separate grade report. Front remains the default. The owner has not yet accepted the 3D prototype's appearance or committed to making it the primary presentation.

| Current state | Exact resume evidence |
|---|---|
| Integrated implementation commit | `c54e871f14fad9824ca98726e6b2ca50c99aaa6d` — Add optional Atlas slab 3D preview and report return navigation. A later docs-only handoff commit may be HEAD. |
| Optional 3D | Lazy Three.js0.186.1, beveled reusable geometry, exact native verified Front/Back photos and saved front label, drag/arrow/Home/End/reset, no idle animation. Static fallback survives deferred-import failure, WebGL/context loss, missing photos and unsupported texture size. Reverse label stays blank. Shell/internal geometry is illustrative; physical CAD/device quality is not proved. |
| Report return | Exact token/version/origin-bound same-tab handoff; two-minute single use then30-minute report-history context. Correct-card return and reload verified; fresh direct/cert/NFC entry has no inherited private return. No return query parameter, private referrer or saved-report modification. Modified/new-tab clicks intentionally remain ordinary direct-report visits. |
| Tests/builds | Final80/80 focused staff/media/3D/router tests; public specialist79/79. Staff production build/boundary35chunks/15traces/2030files; public14/14/682. Full receipts and caveats in the latest audit. |
| Final preview | `http://127.0.0.1:58611/admin/graded-cards/3ad38eae-49cd-450c-ab08-10f8b44f386f` — task-owned process session71401. Synthetic records and saved public photo/report copies. IDs regenerate on restart. |
| Browser evidence | Rotation/readable Back,320px nooverflow, deferred3D request, canvas removal onFront/access loss, forcedchunk503 fallback, accessible context-loss retry, exact report roundtrip/reload and direct-entry separation. Saved desktop/report screenshots below. |
| Remaining acceptance | Owner visual review; physical phone/GPU performance; actual reverse artwork/CAD; full raw-resolution paired masters; production detail/identity/history release and real-card Sports acceptance. |
| Production effects | **None in this increment.** Production stays webc4b7cc85/native31c6685e; SQL008installed, SQL009unapplied. No customer messages, paid provider calls, approvals, physical operations or financial effects. |

Final audit: [optional-3d-report-return.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-21/optional-3d-report-return.md).
Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/three-preview-20261021/` — `desktop-3d.png`, `report-return.png`, `mobile-320.png`, `focused-tests.log`, `staff-build.log`, `public-build-result.txt`. Public test/build details are in the specialist tool transcript; do not claim another root rerun.

**Exact stopping point:** code and local integration are complete for this requested prototype/return increment. The current lead is handing off for the owner to review it and for the next lead to continue the whole master plan. Start by reading this handoff and checking source/preview availability; retain passing evidence on unchanged source. Apply any owner visual feedback, then prepare the fresh detail/identity/history release and ownership/My Collection contracts in section7. Keep3D optional and Front as default unless the owner changes that decision. Do not restart the design or interpret this prototype as completed manufacturing-quality media or a live marketplace.

## 2. Workspace and documents

Use this working directory:

```text
/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean
```

Branch: `codex/atlas-marketplace-foundation`. Integrated code commit is `c54e871f14fad9824ca98726e6b2ca50c99aaa6d`; preceding milestones are `6bd11d11` and `3689b44e`. The final handoff documentation may advance HEAD without source changes. Inspect Git before editing.

Do not modify, reset, clean or repair the original dirty/conflicted checkout at `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`. Do not use the frozen `codex/atlas-archive-production` checkout as the development branch. Its archive release-02 operations have already been consumed and are retained evidence, not a release template to replay.

Read the workspace `AGENTS.md`, then these full-path sources. The checked-in AGENTS also requires the V2 blueprint; it is context for preserving Ten Kings, not authority to merge ATLAS marketplace data with Ten Kings:

1. [MASTER_PRODUCT_CONTEXT.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/context/MASTER_PRODUCT_CONTEXT.md).
2. [TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md).
3. [DEPLOY_RUNBOOK.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/runbooks/DEPLOY_RUNBOOK.md).
4. [SET_OPS_RUNBOOK.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/runbooks/SET_OPS_RUNBOOK.md).
5. [HANDOFF_SET_OPS.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/HANDOFF_SET_OPS.md).
6. [SESSION_LOG.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/handoffs/SESSION_LOG.md), including the latest October 21 appendices.
7. The canonical marketplace master plan, this handoff, the audits linked below, and the final optional-3D/report-return audit.

Trust observed code/runtime/database evidence over stale prose and update contradictory documents in the same session. Append a SESSION_LOG entry after every commit-worthy code change. Before any deploy/restart/migration, append the planned action; afterward append the observed result and evidence. Ordinary authorized local development does not need a new general approval question. Destructive data operations still require explicit owner authorization; destructive Set Ops requires a dry-run impact report and typed confirmation.

ATLAS is independently deployed and has its own database. Ten Kings V2's TKD buyback, six-table design and marketplace deferral are not the ATLAS marketplace contract. Preserve both products and their existing customer rights.

## 3. Production evidence — what is actually live

These are the latest recorded release identities, not a fresh network observation by this document author. Reconcile them read-only before any new production action.

| Surface | Recorded live state |
|---|---|
| Canonical archive | [atlasgrading.com/admin/graded-cards](https://atlasgrading.com/admin/graded-cards) |
| Staff web source | `c4b7cc85f01754eb5776042147e6c0fdf50f845a` |
| Staff deployment | `dpl_AmUUXzXbNpHPB6ZSrcpCZ4VqjGbX`; `atlas-grading-staff-chbqd5o92-ten-kings.vercel.app` |
| Public source/deployment | Same `c4b7cc85`; `dpl_CeohHmXm57UeSmktNQAP7JGioN1h`; `atlas-grading-public-75b283s70-ten-kings.vercel.app` |
| Native source | `31c6685e8ae49e05c8f78b748a6233d143776131` |
| Native image | `sha256:f64dfc31485603df756ec9cd64976fda8cc5effe8b0155fa727a45fb82b4fa52` |
| Native main | `4137c69637f07ebed4c70463ae81d0d7030dd3859b54d3b294e3cd399f4d05a2` |
| Native worker | `bb4840ec80850dce8a22eba59bc9e5ae56538696ffb31e6adbd4e97c3e178f80` |
| Customer retained | Source `c68e9ea7c77b35fc53cab6ee162e063dfb02b0fe`; `dpl_2aW7K6CTUftYNKaWanBouvgUaDS5` |
| Schema | Registered additive SQL008 installed with manual-only EXECUTE. **SQL009 is source-only and not installed.** |
| Release controls | Staff 136 / PublicReader 97 / STAFF SMS 104. Customer 83 / CUSTOMER SMS 35 retained. |
| Inner gateway SHA256 | `51cd257774fb8032f8b10dd25fa42da5ce442a9977abd3a4c58ffd237a16f878` |
| Outer gateway SHA256 | `c069ab6a230da62ca8df2632b6d91fefe81288a913a078b59068991b3e05fcb0` |
| Admission holder | Explicitly released `2026-10-21T06:42:09.621Z`; absence independently proved at `06:42:37.838Z`. No hold remains from this release. |

The native-only worker correction excludes human archive services from the restricted worker; it does not broaden worker grants. Web and native source differences are intentional and independently qualified.

The live archive has gallery/table, complete authorized search, category/UTC approval-date filters, snapshot pagination, immutable approved identity/grade/certificate, staff and recorded submission context, exact report versions and recorded order links. It creates no ownership, listing, offer, balance or sale. The live **Open card** still uses the manual grading workflow until the local detail increment is released.

The owner supplied signed-in production screenshots showing four real approved cards and approved the gallery. Search/filter/table/paging, exact order navigation and complete report/media flow acceptance remain outstanding. An early screenshot showed two unavailable images and later all four loaded. The historical HTTP cause is unproven; do not invent a diagnosis.

Production qualification includes 232/232 corrected native Linux tests, 768/768 release staff tests, exact canonical asset/auth checks, four retained reports and eight photo byte hashes. Preservation retained business rows, 31 READY market results and saved labels. Native health showed zero application restarts. No grading approval, paid search, print, NFC operation, notification or financial transaction was used to test the archive.

Release evidence root:

```text
/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/release-02/
```

The [production audit](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-20/graded-cards-archive-production.md) records all exact receipts and reconciliation exceptions. Useful anchors:

- Canonical technical acceptance: `3fbcbc75b03081dccfb6203c84ab45e3b5607ceda8dac5c677e142f942d814c7`.
- Reports/photos: `972479245ae23ecc89685c226850a10c3953de60b299f3bdf3b9b9b6ad7a796a`.
- Final preservation: `ec377487a88c27827ab2c70e88d63c565987bd98e8e6c31298c1e66bf5b81789`.
- Native health: `228d4a6da58b21dc693358717cca9373127336ed366645eeabfd07dbf9fdbef9`.
- Holder absence: `6e2dda46e9012d8a9222f3d5491e857add29f22d6f7b10378d1cd0b520a5cc7e`.

Private evidence files may contain private metadata or credentials; reference their paths/hashes without publishing their contents. Never copy signed URLs into the handoff.

## 4. Delivered milestones and local evidence

Checked items below mean the stated bounded milestone was actually completed; **LIVE** and **LOCAL VERIFIED** are different claims.

- [x] **LIVE:** Searchable staff archive, gallery/table, additive008, exact source/report/media access and restricted-worker-compatible native release.
- [x] **OWNER ACCEPTED:** Signed-in production gallery visibility and gallery visual design.
- [x] **LOCAL VERIFIED — `3689b44e`:** Dedicated detail route and archive navigation, saved category facts/grade policy, reviewed Sports facts, saved same-approval sold references, submission/staff context and read-only History.
- [x] **LOCAL VERIFIED — `3689b44e`:** Exact approved Front/Back transport with token/version/publicHash and byte verification, two-load concurrency, bounded transient retries, side-local recovery and access/account/unmount/pagehide cleanup.
- [x] **LOCAL VERIFIED:** Optional reviewed serial/autograph/relic facts, ATLAS identification v5 proposals, original-photo human evidence checks, historical v3/v4 request compatibility and conservative expanded comp matching.
- [x] **LOCAL VERIFIED:** Source-only SQL009 and staff provenance endpoint with session/role/card ACL/discard checks, fixed microsecond snapshot, same-approval selected sales and no ownership/custody invention.
- [x] **LOCAL VERIFIED — `6bd11d11`:** Larger shared gallery/detail slab presentation; Front/Back retained; hero Approved Card/Human Approved and detail Inspect/zoom removed; portrait Grade Report link; honest missing reverse label.
- [x] **OWNER DIRECTION RECORDED:** Listed cards use price + Buy Now; every ATLAS graded card defaults Open to offers, with owner opt-out per card/collection and independent privacy/ownership/delivery requirements.
- [x] **LOCAL VERIFIED — `c54e871f`:** Optional3D tab and safe report ← Card Detail return, including deferred-import/context-loss recovery, accessible retry, exact saved textures and independent direct reports.
- [ ] **NOT COMPLETE:** Production detail/identity/history release and ordinary signed-in acceptance; real Sports recognition acceptance; full-resolution paired slab masters; ownership/My Collection; bounded curation/pricing; marketplace backend.

The [October 21 detail audit](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-21/card-detail-integration.md) records the initial detail milestone: 811 staff tests passed; 48 final focused tests passed after the dependency correction; 902 connected tests passed with two existing native-measurement environment skips; eight owned PostgreSQL 17 groups passed and cleanup confirmed `stoppedVerified:true`; staff production build/boundary passed with 32 browser chunks, 15 server traces and 2,016 traced files. The full staff run preceded the final dependency/CSS adjustments; focused tests/build/browser supplied the later evidence. Existing unrelated build warnings remain.

The later cleanup in SESSION_LOG supersedes that audit's Inspect/zoom description and 58608 preview. Cleanup passed **51/51 focused tests**, a Node 22 production build and boundary, actual Front→Back→Front, absent inspection control, Grade Report navigation, browser-back recovery and 320px without overflow. The final3D/report-return increment has its own80-test/build/browser qualification above; do not conflate the historical counts.

Cleanup evidence:

```text
/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/detail-cleanup-20261021/
/tmp/atlas-card-detail-cleanup-20261021/focused-tests.log
/tmp/atlas-card-detail-cleanup-20261021/build.log
```

Previous qualified cleanup preview:

```text
http://127.0.0.1:58609/admin/graded-cards/95ef2d5a-0d49-425f-bd8f-30fa1e444516
Owned process session at that checkpoint: 37672
```

The fixture uses actual components with synthetic card/staff/certificate/submission/history and two explicitly synthetic sale records. Its eight exact 1350×1858 already-public approved photographs were copied read-only and hash/byte-count verified; its matching labels are deterministically rendered from synthetic certificate data. It is not production inventory or a real authenticated staff session. Fixture IDs change on restart. No signed URLs are persisted.

Approved reference directory:

```text
/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/detail-preview-20261021/approved-references/
```

Other local audit sources:

- [Reviewed Sports identity](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-20/reviewed-sports-identity.md): exact serial versus checklist number, per-window relic facts, machine/human evidence separation, historical request hashes and remaining optical acceptance.
- [Card provenance foundation](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-20/card-provenance-foundation.md): staff read contract, ownership UNKNOWN, holder UNKNOWN, redaction and SQL009.
- [Earlier next-R1 qualification](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-20/next-r1-integration-qualification.md): historical checkpoint, superseded by October 21 results where noted.

Historical SQL009 checksum at the earlier detail checkpoint: `9e9361a6cfe6b057a306a347741d88911d4d9f654f3c01b71aefcbd95f74bc2f`. The successor source-only media parity correction is `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`, with24 focused checks,10 owned PostgreSQL17 groups and the staff production build passing. Final release must use the new manifest checksum. Merely checking in SQL009 does not install it.

Fresh read-only observations at21:10–21:12UTC confirm native31c/f64dfc with zero main/worker restarts, unchanged gateway hashes, SQL008 installed and009 absent, and155 manual cards/28 published approvals. The earlier four-card screenshot is historical owner evidence. Vercel deployment inspection returned a team-authorization denial; the owner completed renewal and the same connector now verifies staff/public READY plus all three Ten Kings project identities. No deployment, runtime replacement, holder acquisition or production migration has occurred. Actual source review found missing saved-label/slab inputs in the detail backend; the successor fix and real SQL parity tests supersede the enriched fixture's earlier parity assumption.

## 5. Owner decisions to preserve

### Visual design and media

Use **pure white `#ffffff`**, including hovered media areas, and restrained **emerald `#047857`** rather than neon. Card text, price and action align with the actual slab edges. Preserve generous space, black navigation, accessible controls and responsive layout.

The detail shows a **large version of the same ATLAS graded slab used in the gallery**. Front and Back remain available. Keep the separate standalone Grade Report with detailed inspection/findings. Remove detail Inspect/zoom and redundant Approved Card/Human Approved hero labels. The Grade Report action is a restrained portrait-document shape. Staff approval context belongs below the hero.

Prefer a real recorded slab photograph when one exists; otherwise use the exact saved approved photograph and exact saved label in the explicitly illustrative shell. The currently available Back does **not** include an actual saved reverse label/NFC asset. Do not invent that artwork or unseen card surfaces. The experimental 3D view must remain optional, use the exact available textures, retain sharp static fallback and disclose illustrative geometry where relevant.

The current 1350×1858 approved photographs are not raw intake masters. Remaining image work is a versioned paired pipeline from untouched full-resolution Front/Back originals and exact approved label/report revision to presentation masters and purpose-sized derivatives. Preserve original orientation/frame/source and defects. The manifest must bind physical card, approval/report, each side's image/hash/dimensions, label artwork/profile/hash, shell/template version, output dimensions and generation state. Changed sources create a new version, never mixed approvals. Physical manufacturing/CAD calibration and real device visual quality remain unproved by an illustrative shell or 3D prototype.

### Permanent identity, provenance and privacy

Reuse `atlas_manual.public_report_identity` for the permanent certificate/token across report versions. Do not mint a competing identifier. Regrade/reholder needs an explicit association and retained prior versions.

Staff ACL/workspace ownership, submission customer, recorded custodian and legal/current owner are distinct. QR/certificate/NFC knowledge grants no ownership. The current history projection intentionally reports ownership and current physical holder as UNKNOWN. A recorded handoff proves that event, not continuing present possession.

Public/customer provenance must distinguish verified, owner-reported and unknown records and honor consent; use a consenting handle or Private collector. Staff-only names, observations and contact fields must not leak through a public redaction helper. The existing redaction helper is not a public endpoint or consent mechanism.

### Commerce and offers

Listed cards lead with **asking price + Buy Now**. Unlisted cards lead with **Open to offers + Make Offer** when a real offer can be delivered.

**All ATLAS graded cards default Open to offers.** This explicitly supersedes an earlier proposed owner-opt-in default. Owners may disable offers per card or collection. Retain explicit opt-out across regrade/reholder/new report versions. The preference does not publish private cards, verify ownership, identify a recipient, authorize SMS or itself implement an offer engine. Until ownership/eligibility/delivery exists, do not show a functioning action that cannot work.

The proposed workflow is expiring buyer offer → authenticated owner's in-app alert and preference-controlled email → My Collection / Offers / exact card → Accept, Decline or Counter. Acceptance reserves checkout; it is not payment, completed sale or title transfer. Do not mutate from an email GET. Recheck owner, custody and eligibility and prevent competing sale/offer acceptance of one physical card. Email/in-app routing, preferences, expiry and payment integration remain work. Login-code SMS consent/campaign is not consent for marketplace messages; SMS needs its own setup and consent.

The owner also proposed commerce access from the standalone report when a card is for sale. Carry forward a **state-aware host header with View Listing / Make Offer**, backed by an actual authorized public card/listing projection, current visibility and offer eligibility. Do not hardcode sale/offer state into immutable report content or show an actionable CTA without the corresponding service. The current increment implements only the Card Detail return; report commerce remains planned.

Release order remains **R1 Foundation → R2 ATLAS-held fixed-price pilot → R3 offers/dealers/direct shipping/social/approved balance spending**, unless Mark explicitly reorders it. The owner-approved default offer policy does not silently move a complete offer engine into R1/R2. ATLAS Balance is real USD backed by provider/internal-ledger evidence, separate from Ten Kings TKD. The proposed 8% fee is a business proposal; no launched fee contract, provider approval, insurance claim or operational promise is established.

## 6. Full 30-item master-plan checklist

The original **30 bullets are reproduced in full below**, with stable 01–30 IDs and their original wording. Source: `/Users/markthomas/.codex/attachments/86a293c9-b284-4be5-958d-3c2d2f692c71/Pasted text.txt`. Later owner amendments in section 5 control where wording changed, including emerald instead of neon green and zoom in the separate grade report. The canonical ledger covers every original requirement; no original item is dropped. Parent boxes remain unchecked whenever the complete requirement is unfinished. Checked subitems record actual completed portions and are labeled LIVE or LOCAL VERIFIED; they must not be mistaken for full release or real-world acceptance.

- [ ] **01.** **One permanent card record:** Connect each card’s identity, certification, grading reports, photographs, ownership history, custody, listings, and sales. Preserve continuity through regrading and reholdering.
  - [x] **LIVE:** Permanent certificate/public-report identity already carries approved versions; local provenance reuses it.
  - [ ] Reviewed ownership/custody lifecycle, listing/sale links and explicit regrade/reholder continuity remain.

- [ ] **02.** **Staff “Graded Cards” tab:** View every graded card in a premium visual gallery or efficient table. Search by name, cert number, date, grader, approver, customer, submission order, marketplace order, dealer, and mail/drop-off origin.
  - [x] **LIVE:** Gallery/table, server-wide authorized archive search, category/UTC date filters and snapshot paging.
  - [x] **OWNER ACCEPTED:** Signed-in production gallery and its design.
  - [ ] Complete real search/filter/table/paging/destination acceptance; marketplace-order search waits for actual marketplace records.

- [ ] **03.** **Detailed card pages:** Open front/back images, zoomable grading evidence, grade reports, sold comps, provenance, and marketplace information. Add genuine video/360° media where available.
  - [x] **LOCAL VERIFIED:** Dedicated detail, shared slab Front/Back, separate exact Grade Report, category facts, saved comps and History. Owner's later direction moves zoom/findings to the separate report.
  - [x] **LOCAL VERIFIED:** Optional illustrative3D tab and safe exact Card Detail return from the separate report; front/back remain available.
  - [ ] Production detail release, owner3D acceptance/device quality, true paired full-resolution masters, genuine video/360 capture if available, and actual commerce context remain. An illustrative prototype does not satisfy genuine capture.

- [ ] **04.** **Staff administration:** Include saved filters, exports, review queues, custody locations, fulfillment status, disputes, and audit history. Staff get the customer-facing experience plus controls appropriate to their role.
  - [x] **LIVE:** Existing staff review/order tools and archive permissions reused; private fields stay behind staff access.
  - [ ] Saved filters, exports and remaining custody/fulfillment/dispute/audit administration remain.

- [ ] **05.** **Public marketplace:** Search and filter available cards by player, set, year, grade, price, numbered edition, autograph, relic, and other relevant attributes. Clearly distinguish cards for sale from collection displays.
  - [ ] Public listing catalogue, all required filters and clear available-versus-collection states remain.

- [ ] **06.** **Social “My Collection”:** Give customers searchable profiles, albums, follows, watchlists, saved searches, and alerts. Separate currently owned, previously owned, for-sale, and wanted cards. Allow visibility controls per card or album.
  - [x] **LIVE:** Existing My ATLAS submission/report history is retained. This is not ownership-based My Collection.
  - [ ] Current/past ownership, for-sale/wanted distinctions, authenticated collection, privacy per card/album and opt-in profiles/social/searches/alerts remain.

- [ ] **07.** **Customer-visible provenance:** Show recorded ownership transfers, sales, grading, reholders, and corrections. Distinguish verified events, owner-reported information, and unknown history. Display consenting owner handles or “Private collector.”
  - [x] **LOCAL VERIFIED:** Staff read-only sourced grading/custody events and safe public-fact redaction helper.
  - [ ] Reviewed ownership/transfer/sale/reholder/correction events, consent and customer/public endpoint integration remain. The redaction helper alone is not publication.

- [ ] **08.** **Ownership and custody:** Track who owns the card separately from who physically holds it. Support authenticated off-platform transfers and reviewed ownership claims. A cert number or QR scan alone cannot establish ownership.
  - [x] **LOCAL VERIFIED:** Separate ownership UNKNOWN and current-holder UNKNOWN; recorded custody is independently sourced.
  - [ ] Authenticated off-platform transfers, reviewed claim authority, separate append-only custody/ownership writes and explicit dispute/correction handling remain.

- [ ] **09.** **Numbered field:** Preserve the exact printed serial, such as `007/099`, plus its supporting image. Search comps using `/99`, not the individual copy number. Keep serial numbering separate from checklist numbers.
  - [x] **LOCAL VERIFIED:** Exact printed serial, numerator/denominator, original-photo human evidence and normalized denominator query.
  - [ ] Production release and fresh real-card serial/photo/comp acceptance remain.

- [ ] **10.** **Autographed field:** Record signature presence and type—on-card, sticker, cut, facsimile, or unknown. Search using `auto`. Keep signature detection separate from authentication.
  - [x] **LOCAL VERIFIED:** Reviewed signature presence/type, evidence checks and comp terms; no authentication inference.
  - [ ] Production release and fresh real-card autograph/type/unknown acceptance remain.

- [ ] **11.** **Patch/relic field:** Record material, individual relic windows, and manufacturer statements about game use, player wear, event wear, or unspecified origin. Preserve distinctions between different pieces on the same card.
  - [x] **LOCAL VERIFIED:** Separate window/material/manufacturer-statement/use facts and conservative matching.
  - [ ] Production release and fresh multi-window/manufacturer-statement acceptance remain.

- [ ] **12.** **AI-assisted identity review:** Google Vision OCR and Astra propose attributes from both sides; staff confirm or correct uncertain facts. Retain supporting evidence. “Not detected” stays unknown rather than automatically becoming “No.”
  - [x] **LOCAL VERIFIED:** ATLAS v5 machine proposals with actual derivative binding; adoption clears machine observations and requires fresh human original-photo evidence; historical v3/v4 requests retained.
  - [ ] Fresh authorized real paired-photo/provider evidence, reviewer acceptance and deployed optical performance remain; synthetic tests are not recognition accuracy.

- [ ] **13.** **Optional staff comp selection:** After the grade is finalized, staff select **1–5 recent, correctly matched sold comps**, or choose Skip/No suitable comps. Missing comps never block an approved report.
  - [x] **LIVE / LOCAL VERIFIED:** Existing saved sold-search/selection foundation retained; detail reads only saved same-approval references.
  - [ ] Enforce and accept the optional post-grade 1–5 bound, recent matching evidence, Skip and No suitable comps without gating approval.

- [ ] **14.** **Reliable pricing guidance:** Match printing, serial denominator, autograph, and relic details. Separate grading companies, grades, and special designations. Exclude mismatches, lots, and unknown accepted-offer amounts from calculations.
  - [x] **LIVE:** Shared identity query and separated grader/grade grouping retained.
  - [x] **LOCAL VERIFIED:** Denominator/autograph/relic contradiction and uncertainty checks; lots and unknown accepted-offer amounts cannot drive new guidance.
  - [ ] Release expanded matching, validate real returned evidence and integrate the bounded price-guidance eligibility contract.

- [ ] **15.** **Transparent suggested prices:** Show the selected sales, dates, sample size, range, and suggested starting price. Refresh stale guidance when listing while preserving the report’s original snapshot. Sellers control their asking price.
  - [ ] Explainable versioned suggested starting price, dates/count/range/method and deliberate stale-listing refresh remain. Preserve report snapshots and seller control.

- [ ] **16.** **Nearly one-click listing:** Reuse approved identity, media, report, and provenance. Once account and ownership checks are complete, the seller chooses a price, sees fees/net proceeds, and presses the **neon-green “List for sale” button**.
  - [ ] Listing/account/verified-owner eligibility, price/fee/net review and durable listing action remain. Later owner direction replaces the original neon-green wording with restrained emerald #047857.

- [ ] **17.** **Simple buying:** Show the exact card, report, seller, fulfillment route, delivery estimate, protection terms, and full checkout cost. Prevent simultaneous purchases of the same card.
  - [ ] Server-authoritative full totals, actual seller/route/ETA/protection, reservation, concurrency, idempotent payment and compensation/reconciliation remain.

- [ ] **18.** **Sell immediately after grading:** Before return shipment, offer **“Ship to me” or “Hold and list.”** This avoids an unnecessary receive–repack–reship cycle.
  - [ ] Actual consent and custody-bound Ship to me / Hold and list workflow before return shipment remains.

- [ ] **19.** **Proposed marketplace fee:** Test **8% including ordinary domestic card processing**. No listing fee, buyer premium, or percentage penalty for standard withdrawal. Disclose shipping, verification services, and optional instant payouts separately. Validate low-value bundles and declining fees for expensive cards.
  - [ ] Validate the proposed 8% economics, actual provider pricing and low/high-value tiers; document separate shipping/verification/instant-payout costs before offering terms.

- [ ] **20.** **Fulfillment options:** Start with cards already held by ATLAS. Expand to approved dealer-held inventory and qualified sellers shipping directly. Route higher-risk transactions through ATLAS verification with costs and timing disclosed.
  - [ ] ATLAS-held pilot first; approved dealer/direct expansion and higher-risk verification routing require actual contracts and operational evidence.

- [ ] **21.** **Buyer and seller protection:** Compare card/holder evidence, maintain intake and packing records, and use tracked parcels with appropriate coverage. Missing delivery scans trigger a time-bound investigation. Inspect disputed returns and preserve an appeal process.
  - [ ] Protection terms, intake/packing/holder evidence, tracked coverage, investigation deadlines, inspected returns and appeals remain.

- [ ] **22.** **Reusable shipping kits:** Use fitted slab inserts, a second sealing strip, replacement tamper seals, a clean label area, and clear resale instructions. Offer replacement kits when needed.
  - [ ] Physical packaging prototype, reusable insert/seals/instructions and material/shipping validation remain.

- [ ] **23.** **ATLAS Balance:** Display real USD proceeds as **Pending, Available, Reserved, Withdrawal processing, and Paid out**. Support verified bank withdrawals and eligible instant payouts, with clear fees and timing.
  - [ ] Real USD ledger/provider reconciliation, all five visible states, verified bank withdrawals and qualified instant payouts remain. Do not use Ten Kings TKD or display invented balances.

- [ ] **24.** **Spending from balance:** Pursue provider approval for customers to buy cards using earnings. Launch earnings and withdrawals first if necessary. Keep customer funds within the approved payment arrangement and reconcile every balance; avoid unsupported bank or insurance claims.
  - [ ] Provider-approved proceeds spending and end-to-end reconciliation remain; earnings/withdrawals may launch first.

- [ ] **25.** **Visual direction:** Large authentic photographs, clear typography, restrained motion, fast browsing, accessible controls, and excellent mobile usability.
  - [x] **OWNER ACCEPTED / LIVE:** Gallery direction.
  - [x] **LOCAL VERIFIED:** Pure-white shared slab detail, restrained emerald, responsive desktop/390px/320px and accessible controls; optional3D/report-return source, failure recovery and browser qualification completed; physical-device performance remains separate.
  - [ ] Carry the accepted system into unreleased collection/marketplace flows and qualify genuine device/media quality and performance; illustrative geometry is not physical CAD.

- [ ] **26.** **Release 1 — Foundation:** Staff archive, expanded identity, permanent records, provenance, My Collection, and dependable comp curation.
  - [x] **LIVE:** Archive increment.
  - [x] **LOCAL VERIFIED:** Reviewed identity and read-only detail/history increments.
  - [ ] Permanent continuity, public/customer provenance, ownership/My Collection, dependable curation, paired media/release gaps and combined R1 acceptance remain.

- [ ] **27.** **Release 2 — Marketplace pilot:** ATLAS-held cards, fixed-price listings, checkout, fulfillment, protection workflows, balances, and withdrawals.
  - [ ] Complete the connected ATLAS-held fixed-price transaction, fulfillment, protection, balance and withdrawal journey with real operational acceptance.

- [ ] **28.** **Release 3 — Expansion:** Dealer fulfillment, qualified direct shipping, offers, expanded social features, and approved spending from balance.
  - [x] **OWNER DIRECTION RECORDED:** All graded cards default Open to offers with per-card/collection opt-out; product policy is not an implemented offer engine.
  - [ ] Offer engine and negotiation/notifications, dealers/direct fulfillment, expanded social and approved balance spending remain R3 unless Mark explicitly reorders them.

- [ ] **29.** **Before launch:** Finalize ownership/consignment rules, transfer and payout timing, returns, privacy defaults, comp-data rights, shipping/insurance costs, and payment-provider responsibilities.
  - [ ] Establish ownership/consignment authority, transfer/payout timing, return/privacy terms, comp-data rights, shipping/coverage economics and provider responsibilities before pilot. Independent foundation development continues.

- [ ] **30.** **Measure success:** Listing speed, conversion, repeat purchases, staff handling time, comp accuracy, disputes, payout reliability, and actual profit contribution per sale.
  - [ ] Instrument real listing, checkout, repeat-purchase, handling, comp-accuracy, dispute, payout and contribution-profit events by release; synthetic fixture activity never enters customer metrics.

## 7. Recommended next execution order and three-agent boundaries

### First: finish and freeze the current detail increment

Read the final integration evidence, inspect the exact committed source and review the owner's latest feedback before changing it. Check both sides, optional 3D loading/fallback/access cleanup, exact report version, correct-card return and ordinary direct report/NFC behavior. Inspect desktop and 390px/320px. Confirm gallery/detail use the same source-bound slab and the gallery's accepted alignment remains intact. Historical audit supersession and the master plan were updated in this handoff. Preserve the current optional3D/standalone-report direction.

If the final root evidence already establishes these checks on unchanged source, retain it; do not repeat all suites without a concrete reason.

### Then: release the completed detail/identity/history increment

Prepare a fresh release from the reconciled final source. The likely release includes staff/native changes, source-only SQL009 and the exact new history/detail route transport. The new report-return host code changes the public app as well as staff detail; include that actual public scope in fresh qualification. Customer-app publication is not implied. Verify current native composition still excludes staff-only reads from the worker.

Qualify SQL008→009 with registered checksum/manifest, no-op second application, least privilege, rollback compatibility and current ACL/session/discard checks. Validate both gateway layers' exact method/path/raw-query allowlists and browser CSP. Build and test exact candidates, record a fresh plan before effects, perform the already-authorized release within its concrete scope, then obtain ordinary signed-in archive/detail interaction evidence. No general permission loop is needed to prepare or verify this work.

The release is complete only when current serving source, canonical route/assets, saved reports/photos, data/control preservation, native health and holder release/absence are evidenced. Keep local implementation, technical publication, authenticated acceptance and real operational acceptance separate.

### In parallel: prepare the next ownership/My Collection foundation

Use **one Astra Ultra lead and at most three Astra xHigh specialists**, reusing slots. The current tool capacity is four concurrent agents including the lead. Assign explicit file ownership before writes. The lead owns shared integration files, dependency/lockfile coordination, master plan, SESSION_LOG, commits, build/browser integration and every release effect.

| Specialist | Initial responsibility | Boundaries / handoff |
|---|---|---|
| A — detail/media | Finish/review optional 3D, static fallback and report return; define paired-master manifest and honest missing-source behavior; then improve media only where actual source evidence exists. | Own agreed detail/media components and their tests. No identity/history SQL, ownership writes, shared release scripts, production effects or synthetic replacement pixels. Coordinate any public report file with the lead. |
| B — records/ownership | Verify current SQL009/identity/privacy behavior; design and implement the smallest append-only reviewed ownership/claim/transfer contract and separate custody projection. Preserve permanent certificate/regrade continuity and explicit unknowns. | Own agreed native record/service/schema files and disposable-DB tests. No frontend redesign, provider dispatch, production migration, inferred ownership backfill, payment or release-control writes. Hand over exact migration/ACL/compatibility evidence. |
| C — collection/curation | Build customer My Collection/private visibility against B's explicit contract, then complete optional 1–5 sold comp curation and explainable versioned guidance. Retain owner asking-price control and report immutability. | Own agreed customer adapters/components and pure curation contracts/tests. No duplicate ownership writer, invented sales/prices, live notification/payment effects or shared-contract changes without lead coordination. Initially use synthetic fixtures until the real API exists. |

At least one specialist should independently review another lane's privacy/source binding or transaction contract before the lead declares it integrated. Models are explicit: `gpt-6-astra` with `reasoning_effort: "xhigh"` for subagents. Where the collaboration API requires model overrides with `fork_turns: "none"`, give each agent the complete task context, exact directory, required reads, owner decisions and file boundaries. Do not create extra sidebar chats merely to delegate.

After release and genuine reviewed identity acceptance, complete ownership/transfer authority and My Collection; finish paired media and curation/pricing; verify the entire R1 journey. Then build the ATLAS-held R2 fixed-price pilot: approved seller/consignment → listing → reservation/checkout → actual fulfillment/protection → reconciled proceeds/withdrawal. R3 adds offers, approved dealers/direct shipping, social and provider-approved spending from proceeds. Operational/provider decisions can be researched in parallel and must be established before enabling their real effects.

## 8. Qualification requirements and practical entry points

Use Node 22 for ATLAS. The root package's older Node engine field does not supersede the ATLAS app/runtime requirement. Use installed dependencies and the qualified local tooling; do not run root database push/deploy shortcuts against an unknown target.

Local command entry points, run from the foundation worktree after checking the final scripts:

```sh
node --version
git status --short
git diff --check
pnpm --filter @atlas/staff-app test
pnpm --filter @atlas/staff-app build
pnpm --filter @atlas/connected-manual test
```

Meaningful focused coverage includes source/version/hash mismatches; retries that preserve the healthy side; account/session/card-access loss; stale async replies; snapshot-bound history pages and selected sales; unknown accepted-offer amount; proposal/human original-photo distinction; exact private/public redaction; direct report use and safe correct-card return. Later transaction work needs concurrency, idempotent payment/webhook replay, reservation expiry, refund/reconciliation, owner/visibility changes and notification recipient rechecks.

Database qualification uses the owned disposable PostgreSQL 17 script:

```text
/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/packages/atlas-connected-manual/scripts/validate-card-provenance-postgres.mjs
```

Read its current CLI and require an owned disposable cluster, 008→009 and repeat no-op, revocation/least-privilege checks and verified cluster shutdown. Source-only migration tests are not production migration evidence.

The actual-component fixture is:

```text
/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/frontend/atlas-app/scripts/graded-cards-browser.mjs
```

It requires `ATLAS_ARCHIVE_APPROVED_REFERENCES` set to the external approved-references directory, accepts `ATLAS_ARCHIVE_FIXTURE_PORT`, and uses optional `ATLAS_ARCHIVE_REPORT_CONTENT` for the local saved-report roundtrip. Without that report-content file it retains the earlier public-source redirect. Node22 used by the lead is `/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node`. The references path is `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/detail-preview-20261021/approved-references`; report content is `three-preview-20261021/public-report-content.json` under the same evidence root. Current final port58611. Local fixture controls include forced lazy-chunk failure, WebGL context loss and access revocation; these never target production. It prints the actual origin and regenerated card IDs. Use an available loopback port and stop/restart only the task-owned process when needed; preserve other previews. Its fake records and deterministic DEMO labels remain visibly synthetic. Do not start it against a production database or import its records.

Primary source map, all below the foundation worktree:

- `frontend/atlas-app/components/GradedCards.jsx`: archive gallery/table and primary detail navigation.
- `frontend/atlas-app/components/CardHistory.jsx` and `CardHistory.module.css`: dedicated detail and Overview / Grade report / Sold comps / History UI.
- `frontend/atlas-app/components/ApprovedCardMedia.jsx` and `ApprovedCardMedia.module.css`: shared media/slab presentation, lazy import and optional-view failure boundary.
- `frontend/atlas-app/components/Slab3D.jsx`, `.module.css` and `frontend/atlas-app/lib/slab-3d-scene.mjs`: optional3D geometry, textures, interaction, rendering and cleanup.
- `packages/atlas-site-router/report-entry.mjs`: exact browser-only report-entry/return context.
- `frontend/atlas-public/components/ReportEntryNavigation.jsx`, `.module.css` and `frontend/atlas-public/pages/reports/[token].jsx`: separate report host navigation, outside immutable report evidence.
- `frontend/atlas-app/lib/approved-card-media.mjs`: byte-verified image transport and cleanup.
- `frontend/atlas-app/lib/card-history-client.mjs`: detail/history parsing, safe exact-version links and pagination.
- `frontend/atlas-app/pages/graded-cards/[cardId].jsx`: dedicated staff route.
- `packages/atlas-connected-manual/src/card-provenance-{contract,http,service}.mjs`: staff contract/transport/read projection.
- `packages/atlas-standalone-database/sql/009-card-provenance.sql` and `migrations.manifest.json`: unapplied additive provenance read.
- `packages/atlas-grading-core/src/sports-attributes.ts` and `packages/atlas-connected-manual/src/identification-sports-attributes.mjs`: reviewed Sports fact and machine-proposal contracts.

Full browser checks must cover actual components and real routes, desktop/phone, keyboard behavior, pure-white hover/background, no overflow, loading/missing media, and account/access changes. A fixture opening an already-public report proves navigation and saved bytes, not live native history grants. Real-photo recognition quality, physical slab/manufacturing fit, printing, tag readback/locking and real customer transactions require their own actual evidence.

## 9. Release pitfalls to carry forward

- SQL009/history/Sports changes are excluded from the consumed archive release-02. Do not mistake foundation HEAD for deployed source or replay release-02 to publish it.
- The original c4b7 native image missed restricted-worker startup. Retain the 31c composition fix and test actual main/worker startup roles; passing source tests alone did not expose it.
- The first SQL008 attempt stopped before DDL due to node-pg timestamp serialization. The successful separate attempt used exact database timestamp text. Preserve microseconds and source/manifest/ledger checks in future tooling.
- The outer gateway reload succeeded once before a Mounts-array-order postcheck failed. Read-only comparison established identical full mount records and live config; no repeat reload was performed. Reconcile ambiguous outcomes before any retry.
- Docker timestamps have nine fractional digits; system Python 3.9 parsing lost compatibility. The successful file-only validator preserved full precision using Decimal. Do not weaken timestamp comparisons.
- All earlier effect intents are single-use and consumed. Fresh recovery must use observed current state, monotonic controls, additive008/009-compatible readers and a successor image. Never restart the retired generation.
- Existing approved reports, photographs, labels, serials, grades and provider receipts remain immutable. Do not reapprove/regrade, rerun paid searches, relabel, print, write tags or send customer messages merely to exercise read paths.
- Old “current” dated headings are historical where superseded by the archive release or later session entries. In particular, public eafcec14/native3256 checkpoints precede current web c4b7/native31c.
- No general ATLAS marketplace ownership/transfer, listing/offer/checkout/settlement/withdrawal system is completed. Existing grading-submission commerce or dealer-offer modules are not proof of the marketplace contract.

## 10. Copy/paste prompt for the new Astra Ultra lead

```text
You are the new Astra Ultra lead for the complete ATLAS card archive, collection and marketplace master plan. Use gpt-6-astra with ultra reasoning as lead and up to three gpt-6-astra xhigh subagents with explicit file ownership and independent cross-review. Continue execution in this chat; do not create extra sidebar chats.

Work in:
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean
Branch: codex/atlas-marketplace-foundation

Read AGENTS.md and all its mandatory documents first, including the full Ten Kings V2 blueprint for preservation boundaries. Then read:
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/handoffs/ATLAS_MARKETPLACE_LEAD_HANDOFF_20261021.md
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-20/graded-cards-archive-production.md
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-21/card-detail-integration.md
 /Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-21/optional-3d-report-return.md
and the handoff's identity/provenance audits and latest SESSION_LOG entries.

Inspect actual Git status and HEAD before editing. Implementation commit is c54e871f; the handoff-only successor commit may be HEAD. Do not touch the original dirty/conflicted checkout at /Users/markthomas/tenkings/ten-kings-mystery-packs-clean. Do not replay the frozen archive release-02 packet.

Current recorded production is web c4b7cc85, native31c6685e/f64dfc image, registered SQL008; customer retained c68e9ea7. The release holder is explicitly released. Dedicated detail, reliable approved media, Sports identity and staff history were locally implemented in 3689b44e and refined in 6bd11d11; SQL009 remains unapplied. Optional experimental3D beside Front/Back and safe "← Card Detail" return on the separate grade report are locally completed in c54e871f with80focusedtests,79publictests, both production builds and browser recovery/roundtrip checks. Owner3D acceptance and production release remain outstanding; Front remains the default. Do not describe local source or a preview as production.

Preserve pure white #ffffff, restrained emerald #047857, gallery card text/actions aligned to slab edges, the larger SAME source-bound ATLAS slab on detail, Front/Back, no detail Inspect/zoom, no Approved Card/Human Approved hero labels, and the portrait Grade Report link. Keep the standalone report and exact report versions/NFC URLs. A missing reverse label is missing. Current1350×1858 approved photos are not full-resolution raw masters; illustrative 3D is not calibrated physical geometry or complete paired-master output.

All ATLAS graded cards DEFAULT Open to offers; owners may disable per card/collection. Do not revert to opt-in. Privacy, verified ownership, actual recipient delivery and transaction eligibility remain independent. Listed cards use price+Buy Now; unlisted eligible cards use Open to offers+Make Offer. Email/in-app Accept/Decline/Counter workflow is planned; no email-GET mutation or SMS without separate setup/consent. Carry forward the proposed state-aware report host header View Listing / Make Offer only once an actual public card/listing projection exists; do not hardcode marketplace state into the saved report. This increment only adds the Card Detail return. R2 is the ATLAS-held fixed-price pilot; the offer engine remains R3 unless I explicitly reorder it.

First inspect the final local preview at http://127.0.0.1:58611/admin/graded-cards/3ad38eae-49cd-450c-ab08-10f8b44f386f and my latest feedback. The source already passed the desktop/320px detail→Front/Back/3D→Grade Report→Card Detail checks; retain that evidence on unchanged source rather than repeating everything. Keep the optional3D prototype separate from a decision to make it primary. Resolve any actual remaining integration issue. Then prepare and qualify the fresh detail/identity/history release, including SQL009, native roles, both gateways and exact source preservation; use existing authorization and concrete runbook evidence rather than stopping for a general permission question.

In parallel assign three xHigh lanes: (1) detail/media and paired-master/source binding, (2) record/ownership/claim/transfer/custody contracts and owned disposable-DB qualification, (3) customer My Collection/privacy followed by bounded1–5 comp curation and explainable pricing. You own shared integration, package/lockfile coordination, docs, commits, browser/build qualification and every release effect. Do not infer legal ownership from staff ACL, submission, custody or NFC.

Continue the approved order: dedicated detail and reliable media → reviewed identity/history and production/real-card acceptance → ownership/My Collection → optional comp curation/pricing → complete R1 journey → R2 listings/checkout/fulfillment/protection/real USD balances/withdrawals → R3 offers, dealer/direct shipping, social and provider-approved balance spending. Keep all30 master-plan requirements visible with honest checked completed subitems and unchecked unfinished requirements.

Use Node22, relevant tests, owned disposable PostgreSQL17, actual-component desktop/mobile checks and fresh release evidence. Preserve real approved reports/photos/labels, grading math, final-human-approval authority, historical provider bytes and Ten Kings independence. No synthetic sale/owner/balance/activity or invented physical result. Do not issue paid searches, notifications, money movement, printing or tag writes merely to test read features. Destructive operations require their explicit owner authorization and Set Ops dry-run+typed confirmation.

Append SESSION_LOG after each commit-worthy code change and before/after any deployment/restart/migration. Reconcile stale docs against evidence in the same session. Report implemented, locally verified, deployed, owner-accepted and real-world operationally accepted separately. Carry the whole plan forward without dropping remaining work.
```

