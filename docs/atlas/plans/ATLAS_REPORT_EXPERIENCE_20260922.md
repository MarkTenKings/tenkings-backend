# ATLAS report experience and early geometry

September 22, 2026 Pacific. The approved implementation is frozen at `79483f13000c23dfed62c0c03f1239beb8f74dfb`; native/PG44 qualification, migrations43/44 and native startup pass. Caddy activation, all five control bindings, public promotion and final hosted verification are complete; the release is live. See the [current release audit](../audits/2026-09-22/report-early-geometry-release.md). This document distinguishes implemented software, the preceding audit and unfinished physical work.

## Owner direction

- Start geometry automatically when uploaded photos become usable. Do not wait for card identification, complete details or a Geometry button click.
- Use the ATLAS logo and black/gold identity throughout staff and customer experiences.
- Aim for exceptional visual quality, understandable results, unusual depth of evidence and direct interaction with photographs and defects.
- Treat the report as a flagship product. Mark subsequently approved implementing this full direction with three Astra/xhigh specialists; grading rules remain unchanged.

## Approval behavior before this implementation — historical

In predecessor source `053768aa`, the connected manual **Approve final report** action was actual human approval. Once it succeeded, the system saved the exact recomputed report, approving actor and source/report hashes in immutable approval history, with an atomic action receipt. Later working-draft changes required their own approval and could not rewrite the earlier approved snapshot. These approval guarantees remain in the new source.

That manual path did not publish a customer-facing report URL, assign a public report number or connect approval to physical NFC/slab finishing. Its public `/reports/[token]` page used a separate legacy V1 projection and that version's `displayGrade`. The new version-aware manual projection preserves the legacy parser and displayed grade; it does not cast V2 into V1 or globally change grade formatting.

The September 7 approved product direction says human approval should make the final report public. The implementation below closes that predecessor source gap by projecting only the immutable approved snapshot and preserving the persisted V2 half-point award and rule. Activation and real-card acceptance still require their own evidence.

Source references:

- `frontend/atlas-app/components/ManualCards.jsx`: exact-report approval button and saved confirmation.
- `packages/atlas-manual-service/src/service.mjs` and `repository.mjs`: authority, recomputation, CAS and immutable approval insertion.
- `packages/atlas-manual-workspace/src/FinalReportReview.jsx`: current rich staff review.
- `frontend/atlas-public/pages/reports/[token].jsx` and `packages/atlas-report-view/src/public-contract.mjs`: separate public reader and V1 contract.

## Current implementation qualification

Frozen source `79483f13` supports a dedicated manual-only public reader without legacy DB/media credentials. A complete legacy configuration retains its original hash and behavior; partial configurations fail closed. Exact human manual V2 approval atomically creates a durable pending publication; delivery builds the verified public projection and stable versioned report link. Focused local and full44 PostgreSQL fixtures verify retry without reapproval, exact approved media/traces/grades, immutable version history and read-only public control. Native qualification, the two additive migrations and native startup now pass. PublicReaderControl revision1, the reviewed private Caddy route, public promotion and final hosted verification are complete. No production-card approval is claimed. Print/save PDF uses the browser; no stored PDF-generation service or physical NFC/slab action is claimed. See `packages/atlas-connected-manual/README.md` for delivery and configuration boundaries.

## Certificate, label and NFC boundary

The new manual publication assigns a stable ATLAS report number and public token, with a separate immutable version for each exact human approval (`packages/atlas-connected-manual/src/publication-repository.mjs`). These identify the approved report; they do not issue a slab label, physical certificate or NFC credential, nor record printing, tag programming, assembly or welding. Browser print/save PDF is a report copy. Software qualification or deployment is not evidence that a production card has been approved or physically finished.

The existing finishing service is a different, legacy path: `frontend/atlas-app/lib/server/access/finishing.mjs` requires `StaffSpecimen`, `StaffReportApproval`, `StaffPublicReport` and the V1 public packet; the finishing migration enforces those legacy foreign keys. It cannot consume a new `atlas_manual` publication. Its V1 grade-only label also requires an explicit versioned adapter to represent the manual V2 final half-point award correctly. The smallest future integration is an approval-bound manual finishing ledger and label projection that retain the report number, exact approval/version/hash and immutable history, with separate label issue, verified NFC and human physical-stage receipts. This design is not certificate issuer-policy approval or authority to reuse the Ten Kings permanent-card writer. Any physical certificate identity/policy must be explicitly settled before issuance, as required by the canonical blueprint.

The selected Mac/ACR1552U/F8215 path still needs a qualified production writer and permanent-lock proof, protected station signing/pairing, hosted acknowledgement/recovery and the bounded armed finishing session. The successful earlier diagnostic test-URI write/readback does not establish those capabilities. See [Mac NFC status](../MAC_NFC.md). No automatic tag provisioning or physical-completion action is part of this report release.

