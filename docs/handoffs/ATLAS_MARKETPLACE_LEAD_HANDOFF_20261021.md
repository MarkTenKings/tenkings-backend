# ATLAS marketplace — successor lead handoff, October 21, 2026

**Current checkpoint: technical detail/identity/history production release complete.** See [production release](../atlas/audits/2026-10-21/detail-production-release.md). Native/staff/public source `ca3a848d` and SQL009 are live; canonical technical/report/photo/preservation checks passed, and the original admission holder was explicitly released with absence proof. Ordinary signed-in real-card acceptance is pending normal staff sign-in. Ownership/collection/curation source `46621dad` remains local and unregistered.

This document carries all 30 original requirement IDs for an Astra Ultra lead with up to three Astra xHigh specialists. Earlier local qualification remains evidence; it is not a claim of owner or physical acceptance.

The canonical scope ledger is [ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md). This handoff does not narrow it to the archive or claim that all Foundation work is complete.

## 1. Immediate handoff state

The **staff Graded Cards archive is live and its gallery design is owner-approved**. The dedicated detail page, dependable Front/Back media, reviewed Sports identity and read-only grading/custody history are technically deployed and qualified. Ownership/My Collection, bounded comp curation/pricing and the marketplace transaction system remain unfinished.

The latest requests are now **implemented, locally verified and technically deployed**: an optional experimental **3D** tab beside Front/Back and **← Card Detail** on the separate grade report. Front remains the default. The owner has not yet accepted the 3D prototype's appearance or committed to making it the primary presentation.

| Current state | Exact resume evidence |
|---|---|
| Integrated implementation commit | `ca3a848d4d6eb28f149a8f253115df90b5fc60ac` is frozen deployed detail source; `46621dad` separately adds local ownership/collection/curation. Later docs-only commits may be HEAD. |
| Optional 3D | Lazy Three.js0.186.1, beveled reusable geometry, exact native verified Front/Back photos and saved front label, drag/arrow/Home/End/reset, no idle animation. Static fallback survives deferred-import failure, WebGL/context loss, missing photos and unsupported texture size. Reverse label stays blank. Shell/internal geometry is illustrative; physical CAD/device quality is not proved. |
| Report return | Exact token/version/origin-bound same-tab handoff; two-minute single use then30-minute report-history context. Correct-card return and reload verified; fresh direct/cert/NFC entry has no inherited private return. No return query parameter, private referrer or saved-report modification. Modified/new-tab clicks intentionally remain ordinary direct-report visits. |
| Tests/builds | Final80/80 focused staff/media/3D/router tests; public specialist79/79. Staff production build/boundary35chunks/15traces/2030files; public14/14/682. Full receipts and caveats in the latest audit. |
| Final preview | `http://127.0.0.1:58611/admin/graded-cards/3ad38eae-49cd-450c-ab08-10f8b44f386f` — task-owned process session71401. Synthetic records and saved public photo/report copies. IDs regenerate on restart. |
| Browser evidence | Rotation/readable Back,320px nooverflow, deferred3D request, canvas removal onFront/access loss, forcedchunk503 fallback, accessible context-loss retry, exact report roundtrip/reload and direct-entry separation. Saved desktop/report screenshots below. |
| Remaining acceptance | Owner visual review; physical phone/GPU performance; actual reverse artwork/CAD; full raw-resolution paired masters; signed-in production detail/identity/history and real-card Sports acceptance. |
| Production effects | **Technical release complete:** native/staff/publicca3a848d, SQL009 installed, controls137/98/105, holder explicitly released and absence proved. No customer messages, paid provider calls, approvals, physical operations or financial effects. |

