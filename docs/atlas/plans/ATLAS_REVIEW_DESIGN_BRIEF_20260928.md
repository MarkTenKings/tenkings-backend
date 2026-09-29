# ATLAS review: make the evidence effortless to work with

September 29, 2026 · Owner-approved report and reviewer implementation direction

Production release status: the complete report/reviewer design and gold fingerprint were deployed on September 29, 2026 from `29e9192080d7d7a95644316a417dc6171eef3bbb`. All 1,614 exact-source tests passed with zero skips; staff/public production builds and boundaries passed. Canonical routes, signed private reads and database/runtime preservation checks passed. Final live browser checks verified all 13 individual Abomasnow Back findings, exact gold, reversible fingerprint, unchanged photograph, paired evidence views, centering and 390px phone layout with no console errors. See `docs/atlas/audits/2026-09-29/review-design-release.md` for serving identities and evidence. Live customer report: https://atlasgrading.com/reports/ar_x01RP8d3VZS0Gk9rREW0DwkR?v=1; staff: https://atlasgrading.com/admin. Deployment qualification does not claim a new real-card approval or physical-device operator acceptance.

## Purpose

A reviewer should look at a card, make the necessary correction, and press **Approve**. The application should arrange the image, geometry, saved state and next step around that act. A collector should understand the grade by looking at the card and its recorded evidence before reading the arithmetic.

This brief follows Mark's review of the deployed rapid workflow and subsequent local report/reviewer prototypes. On September 29, after the local-versus-production distinction was explained, Mark explicitly authorized fingerprint integration, application release checks and deployment of these design changes. This does not authorize approving real cards, fabricated comparison sales or physical finishing operations. Implementation and deployment results must remain separately evidenced in the session handoff.

## Studying the method before choosing the appearance

I studied documented work and interviews, not a simulated identity or claim to Jony Ive's lived experience. His path from making and dismantling objects, through Newcastle Polytechnic and the broad product work at Tangerine, into Apple makes the link between construction and use particularly relevant here. His Design Museum interview connects ease of use, attention to overlooked details, shared goals across disciplines and listening carefully before committing to a product. His account of the iMac handle shows how form can explain what a person can do. His later discussion cautions that a persuasive rendering does not replace making the object. [Design Museum: Jonathan Ive, direct Q&A and recorded conversation](https://designmuseum.org/designers/jonathan-ive).

