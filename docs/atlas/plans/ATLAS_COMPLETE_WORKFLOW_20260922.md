# ATLAS complete workflow — September 22, 2026

Status updated September 24 UTC / September 23 Pacific: software release `1b880d0690dd0b3a64a76103557815cf40675029` is live on staff `27Dj9…` / public `DjGX2…` and native container `f7949…` / image `2039…`, with controls 25/23/3. Batch, presentation and market are enabled; the recovered original SoldComps key passed one bounded HTTP200/13-candidate check. Station remains disabled. No new migration or grant was applied; staff 47/public 112 and the stopped c0a42a24 predecessor are preserved. The authorized dealer directory remains contact-only. See [current release evidence](../audits/2026-09-24/completion-followup.md).

Mark's 90-day reviewer authorization is active from `2026-09-24T01:32:51.855Z` through `2026-12-23T01:32:51.855Z`, accessVersion2, requiring ordinary reauthentication. Actual fresh-card processing and human approval, approved-report market search/selection and physical finishing acceptance remain open. The design, original requested inputs and intended flow below preserve the September 22 owner request; the superseded status records its earlier state.

Superseded September 23 status: the scoped web/batch/report release and authorized contact-only dealer directory are live at source `c0a42a24`. See [actual release evidence](../audits/2026-09-23/workflow-completion.md). Physical finishing, real-card acceptance and live market-provider activation remain incomplete pending genuine inputs. The design and intended flow below preserve the September 22 owner request and canonical blueprint scope.

## Intended operator flow

`Capture/import paired photos → automatic preparation → Human review → approve exact report → label job + tap NFC → verify and assemble`

Batch intake supports 10–50 cards without requiring a batch to fill before work starts. Upload, identification and geometry can overlap where independent. Durable per-card state preserves source revisions, actual attempts and uncertain external results. Provider processing is separate from the reviewer and finishing station; throughput is measured rather than inferred from the batch size.

The proposed review layout uses large Front/Back images, an unmistakable grade, numbered findings and an exception strip. Arrow keys advance findings/cards; an explicit approval shortcut applies only to the currently displayed, saved exact version. Prefetch the next card. Corrections open in place. Normal progress uses short state labels; errors retain enough information to recover. Fast review must not silently turn machine suggestions into human-reviewed lessons.

Approval prepares printing and the NFC prompt together. Each station associates one physical card at a time with the approved report; card images and label reference stay visible until device completion. Printer acknowledgement, NFC write/readback/lock, tag removal, physical assembly and welding are separate facts. Device uncertainty does not cause automatic duplicate printing or tag writes.

## Report and dealer experience

Order: optional actual slab hero → grade and card details → inspection/explanation → market evidence → dealer action. Use the existing ATLAS logo and black/gold design. A photograph with restrained pointer tilt, touch support, static/reduced-motion fallback and efficient derivatives is the initial scalable presentation. Do not synthesize unseen surfaces or obscure the original grading photographs.

Show all accepted identity fields. Keep approved grade snapshots immutable; later presentation and commercial information are separately bound to the public report/version. Historical reports must continue rendering without new fields.

Market references show grader, numerical grade, exact variant, sold date, currency, price and actual listing link. Separate exact matches, uncertain matches and other-grader context. Most recent sale is an observation; no estimator or grader equivalence is silently chosen. Any later estimate needs an explicit method, sufficient relevant sales and uncertainty; a sparse market can simply have evidence without a claimed value.

Dealer block offers **Sell to an authorized dealer** and **Submit another card**. A real offer shows dealer, amount/currency, terms and expiry. Otherwise the action is a quote enquiry. A dealer directory filters buying/submission services, supports location search and directions, and shows only configured program prices and turnaround commitments. Google Maps requires its real browser key/map configuration; a useful list and directions should work without loading the map SDK.

## Parallel implementation ownership

- Root: cross-package integration, dealer directory/data, ancillary report persistence, blueprint and release evidence.
- `nfc_label_finishing` — Astra/xhigh: version-bound manual finishing, label design, device handoff and qualification gaps.
- `batch_grading_review` — Astra/xhigh: resumable independent batch work, machine/human boundary and rapid review surface.
- `report_identity_presentation` — Astra/xhigh: identity, optional presentation media and report market/dealer UI.

The runtime permits four active agents including root; work is divided into three specialists rather than claiming a larger simultaneous team.

## External inputs and acceptance

Existing hardware selection: MacBook, ACS ACR1552U, FEIJU F8215; label faces 2.73 × 0.83 inches with the existing NFC reserve. Printer model, sheet/roll material and calibration remain requested. Native Mac diagnostic write/readback was demonstrated previously; production locking, protected signing/pairing and recovery still require qualification. Do not infer them from the diagnostic.

Requested owner inputs: printer/media; preferred bulk-pairing flow; dealer roster and program terms. Existing shared identification/sold-comps engines are the starting point; current provider access and usable sold evidence must be verified before enabling live research. No live provider charge, report approval, chip mutation or dealer contact is part of a local fixture test.

Completion requires actual implemented and tested intake→prepared draft→human approval→publication/label/NFC paths, a real printer test, a qualified chip write/readback/lock/phone scan, interruption recovery, report photo upload/public display, and real dealer/market data. Local previews and adapter tests are partial evidence, not a claim that the whole workflow is live.