Final audit: [optional-3d-report-return.md](/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean/docs/atlas/audits/2026-10-21/optional-3d-report-return.md).
Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/three-preview-20261021/` — `desktop-3d.png`, `report-return.png`, `mobile-320.png`, `focused-tests.log`, `staff-build.log`, `public-build-result.txt`. Public test/build details are in the specialist tool transcript; do not claim another root rerun.

**Exact continuation point:** canonical technical release is complete. Owner Chrome tab2132133231 at `https://atlasgrading.com/admin` awaits normal staff sign-in; no sign-in SMS was requested by the agent. Complete real archive/detail/media/history/report-return interaction checks, retaining unchanged local failure/recovery evidence. Keep Front default and 3D optional. Then continue ownership/My Collection and optional curation integration; do not replay any consumed release packet. No claim of manufacturing-quality media or live marketplace.

## 2. Workspace and documents

Use this working directory:

```text
/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean
```

Branch: `codex/atlas-marketplace-foundation`. Deployed code commit is `ca3a848d4d6eb28f149a8f253115df90b5fc60ac`; local ownership/collection/curation is `46621dad`. Earlier UI milestones are `c54e871f`, `6bd11d11` and `3689b44e`. The final handoff documentation may advance HEAD without source changes. Inspect Git before editing.

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

Observed October21 technical release, not an inference from foundation HEAD. Reconcile current evidence before any later production action.