## Approved report experience and implementation

The report should answer **What grade? Why? Show me the evidence.** Mark approved these interactions on September22. Source `79483f13` implements the shared black/gold report, linked numbered findings, Front/Back/category navigation, geometry layers, verified-photo zoom/pan/pinch/minimap, finding crops, full-precision detail and print presentation. Local visual/browser checks pass; exact release and owner acceptance remain separately recorded. The design principles below remain the product direction, not a claim of measured production speed or inferred image detail.

1. **Clear opening view.** Deep black/charcoal, restrained gold accents, readable white text, ATLAS branding, large genuine card photography, the awarded grade and four subgrades. Keep photographs color-neutral. Place a short explanation of the result beside the grade; make deeper calculations available on demand.
2. **Linked evidence exploration.** A persistent findings list and numbered image markers stay synchronized. Selecting a finding moves to its real location and shows its close-up, measured extent and category effect. Add next/previous navigation and a whole-card minimap so deep zoom does not lose context. Retain verified masks, existing pan/zoom, magnifier and overlay controls.
3. **Useful layers.** Let the viewer inspect the photograph, physical edge, printed border, centering and confirmed defects independently. Distinguish derived views from the underlying photo. Do not invent optical detail, depth, lighting captures or a measured 3D surface from two photographs.
4. **Explain the grade visually.** Connect measured damage to the actual scoring thresholds and show Front/Back weighting, category contributions, raw result and final half-point award. Explain tolerated imperfections, including when a 10 contains measured damage. Individual marginal effects are not additive deductions.
5. **Trust and sharing.** Provide approval date, report version, rule version and a stable link to the approved evidence. Consider links to individual findings and a printable approved report. Public transparency must not expose private credentials, storage access or internal staff/proposal history by accident. Report numbering and issuer policy need explicit treatment in the publication implementation.
6. **Direct, responsive interaction.** Support touch, keyboard, pinch zoom, large hit targets, readable contrast and reduced motion. Use animation to preserve orientation between a full card and a defect, while keeping examination stable. Measure real device performance before making speed claims.

The existing `frontend/atlas-public/public/marketing/atlas-brand.png` contains the black/gold ATLAS globe, wordmark and “KNOW WHAT YOU HAVE” tagline. It was visually inspected during this audit. Reuse the existing brand identity; this direction does not authorize inventing a different logo.

The same visual system should cover staff intake, geometry, findings, report review, customer progress and the final public report. Staff screens should prioritize efficient repeated actions and persistent save/progress feedback; customer screens should prioritize comprehension and evidence exploration.

## Early geometry behavior

The predecessor UI coupled geometry computation to a ready pair, completed identification and saved details. The new per-side scheduler begins when a selected verified working photo is ready, while identification runs independently once its pair is available. Final workspace initialization still validates real identity and details, then adopts matching preparation from the durable cache.

The native physical/printed preparation worker uses verified image bytes and geometry settings, not the card name, year, set or identification result. Early processing is stored separately from final review-workspace provisioning; it does not fabricate card details or weaken identity validation.

Implemented behavior:

- Each selected photo starts its own geometry work after original verification and working-image preparation, even if the other side has not finished.
- Identification runs independently when its required input pair is ready.
- Ready geometry is reused when the reviewer enters Geometry. The button navigates and saves relevant edits; it does not serve as the processing trigger.
- Photo or geometry-setting changes invalidate only affected preparation. Changes to name, year or set do not rerun unchanged pixel work.
- Cached or delayed results remain bound to exact upload/frame/settings/engine identities. A replaced photo, later human edit or newer request cannot be overwritten.
- Progress and recoverable failure are visible per side. Geometry processing is distinct from human confirmation and cannot auto-approve findings or reports.
- Durable per-side intents, claims, deduplication and recovery keep at most two workers active. Geometry progress stays outside immutable photo-source artifacts and the upload objects used to derive identification's source hash. Original photos and explicit human review remain required.

Focused coordinator/client/native and actual PostgreSQL groups cover independent sides, changed details, photo/settings replacement, lost replies, reopening, authorization/claim fencing and preservation of existing human edits. Local browser evidence shows first-side completion before Back/identification and cached initialization preserving typed text. These fixtures do not establish production latency or Mark's signed-in optical acceptance.

## Remaining acceptance

The release audit records completed Caddy/control/public promotion and final hosted verification with the exact live identities. Mark's signed-in saved/new-card workflow and report/optical acceptance remain separate from source tests and release checks. Physical certificate/label/NFC finishing remains the explicit future integration above.