Apple's design-process talk treats simplicity as protecting the user's attention, calls for prototypes and feedback, and describes polish as an experience that feels coherent in use. These are process lessons, not a palette or a guarantee of quality. [Apple: The Qualities of Great Design, WWDC18](https://developer.apple.com/videos/play/wwdc2018/801/).

The current iPhone page was opened and visually inspected. Its strong object scale, restrained text, separation between a filled primary action and lighter secondary action, and clearly spaced sections are useful references. ATLAS needs a working inspection instrument, so it should use those hierarchy lessons while keeping its own brand and its denser evidence task. [Apple: iPhone](https://www.apple.com/iphone/).

## What ATLAS actually does

The reviewed source is the isolated checkout based on `dab8db8b`. Current behavior was traced through `ManualCards`, the rapid-review state helpers, `FinalReportReview`, `ReportInspectionImage`, the geometry workspace, report presentation projections and verified-image delivery. Master context, deployment/operations handoffs and the approved blueprint supply the product boundaries; source behavior determines the implementation findings below.

- Untouched originals are retained. Editing and reports use evidence with explicit source/frame/hash bindings. A small preview can appear during loading; it cannot enable an evidence decision. Existing verified delivery and cache behavior must survive the redesign.
- Physical geometry defines card material. Printed geometry defines the inner reference used for centering. These coordinates can inhabit different frames; drawing them together requires a correct transform. An attractive approximate outline is unacceptable.
- Canonical inspection is 1350 × 1858 pixels, including a 40-pixel surround around the 1270 × 1778 card. The standard card model is 63.5 × 88.9 mm. Saved traces and deterministic measurements support the grade. Display zoom is a view operation, not a change in evidence.
- Four categories contribute equally. Front/back weighting is 70/30. The current final award rounds the unrounded result directly to the nearest half point; historical report policies remain intact. UI changes must not reinterpret those numbers.
- Human review corrects machine proposals; exact final approval publishes the saved report. A per-side Approve action may save review progress without falsely publishing the whole card. The last explicit Approve still owns publication of the exact current report.
- Printing, NFC and market references are separate from grading validity. Their UI must use actual service/readiness/receipt states. Public market content is an optional approved projection; absence is not a fabricated pending lookup.

## The decisions

| Observed friction | Design decision | Evidence of success |
| --- | --- | --- |
| Both card sides and tool entry points compete for attention | Open directly on one large front image with both physical and printed outlines ready | First useful screen needs no mode selection, browser zoom or panning |
| Large circles obscure the exact corner | Small visible handle, fine stroke, larger invisible pointer/touch hit region; keyboard adjustment remains available | The edge is visible during a drag; a finger can still acquire the handle |
| Outer and inner border have separate save rituals | Keep both drafts together in one view and save the side through Approve | One action advances Front → Back after successful persistence |
| Confirmation checkboxes repeat the same human decision | Stable green Approve at the bottom/right; concise current-step label nearby | No intermediate checkbox, modal or separate save in the normal path |
| Defects require navigating or interpreting a busy viewer | Automatically frame the selected finding, keep one large photograph, offer a direct clean-photo switch and optional comparison | Same action location; no compulsory twin-pane view |
| Dark/gold report feels dense and cartoony | Pure white page and customer image surround, near-black text, exact red saved traces, fine calibrated instruments | The photograph is visually dominant; text and status remain readable |
| Collector faces pages of explanation | Grade, photograph and visual finding index first; details and arithmetic in disclosures | A user can inspect a finding without first reading formulas; print retains all calculations |
| Completion does not explain next work | Keep the successful completion card, then distinct Label, NFC and eBay steps with real states and direct actions | User can name the next available action immediately; disconnected hardware is clearly actionable |

The desired rapid path is **Front geometry → Back geometry → each finding → final grade → completion**. Every stage has one main decision, called Approve. Previous and Edit remain secondary recovery actions. Failed persistence keeps the same evidence and draft on screen, with a retry at the same action. A network response arriving late cannot approve or advance a different card.

## Visual vocabulary

- **Page and surface:** pure white `#ffffff`, including the customer photograph surround; **text:** near-black `#1d1d1f`; **secondary text:** neutral gray `#6e6e73`. This September 29 owner direction supersedes the earlier warm platinum/green-white proposal.
- **Image surround:** pure white for the customer report; evidence photographs retain their original pixels and capture background. Never recolor, sharpen or filter a photograph to match the interface.
- **Geometry:** distinct physical, printed-border and centerline strokes with contrast against the photograph, actual border-midpoint calipers and floating millimeter labels. Saved left/right and top/bottom balances remain authoritative; meaning does not depend on color alone.
- **Findings:** show every individual exact red saved trace at source scale. On desktop, each connected label carries the stable side number, defect name and enlarged trace silhouette; on phones, the complete individual index sits below the photograph. The customer goes directly from the whole card to any finding, with no area-grouping step or grouping toggle. Maintain a large accessible target independently from the displayed trace, and preserve each finding's evidence, measurements and grade effects.
- **Action:** emerald for Approve and actual completed facts; gold stays with the ATLAS identity. Green must not imply an unobserved hardware success.
- **Typography:** existing ATLAS sans for interface and result, monospace only for precise measurements. Short labels at useful reading sizes; avoid tiny paragraphs in tracked capitals.
- **Motion:** customer finding changes retreat to the whole card, establish location, then approach the selected saved trace; calipers appear on arrival. New selections and manual gestures interrupt immediately. Both comparison panes share one camera. Reduced motion goes directly to the requested view. Staff favors fast direct focus and no animation during precision edits. No ornamental scan loops or fictional diagnostic data.

## Build and evaluate the working object

The local preview must exercise the actual components and verified fixture photographs, with its synthetic status stated. Screenshots alone cannot prove the feel of a handle, recovery after a failed save or correct advance behavior. Test at a 1440 × 900 desktop and a narrow phone viewport, then let Mark perform physical-card acceptance.

Acceptance targets:

1. Front geometry is the initial review view. Both outlines are immediately visible and editable; all four corners fit without browser zoom. Back behaves the same after one successful Approve.
2. Handles and strokes keep their apparent screen size when the image is reframed. Touch targets remain usable and keyboard focus is visible.
3. One green primary action is visible without scrolling at ordinary laptop height. It advances only after the correct save/confirmation succeeds. A failed or stale save never discards the pending geometry or advances another card.
4. The public whole-card overview exposes every individual finding and opens the selected finding directly in synchronized marked and unmarked views. Returning restores the complete overview and remembers the last finding. Staff retains its contextual finding tools and clean comparison. Comparison uses the same verified pixels and camera; browsing never changes evidence.
5. Report details are progressively disclosed. Printing opens the complete identity, calculations and provenance and includes every included finding.
6. Public viewers never receive edit/approval callbacks or private workspace fields. Wrong hashes, dimensions or source bindings still refuse evidence readiness.
7. Finishing cards distinguish ready, in progress, completed and unavailable from actual records. No eBay sale, NFC result, print success or current valuation is synthesized for visual completeness.

## Wrong turns to reject

Do not substitute a reskin for removing repeated decisions. Do not copy Apple's product imagery, brand or control chrome. Do not reduce target sizes merely to achieve thin graphics. Do not turn the report into a theatrical military display: precision should be legible in the saved evidence. Do not hide recovery behind clever gestures. Do not remove measurement transparency; move it to where the user asks for it. Do not call a local prototype a deployed or human-accepted workflow.

No preference question blocks the first working preview: Mark has already specified the sequence, large evidence, single green action and freedom to refine color. Hardware acceptance and the real-card feel remain facts to establish during testing.

## September 29 customer report and staff workflow build

Mark explicitly authorized implementation of both experiences after reviewing the motion concept. He subsequently accepted the independent design review's all-findings recommendation: “Then it's done, we show all of them right?” The public report now has an approved **Whole card → Finding** direction, plus a direct **Centering** view. Every individual red saved trace and its connected numbered/named silhouette callout is visible in the initial desktop overview. Selecting any trace or label opens that finding directly. On return, all individual labels reappear and restrained emphasis remembers the last inspected finding. On phones, all traces remain on the photograph and the complete individual index sits below it. Unlocated findings remain reachable without an invented position.

This owner acceptance supersedes the earlier location-grouping design, including its default grouped overview and customer-facing grouping toggle. Label columns follow physical position with clear spacing and fine neutral leaders; selection or focus emphasizes the relevant connection without hiding the other findings. All 13 historical Abomasnow Back finding identities and all individual measurements remain unchanged. Limited screen space changes label placement rather than merging or concealing evidence. The earlier grouped-overview validation remains historical; this amendment does not claim that the all-findings correction has completed validation.

Finding inspection shows the precise marked view and the same unmarked photograph at identical zoom and position. Screen-space calipers label marked width/height separately from measured owned damage and its recorded grade effect. A saved trace may include pixels excluded by card clipping or overlap assignment; marginal grade effects must not be added together. Centering shows both saved outlines, the centerline, four actual border widths and saved ratios. Full precision, complete calculations, exact-report links and print disclosures remain available.

The staff path remains **Front → Back → Findings → Grade → completion**. The reviewer can jump back through visible steps or keyboard shortcuts after drafts and pending commands are handled safely. Task title, save status and any blocking reason stay visible; editing tools are contextual. A selected defect can be compared with the synchronized clean view. Only the final explicit grade approval publishes the current saved report; navigating, panning or switching evidence never approves it. Completion shows actual Label, NFC and market-reference states.

The implementation is in the existing manual-workspace and staff components, not a second grading system. Actual public approved historical snapshots drive the customer preview; staff demonstrations use disclosed synthetic fixtures. Local browser/test evidence is recorded in SESSION_LOG. Production deployment is now authorized; release evidence and real-card operator acceptance remain separate facts.

## Owner-approved fingerprint tide and release

Mark approved the working fingerprint tide study and requested the established ATLAS brand gold `#cda955`. The new report view preserves each side's approved trace masks in canonical card coordinates, derives a reproducible contour field from that geometry and expands/withdraws it using the approved tide motion. Its named Card fingerprint entry remains discoverable beside the ordinary evidence views. First explicit opening reveals the fingerprint; returning restores the unmodified photograph and complete individual finding overview. It does not obstruct report arrival or a deep-linked finding. Front and Back stay distinct. Reduced motion, interruption and print restoration remain requirements.

The consistent ATLAS styling belongs to the brand; the actual recorded geometry determines the varying pattern. Report IDs, timestamps, grades and decorative random seeds must not substitute for evidence. Empty masks produce an honest no-recorded-defects state. This feature visualizes saved condition and does not establish physical uniqueness or automatic recognition across photographs. Original photographs, image readiness, grading calculations and publication authority stay unchanged.

The private approved study and gold update are recorded in SESSION_LOG. The production integration's algorithm version, performance bounds, tests and serving identities are now recorded in the release audit and report preview handoff. Historical authored-polygon/hash-whorl experiments remain separate from this evidence-derived feature.
