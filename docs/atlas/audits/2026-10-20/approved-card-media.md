# Approved-card media foundation — October 20, 2026

Initial source audited: `fbb2f2d2` (`codex/atlas-marketplace-foundation`). That initial audit is local source evidence, not a deployment, production data inspection, physical-holder qualification or measured production throughput result. No provider, production database, printer or NFC operation was performed by the initial audit.

## Deployed read-time presentation — October 22, 2026

The slab-quality release at `20b747badb8ad34c510673c446cf326396bdeeac` composes the staff archive's digital Front/Back previews at read time from the exact approved inspection photographs and matching retained label artwork. Existing and future eligible approvals use this shared presentation without regrading, reapproval or rewriting saved photographs, reports or labels. The card is centered in the illustrated holder in both stills and 3D. A verified recorded physical slab photograph takes precedence in the archive thumbnail and Front still; the digital holder remains an illustration, not evidence of physical assembly or NFC completion.

A source-bound transparent WebP preview (558 × 768 for the current 1350 × 1858 inspection photographs) is generated in an additive private cache. The reader verifies its policy, source hash, byte count and digest. A cold cache can show the existing small JPEG while at most three bounded, same-source checks seek the transparent preview; failures retain verified media. Selecting 3D loads the 3D module and requests the full-detail photographs on demand. Ordinary preview delivery can also fall back to the verified full image when smaller representations are unavailable.

The shared access-grant parser accepts the additive alpha metadata in staff and public delivery. Public report photographs, homepage presentation and customer surfaces were not restyled by this release. Canonical acceptance verified eight actual transparent previews and their unchanged approved source hashes across four existing public reports. See the [current deployment runbook](../../../runbooks/DEPLOY_RUNBOOK.md) and [slab-quality audit](../2026-10-22/slab-quality-and-progressive-media.md) for release evidence and scope.

This read-time inspection-photo composition does not create untouched-original presentation masters or a durable Front/Back composition manifest. The original-photo master work below remains future work.

## Media projection and authority

The staff archive uses the existing human-approved publication and the existing media endpoints. `packages/atlas-connected-manual/src/approved-card-media.mjs` provides the read-only `archiveApprovedMedia` projection consumed by the archive service. Its tests reject swapped cards, stale approvals, changed source/report/public hashes, malformed selectors and corrupt optional presentation. Optional media failure leaves the independently approved Front/Back pair available.

| Media | Existing source and authority | Archive meaning |
| --- | --- | --- |
| Front and Back | Immutable public report packet and `APPROVED_MEDIA`; exact approval version in `/api/reports/{token}/images/{side}?v={version}` | `APPROVED_GRADING_PHOTOGRAPH`; not an untouched intake original or proof of a physical slab |
| Actual slab photo | Independently versioned `atlas_manual.presentation`, exact card/action/publication binding and stored presentation digest | `ACTUAL_SLAB_PHOTOGRAPH`; the existing optional uploaded photograph, not a generated holder |
| Label | Actor-accessible, READY retained `label_item`, bound to the exact card, approval, source, report and public hashes | `REPORT_BOUND_LABEL_ARTWORK`; retained preview, not a fresh rendering from mutable identity |

Archive Front/Back URLs use ordinary binary image delivery. Only the explicit `delivery=direct` query requests a JSON access grant. `frontend/atlas-public/lib/server/media-http.mjs` and `reader.mjs` retain verified binary delivery, including byte count/digest and publication rechecks. Do not put a grant URL directly into an `<img>`.

The helper does not hydrate every full report or read image storage for a list row. The image endpoint validates bytes when requested. Therefore a projected URL is source-bound availability, not a claim that an image was decoded successfully in the current browser. The UI must preserve its unavailable-image state when a read fails.

The optional slab photo's descriptor includes a digest, dimensions, MIME and presentation revision. The label's `artworkHash` identifies its retained **print SVG**, not its different preview bytes. Label preview authorization is narrower than general card viewing: the existing label repository selects by the authenticated actor. The archive must not advertise another actor's private label endpoint as accessible.

## Sources already available for deterministic composition

1. **Untouched original bytes and pair identity.** `packages/atlas-photo-core/src/index.mjs` defines original descriptors with card ID, pair ID, explicit side, version, upload ID, object reference, exact byte digest, MIME and optional original metadata. Its decoded-frame contract binds the original, decode plan, dimensions and transform. `packages/atlas-connected-manual/src/publication.mjs` retains each approved side's original, decoded/selected grading frame, decode plan and prepared inspection descriptor in immutable `APPROVED_MEDIA`. These private references are reusable; the archive need not duplicate originals or introduce a second physical-card identity.

2. **Exact approved report.** `packages/atlas-connected-manual/src/finishing.mjs` verifies publication, report number/version, report/source hashes, immutable packet bytes, approval identity and grade, then reauthorizes after object storage. Its `loadPacket` is the reusable detail/composition source boundary. The public inspection photographs are presently 1350 × 1858 WebP derivatives. They remain the report's evidence frame, even when a future presentation master is larger.

3. **Retained exact label artwork.** `packages/atlas-connected-manual/src/label-sheet-service.mjs` derives label content from the verified approved packet and retains its SVG, source snapshot, artwork hash and renderer profile. At the initial audit, the outlined V4 profile was `atlas-v4-outlined-label-compact-caption-v2`; physical size is 68.342 × 20.082 mm. Fonts and supplied assets are hash-bound. The individual export profile in `packages/atlas-finishing/src/label-sheet.mjs` produces 6458 × 1898 PNG at nominal 2400 ppi; that label resolution does not increase card-photo detail. Saved artwork must be reused rather than regenerated with whichever renderer happens to be current. The exact READY retained label derived from the human-approved report satisfies the accepted workflow; this milestone adds **no separate label-approval action**.