| Surface | Observed live state |
|---|---|
| Canonical archive | [atlasgrading.com/admin/graded-cards](https://atlasgrading.com/admin/graded-cards) |
| Native/staff/public source | `ca3a848d4d6eb28f149a8f253115df90b5fc60ac` |
| Staff | `dpl_2vc2nkyRmUhPMyJaZBLKbaCpow6y`; `atlas-grading-staff-2g0z630sk-ten-kings.vercel.app` |
| Public | `dpl_EaydzmhwF8f49aqgHhw4JAQLKyVJ`; `atlas-grading-public-icw592c3b-ten-kings.vercel.app` |
| Native image | `sha256:62db2a56541dcaf6dd51211302e7d4c53d569af693880ff7519c3672d3318b33` |
| Main / worker | `467201614c92774c023a804b860b30588c34fc23b85cd2d55048bc75b3c2f30d` / `d4ce4e9b1cc3bfb0730e49a3aa0dc759b2270878f502cf7bd8d2100d442f71bb` |
| Customer retained | Sourcec68e9ea7; `dpl_2aW7K6CTUftYNKaWanBouvgUaDS5` |
| Schema | Registered002–009;009 checksum `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`, manual-role-only EXECUTE |
| Controls | Staff137 / Public98 / STAFF SMS105; Customer83 / CUSTOMER SMS35 retained |
| Inner gateway | `51cd257774fb8032f8b10dd25fa42da5ce442a9977abd3a4c58ffd237a16f878` |
| Outer gateway | `c069ab6a230da62ca8df2632b6d91fefe81288a913a078b59068991b3e05fcb0` |
| Admission | Explicit release22:38:21.199Z; absence22:38:27.851Z, October21UTC. No release hold remains. |

The restricted worker excludes human archive/provenance services without expanded grants. Gateways, project environments/settings and customer deployment were retained. The old pair stays stopped/detached; never restart it. Root recorded approximately11m54s native interruption, dynamic-IP accounting reconciliation through a new one-use continuation, and staff alias propagation finalized read-only. No consumed operation was replayed.

Fresh native qualification passed240/240 isolated Linux tests. Canonical technical acceptance passed27routes/assets/auth-boundary checks plus4reports/8original photo hashes. Final37-table preservation retained31READY provider results and26saved label commitments. The earlier four-card owner screenshot establishes gallery approval only; held baseline now recorded155manual cards/28published approvals. No paid search, approval, print, NFC, notification or money movement was used to test read features.

Current evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/`. Exact receipt ledger and limits: [detail production audit](../atlas/audits/2026-10-21/detail-production-release.md). Technical acceptance `09ea2e4d…`, reports `42a88dab…`, final preservation `3b994f25…`, native postflight `bc113baa…`, absence `141dfe58…`. The older archive release-02 remains historical evidence only. Do not publish private receipt bodies or signed URLs.

## 4. Delivered milestones and local evidence

Checked items below mean the stated bounded milestone was actually completed; **LIVE** and **LOCAL VERIFIED** are different claims.

- [x] **LIVE:** Searchable staff archive, gallery/table, additive008, exact source/report/media access and restricted-worker-compatible native release.
- [x] **OWNER ACCEPTED:** Signed-in production gallery visibility and gallery visual design.
- [x] **LOCAL VERIFIED — `3689b44e`:** Dedicated detail route and archive navigation, saved category facts/grade policy, reviewed Sports facts, saved same-approval sold references, submission/staff context and read-only History.
- [x] **LOCAL VERIFIED — `3689b44e`:** Exact approved Front/Back transport with token/version/publicHash and byte verification, two-load concurrency, bounded transient retries, side-local recovery and access/account/unmount/pagehide cleanup.
- [x] **LOCAL VERIFIED:** Optional reviewed serial/autograph/relic facts, ATLAS identification v5 proposals, original-photo human evidence checks, historical v3/v4 request compatibility and conservative expanded comp matching.
- [x] **TECHNICALLY DEPLOYED:** Installed SQL009 and staff provenance endpoint with session/role/card ACL/discard checks, fixed microsecond snapshot, same-approval selected sales and no ownership/custody invention.
- [x] **LOCAL VERIFIED — `6bd11d11`:** Larger shared gallery/detail slab presentation; Front/Back retained; hero Approved Card/Human Approved and detail Inspect/zoom removed; portrait Grade Report link; honest missing reverse label.
- [x] **OWNER DIRECTION RECORDED:** Listed cards use price + Buy Now; every ATLAS graded card defaults Open to offers, with owner opt-out per card/collection and independent privacy/ownership/delivery requirements.
- [x] **LOCAL VERIFIED — `c54e871f`:** Optional3D tab and safe report ← Card Detail return, including deferred-import/context-loss recovery, accessible retry, exact saved textures and independent direct reports.
- [ ] **NOT COMPLETE:** Ordinary signed-in detail/identity/history acceptance; real Sports recognition acceptance; full-resolution paired slab masters; ownership/My Collection; bounded curation/pricing; marketplace backend.

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

Historical SQL009 checksum at the earlier detail checkpoint: `9e9361a6cfe6b057a306a347741d88911d4d9f654f3c01b71aefcbd95f74bc2f`. The installed successor media parity correction is `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`, with24 focused checks,10 owned PostgreSQL17 groups and the staff production build passing. Production installation and exact definition/owner/ACL preservation are now recorded in the release audit.

Historical21:10–21:12UTC preflight found native31c/f64dfc, SQL008 installed and SQL009 absent and155manual cards/28published approvals. The completed technical release supersedes those runtime/schema identities. Vercel team access was renewed through the same connector. Actual source review found missing saved-label/slab inputs in detail; the deployed parity correction and real SQL tests supersede the earlier enriched-fixture assumption.

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
  - [x] **TECHNICALLY DEPLOYED:** Dedicated detail, shared slab Front/Back, separate exact Grade Report, category facts, saved comps and History. Owner's later direction moves zoom/findings to the separate report.
  - [x] **TECHNICALLY DEPLOYED:** Optional illustrative3D tab and safe exact Card Detail return from the separate report; front/back remain available.
  - [ ] Signed-in real-card detail acceptance, owner3D acceptance/device quality, true paired full-resolution masters, genuine video/360 capture if available, and actual commerce context remain. An illustrative prototype does not satisfy genuine capture.

- [ ] **04.** **Staff administration:** Include saved filters, exports, review queues, custody locations, fulfillment status, disputes, and audit history. Staff get the customer-facing experience plus controls appropriate to their role.
  - [x] **LIVE:** Existing staff review/order tools and archive permissions reused; private fields stay behind staff access.
  - [ ] Saved filters, exports and remaining custody/fulfillment/dispute/audit administration remain.

- [ ] **05.** **Public marketplace:** Search and filter available cards by player, set, year, grade, price, numbered edition, autograph, relic, and other relevant attributes. Clearly distinguish cards for sale from collection displays.
  - [ ] Public listing catalogue, all required filters and clear available-versus-collection states remain.

- [ ] **06.** **Social “My Collection”:** Give customers searchable profiles, albums, follows, watchlists, saved searches, and alerts. Separate currently owned, previously owned, for-sale, and wanted cards. Allow visibility controls per card or album.
  - [x] **LIVE:** Existing My ATLAS submission/report history is retained. This is not ownership-based My Collection.
  - [x] **LOCAL VERIFIED:** Owner-only collection projection and privacy/offer preview in46621dad; unsaved settings and no live route.
  - [ ] Current/past ownership, for-sale/wanted distinctions, authenticated collection, privacy per card/album and opt-in profiles/social/searches/alerts remain.

- [ ] **07.** **Customer-visible provenance:** Show recorded ownership transfers, sales, grading, reholders, and corrections. Distinguish verified events, owner-reported information, and unknown history. Display consenting owner handles or “Private collector.”
  - [x] **TECHNICALLY DEPLOYED:** Staff read-only sourced grading/custody events. The public-fact redaction helper is not a customer endpoint.
  - [ ] Reviewed ownership/transfer/sale/reholder/correction events, consent and customer/public endpoint integration remain. The redaction helper alone is not publication.

- [ ] **08.** **Ownership and custody:** Track who owns the card separately from who physically holds it. Support authenticated off-platform transfers and reviewed ownership claims. A cert number or QR scan alone cannot establish ownership.
  - [x] **TECHNICALLY DEPLOYED:** Separate ownership UNKNOWN and current-holder UNKNOWN; recorded custody is independently sourced.
  - [x] **LOCAL VERIFIED:** Unregistered claims/participating-transfer/settings proposal,9unit and7owned PostgreSQL17 groups; evidence retention/reviewer provisioning still absent.
  - [ ] Authenticated off-platform transfers, reviewed claim authority, separate append-only custody/ownership writes and explicit dispute/correction handling remain.

- [ ] **09.** **Numbered field:** Preserve the exact printed serial, such as `007/099`, plus its supporting image. Search comps using `/99`, not the individual copy number. Keep serial numbering separate from checklist numbers.
  - [x] **TECHNICALLY DEPLOYED:** Exact printed serial, numerator/denominator, original-photo human evidence and normalized denominator query.
  - [ ] Fresh real-card serial/photo/comp acceptance remain.

- [ ] **10.** **Autographed field:** Record signature presence and type—on-card, sticker, cut, facsimile, or unknown. Search using `auto`. Keep signature detection separate from authentication.
  - [x] **TECHNICALLY DEPLOYED:** Reviewed signature presence/type, evidence checks and comp terms; no authentication inference.
  - [ ] Fresh real-card autograph/type/unknown acceptance remain.

- [ ] **11.** **Patch/relic field:** Record material, individual relic windows, and manufacturer statements about game use, player wear, event wear, or unspecified origin. Preserve distinctions between different pieces on the same card.
  - [x] **TECHNICALLY DEPLOYED:** Separate window/material/manufacturer-statement/use facts and conservative matching.
  - [ ] Fresh multi-window/manufacturer-statement acceptance remain.

- [ ] **12.** **AI-assisted identity review:** Google Vision OCR and Astra propose attributes from both sides; staff confirm or correct uncertain facts. Retain supporting evidence. “Not detected” stays unknown rather than automatically becoming “No.”
  - [x] **TECHNICALLY DEPLOYED:** ATLAS v5 machine proposals with actual derivative binding; adoption clears machine observations and requires fresh human original-photo evidence; historical v3/v4 requests retained.
  - [ ] Fresh authorized real paired-photo/provider evidence, reviewer acceptance and deployed optical performance remain; synthetic tests are not recognition accuracy.

- [ ] **13.** **Optional staff comp selection:** After the grade is finalized, staff select **1–5 recent, correctly matched sold comps**, or choose Skip/No suitable comps. Missing comps never block an approved report.
  - [x] **LIVE / LOCAL VERIFIED:** Existing saved sold-search/selection foundation retained; detail reads only saved same-approval references.
  - [x] **LOCAL VERIFIED:** Optional1–5/Skip/No suitable comps contract and actual-component preview, with duplicate/exclusion guards.
  - [ ] Persist and accept the optional post-grade 1–5 bound, recent matching evidence, Skip and No suitable comps without gating approval.

- [ ] **14.** **Reliable pricing guidance:** Match printing, serial denominator, autograph, and relic details. Separate grading companies, grades, and special designations. Exclude mismatches, lots, and unknown accepted-offer amounts from calculations.
  - [x] **LIVE:** Shared identity query and separated grader/grade grouping retained.
  - [x] **TECHNICALLY DEPLOYED:** Denominator/autograph/relic contradiction and uncertainty checks; lots and unknown accepted-offer amounts cannot drive new guidance.
  - [ ] Validate real returned evidence and integrate the bounded price-guidance eligibility contract.

- [ ] **15.** **Transparent suggested prices:** Show the selected sales, dates, sample size, range, and suggested starting price. Refresh stale guidance when listing while preserving the report’s original snapshot. Sellers control their asking price.
  - [x] **LOCAL VERIFIED:** Selected-sale mean, range, sample size and dates preview; method acceptance/persistence remain.
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
  - [x] **TECHNICALLY DEPLOYED:** Pure-white shared slab detail, restrained emerald, responsive desktop/390px/320px and accessible controls; optional3D/report-return source, failure recovery and browser qualification completed; physical-device performance remains separate.
  - [ ] Carry the accepted system into unreleased collection/marketplace flows and qualify genuine device/media quality and performance; illustrative geometry is not physical CAD.

- [ ] **26.** **Release 1 — Foundation:** Staff archive, expanded identity, permanent records, provenance, My Collection, and dependable comp curation.
  - [x] **LIVE:** Archive increment.
  - [x] **TECHNICALLY DEPLOYED:** Reviewed identity and read-only detail/history increments.
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

### First: complete signed-in real-card acceptance

Use the ordinary staff session on the canonical archive. Verify real archive search/filter/table/paging, actual detail Front/Back, optional3D, saved identity/history and exact report return. Do not request paid recognition, create approvals or modify a card merely to exercise a read. Record unavailable real examples honestly. Keep owner visual acceptance, technical behavior and physical media acceptance distinct. Retain unchanged local failure/recovery tests instead of repeating them without cause.

### Technical release is complete

The freshca3/SQL009/native/staff/public packet has completed source/build/served qualification, canonical report/photo preservation, native health and explicit admission release/absence. Every effect intent is consumed. Do not rerun prepare/execute from these packets or the older archive release-02. Any later release needs fresh observed inputs and a new reviewed plan. Customer publication and ownership activation were not part of this release.

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
- `packages/atlas-standalone-database/sql/009-card-provenance.sql` and `migrations.manifest.json`: installed additive provenance read, exact checksum5b014085.
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
- Old “current” dated headings are historical where superseded by the archive release or later session entries. In particular, public eafcec14/native3256 and archive webc4b7/native31c checkpoints precede current native/staff/publicca3a848d.
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

Inspect actual Git status and HEAD before editing. Deployed source is ca3a848d; local ownership/collection/curation is46621dad; later documentation commits may be HEAD. Do not touch the original dirty/conflicted checkout at /Users/markthomas/tenkings/ten-kings-mystery-packs-clean. Do not replay the frozen archive release-02 packet.

Current observed production is native/staff/public ca3a848d with image62db2a and installed SQL009; customer stays c68e9ea7. Controls137/98/105, customer83/35 retained. Canonical technical/report/photo/preservation and native postflight passed. The original holder was explicitly released22:38:21.199Z and absence proved22:38:27.851Z October21UTC. No release hold remains. Full IDs/hashes and reconciliation are in detail-production-release.md. Ordinary signed-in real-card acceptance and owner3D/physical acceptance remain pending; Front remains default. Ownership/collection/curation46621dad is local only. Never describe that preview as production or replay consumed release packets.

Preserve pure white #ffffff, restrained emerald #047857, gallery card text/actions aligned to slab edges, the larger SAME source-bound ATLAS slab on detail, Front/Back, no detail Inspect/zoom, no Approved Card/Human Approved hero labels, and the portrait Grade Report link. Keep the standalone report and exact report versions/NFC URLs. A missing reverse label is missing. Current1350×1858 approved photos are not full-resolution raw masters; illustrative 3D is not calibrated physical geometry or complete paired-master output.

All ATLAS graded cards DEFAULT Open to offers; owners may disable per card/collection. Do not revert to opt-in. Privacy, verified ownership, actual recipient delivery and transaction eligibility remain independent. Listed cards use price+Buy Now; unlisted eligible cards use Open to offers+Make Offer. Email/in-app Accept/Decline/Counter workflow is planned; no email-GET mutation or SMS without separate setup/consent. Carry forward the proposed state-aware report host header View Listing / Make Offer only once an actual public card/listing projection exists; do not hardcode marketplace state into the saved report. This increment only adds the Card Detail return. R2 is the ATLAS-held fixed-price pilot; the offer engine remains R3 unless I explicitly reorder it.

First finish ordinary signed-in real-card acceptance at https://atlasgrading.com/admin/graded-cards; Chrome handoff tab2132133231 awaits staff sign-in. Retain existing unchanged local desktop/320px failure/recovery and report-roundtrip evidence. Keep optional3D separate from making it primary. Resolve any actual integration defect, then continue the ownership/My Collection foundation. The detail/identity/history technical release is completed; no general approval loop or replay is needed.

In parallel assign three xHigh lanes: (1) detail/media and paired-master/source binding, (2) record/ownership/claim/transfer/custody contracts and owned disposable-DB qualification, (3) customer My Collection/privacy followed by bounded1–5 comp curation and explainable pricing. You own shared integration, package/lockfile coordination, docs, commits, browser/build qualification and every release effect. Do not infer legal ownership from staff ACL, submission, custody or NFC.

Continue the approved order: dedicated detail and reliable media → reviewed identity/history and production/real-card acceptance → ownership/My Collection → optional comp curation/pricing → complete R1 journey → R2 listings/checkout/fulfillment/protection/real USD balances/withdrawals → R3 offers, dealer/direct shipping, social and provider-approved balance spending. Keep all30 master-plan requirements visible with honest checked completed subitems and unchecked unfinished requirements.

Use Node22, relevant tests, owned disposable PostgreSQL17, actual-component desktop/mobile checks and fresh release evidence. Preserve real approved reports/photos/labels, grading math, final-human-approval authority, historical provider bytes and Ten Kings independence. No synthetic sale/owner/balance/activity or invented physical result. Do not issue paid searches, notifications, money movement, printing or tag writes merely to test read features. Destructive operations require their explicit owner authorization and Set Ops dry-run+typed confirmation.

Append SESSION_LOG after each commit-worthy code change and before/after any deployment/restart/migration. Reconcile stale docs against evidence in the same session. Report implemented, locally verified, deployed, owner-accepted and real-world operationally accepted separately. Carry the whole plan forward without dropping remaining work.
```

