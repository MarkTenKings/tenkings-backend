# ATLAS report experience and early geometry

September 22, 2026 Pacific. This records Mark's product direction and a source audit; it is not an implementation or deployment receipt. Deployed application source remains `053768aa4474f950017c43b659648668631f6b9e`.

## Owner direction

- Start geometry automatically when uploaded photos become usable. Do not wait for card identification, complete details or a Geometry button click.
- Use the ATLAS logo and black/gold identity throughout staff and customer experiences.
- Aim for exceptional visual quality, understandable results, unusual depth of evidence and direct interaction with photographs and defects.
- Treat the report as a flagship product. The user has not approved a particular new layout or changed grading rules.

## What approval currently does

The connected manual **Approve final report** action is actual human approval. Once it succeeds, the system saves the exact recomputed report, approving actor and source/report hashes in immutable approval history, with an atomic action receipt. Later working-draft changes require their own approval and cannot rewrite the earlier approved snapshot.

This manual path does not yet publish a customer-facing report URL, generate a PDF/report number or connect the approval to physical NFC/slab finishing. The public `/reports/[token]` page uses a separate legacy public projection. Its current contract accepts V1 graded reports and its displayed grade uses that version's `displayGrade`. It must not receive a new manual V2 report through an unchecked cast or a global change of grade formatting.

The September 7 approved product direction says human approval should make the final report public. Current source therefore has a known implementation gap. Public delivery must project only the approved snapshot, preserve the persisted V2 half-point award and rule, and continue rendering historical reports according to their original policy. Design polish alone does not close this gap.

Source references:

- `frontend/atlas-app/components/ManualCards.jsx`: exact-report approval button and saved confirmation.
- `packages/atlas-manual-service/src/service.mjs` and `repository.mjs`: authority, recomputation, CAS and immutable approval insertion.
- `packages/atlas-manual-workspace/src/FinalReportReview.jsx`: current rich staff review.
- `frontend/atlas-public/pages/reports/[token].jsx` and `packages/atlas-report-view/src/public-contract.mjs`: separate public reader and V1 contract.

## Proposed report experience

The report should answer **What grade? Why? Show me the evidence.** These proposals remain design recommendations until translated into reviewed implementation.

1. **Clear opening view.** Deep black/charcoal, restrained gold accents, readable white text, ATLAS branding, large genuine card photography, the awarded grade and four subgrades. Keep photographs color-neutral. Place a short explanation of the result beside the grade; make deeper calculations available on demand.
2. **Linked evidence exploration.** A persistent findings list and numbered image markers stay synchronized. Selecting a finding moves to its real location and shows its close-up, measured extent and category effect. Add next/previous navigation and a whole-card minimap so deep zoom does not lose context. Retain verified masks, existing pan/zoom, magnifier and overlay controls.
3. **Useful layers.** Let the viewer inspect the photograph, physical edge, printed border, centering and confirmed defects independently. Distinguish derived views from the underlying photo. Do not invent optical detail, depth, lighting captures or a measured 3D surface from two photographs.
4. **Explain the grade visually.** Connect measured damage to the actual scoring thresholds and show Front/Back weighting, category contributions, raw result and final half-point award. Explain tolerated imperfections, including when a 10 contains measured damage. Individual marginal effects are not additive deductions.
5. **Trust and sharing.** Provide approval date, report version, rule version and a stable link to the approved evidence. Consider links to individual findings and a printable approved report. Public transparency must not expose private credentials, storage access or internal staff/proposal history by accident. Report numbering and issuer policy need explicit treatment in the publication implementation.
6. **Direct, responsive interaction.** Support touch, keyboard, pinch zoom, large hit targets, readable contrast and reduced motion. Use animation to preserve orientation between a full card and a defect, while keeping examination stable. Measure real device performance before making speed claims.

The existing `frontend/atlas-public/public/marketing/atlas-brand.png` contains the black/gold ATLAS globe, wordmark and “KNOW WHAT YOU HAVE” tagline. It was visually inspected during this audit. Reuse the existing brand identity; this direction does not authorize inventing a different logo.

The same visual system should cover staff intake, geometry, findings, report review, customer progress and the final public report. Staff screens should prioritize efficient repeated actions and persistent save/progress feedback; customer screens should prioritize comprehension and evidence exploration.

## Early geometry behavior

The current UI's `initialize()` waits for a ready pair, finished identification, validated details and a details save. The connected `initialize()` then validates a full grading identity before calling `build()` to detect and prepare both sides. That orchestration creates the delay Mark identified.

The native physical/printed preparation worker operates on verified image bytes and geometry settings, not the card name, year, set or identification result. The current geometry workspace nevertheless requires a card profile, and the final manual workspace requires identity. Separate early image processing from provisioning that final review workspace instead of fabricating card details or weakening identity validation.

Desired behavior:

- Each selected photo starts its own geometry work after original verification and working-image preparation, even if the other side has not finished.
- Identification runs independently when its required input pair is ready.
- Ready geometry is reused when the reviewer enters Geometry. The button navigates and saves relevant edits; it does not serve as the processing trigger.
- Photo or geometry-setting changes invalidate only affected preparation. Changes to name, year or set do not rerun unchanged pixel work.
- Cached or delayed results remain bound to exact upload/frame/settings/engine identities. A replaced photo, later human edit or newer request cannot be overwritten.
- Progress and recoverable failure are visible per side. Geometry processing is distinct from human confirmation and cannot auto-approve findings or reports.
- Keep native work within measured CPU/memory limits and retain existing originals and explicit human review. The existing two-slot limiter rejects busy requests; early processing needs durable per-side claims, deduplication and recovery rather than an untracked background promise. Store geometry progress outside immutable photo-source artifacts and the upload objects used to derive identification’s source hash.

A concrete implementation must qualify first-side completion, reverse upload order, simultaneous uploads, identification failure, changed details, photo/settings replacement, lost replies, reopening and preservation of existing human edits. Native processing time and total time-to-review must be measured separately.

## Recommended implementation order

Start with independent early geometry and a coherent black/gold report prototype in parallel. Close the manual-to-public approval projection with explicit version handling, then carry the approved report's evidence explorer to customers. Apply the shared design system across staff/customer screens in bounded releases. Visual prototypes, source tests, actual-photo proofs, deployed behavior and owner optical acceptance must remain distinct evidence.