4. **Permanent report/NFC association.** The finishing plan binds the actual URL `https://atlasgrading.com/reports/{token}?v={approvalVersion}`. Use this recorded URL for presentation and existing NFC integration. A rendered chip, label, report link or successful software render does not establish tag readback, permanent lock, physical assembly, custody, ownership or authenticity. The existing station receipts remain the authority for their own physical facts.

5. **Existing report film.** `packages/atlas-report-view/src/approved-film-contract.mjs` defines a 16-second, report/public-hash-bound recipe. `packages/atlas-manual-workspace/src/approved-film-export.mjs` verifies approved photo bytes and performs explicit local MP4/WebM export, with cancellation and a final report recheck. It is an animated approved-report derivative, not footage of a card, a stored video library or a real 360° capture. Reuse the existing tour/export UI; do not manufacture a video-ready asset URL.

Important naming trap: the staff route `images/{side}/original/{hash}` currently loads `readGradingSource` and returns its selected `workingFrame`. Depending on the recorded policy, that can be a generated or cleaned grading frame. It is **not** an API for untouched upload bytes. A high-resolution original-only compositor must follow the immutable original/decode lineage rather than infer image authority from that route name. Existing report semantics are preserved.

## Future original-photo master composition

Use one content-addressed composition recipe inside the existing ATLAS service/package boundaries. Do not add a provider or per-card generative image step.

1. Load the exact authorized publication through the existing finishing source boundary; load its immutable `APPROVED_MEDIA`; validate both original descriptors against the same physical card and pair, with explicit Front/Back roles. Read and hash the actual original bytes. Decode using the existing qualified, full-resolution orientation/color policy, recording the original-to-working relationship.
2. Load the matching retained READY label and verify print-artwork hash, preview derivation, renderer profile and all approval/source/report bindings. Use its exact existing grade/certificate/identity. No extra human approval step is inferred, and no current-renderer substitution is allowed.
3. Select a qualified holder/NFC presentation template with its own version and source hashes. The owner design reference's front shell is an illustration using exterior proportions, not calibrated interior CAD. Its NFC image is a real component reference, not proof that the pictured chip belongs to a given card. The three supplied HEIC files are present at 4032 × 3024; existence/dimensions do not establish measured Front/Back holder calibration. No accepted back geometry was established by this audit.
4. Compose from original-derived pixels using explicit, checked transforms. Preserve every card boundary and condition detail. Reuse approved geometry only when an actual source-frame relationship proves it applies to the original; historical generated-frame geometry must not be silently transferred. No AI upscaling, reconstructed corners, invented back, relighting, foil/texture simulation or defect removal. A frame lacking an authorized safe transform needs correction or an honest unavailable state.
5. Save Front and Back masters and responsive derivatives with their actual dimensions, source hashes, transforms and recipe/profile hash. Choose master dimensions from the available projected source resolution; a larger holder/label canvas is not additional photographed detail. Keep grading evidence and its masks unchanged.
6. Publish one immutable pair manifest only after both sides and every input binding pass. Its deterministic identity includes physical card, approval/action/version, original pair and hashes, retained label artwork/renderer, holder revision, template assets and composition profile. Retrying identical inputs reuses the exact result. Changed approved inputs create a new version with explicit supersession; partial pairs and stale/mixed inputs never become public. Recheck authorization and current eligibility before the pointer changes. Readers use the same pair version across archive, report, collection and future listings.

## Remaining work for original-photo masters

- Calibrated front **and** back holder/card/label/NFC geometry, supported card-format policy and exact template asset hashes. Do not infer backside details from the front illustration.
- An original-only full-resolution composition adapter, bounded render execution and complete transform/output manifest; no claim that current approved report derivatives are those masters.
- Durable composition intent/result, immutable pair publication and supersession integration. Reuse current service/storage conventions; design the smallest scoped persistence change after inspecting the agreed permanent-card model. No new table, worker or schema is implied by this audit.
- Adversarial qualification for swapped sides/card/pair, historical generated versus original frames, label mismatch, invalid transform, missing original, output corruption, partial write, retry, source change, reholdering and concurrent publication.
- One real approved card verified against its retained originals and label at full image and corner/detail views, plus correct Front/Back navigation. Physical template acceptance and fresh production/browser acceptance must be recorded separately.
- Measured render latency, memory, master/derivative size, cache behavior and sustained throughput before claiming scale. Local unit tests do not prove production capacity.

The initial projection passed six focused Node 22 test groups. These use synthetic descriptors and exercise binding, safe omission and nonmutation. They neither certify a real card nor qualify a digital holder as a finished-slab photograph.

## Subsequent live-baseline correction

Fresh release preparation found that live native source `3256af83` was not an ancestor of the initial `fbb2f2d2`/archive branch. The source-local results above are historical evidence, not proof that all live behavior had been retained. Merge `c4b7cc85` explicitly joins archive `4a7a2fba` and live `3256af83`, retaining all five live shared-query modules byte-for-byte and public-photo source `eafcec14`. Finishing-test expectations were corrected to the actual live full-set/`psa9.5` behavior without changing that search behavior. Requalification passed staff 765/765, connected 873 passes plus two existing measurement skips, standalone 7/7, actual PostgreSQL six groups, and isolated candidate-image Linux 229/229. Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/release-02/`. This correction and qualification do not themselves establish production activation.
