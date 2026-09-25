# ATLAS homepage — design and copy proposal

**Status: proposal for owner review. Plan only; no homepage implementation or deployment.** Prepared September 25, 2026 against local source `76f7d8e5` and a live, unauthenticated desktop Chrome review of `https://atlasgrading.com/`. The recorded application release remains `e4a75df5`. This document proposes presentation and possible future product scope; it does not amend the approved blueprint, approve reports, activate commerce, or authorize publishing customers' cards.

## Recommendation

Make ATLAS feel like a beautifully presented instrument: a remarkable physical card, exceptionally clear evidence, and an experience the visitor can operate immediately. Use the supplied gold fingerprint-A logo as the signature. Build the page around **one real, human-approved report**, then show how someone gets that experience for their own card.

The headline should be:

> **Know the grade.**
> **See the evidence.**

The strongest substantial upgrade is a shorter, more confident page with better photography, one useful interactive centerpiece, and precise language. The existing gold identity is worth keeping. Its credibility improves when the evidence carries the persuasion. Remove the borrowed luxury positioning, simulated certifications, imaginary network and absolute anti-fraud claims from the proposed design.

Lead with the report and a restrained real-card hero. Follow with a concise explanation, service comparison, and a small curated selection of permitted public reports. Defer public comments and collector-to-collector offers. Consider private saving before public likes. This sequence builds a grading brand before taking on the responsibilities of a social network or marketplace.

## What the current page actually does

The live desktop page was opened and its Charizard interaction was exercised. No sign-in, staff page, grading action, form submission, account change or provider mutation was performed. This inspection is not mobile acceptance or a fresh production report census.

Useful foundations:

- Strong black/gold palette, memorable card imagery and an ambitious interactive presentation.
- Existing submission/account routes and a separate public report application.
- Approved report software substantially more capable than the homepage's simulated examples.
- Existing owner-approved `atlas-signature-v2` label artwork, with the gold fingerprint-A, emphasized player/character name and plain black reverse.

The principal problems are specific:

| Current observation | Why change it | Proposed treatment |
| --- | --- | --- |
| The first screen is a large illustrated card composition; the service promise and main headline appear later. | A newcomer must decode the artwork before learning what ATLAS offers. | Put a clear promise, usable report link and submission action in the first screen. |
| The header uses a simple outlined A; the shared public brand asset is the earlier globe artwork. | The website and Mark's supplied fingerprint-A have different visual identities. | Use the exact supplied fingerprint-A artwork consistently within the approved redesign scope. |
| Kobe, Charizard and Brady profiles have hard-coded grades and measurement examples. The interactive example leads to `#atlas-record`. | It looks like a report but does not open a real approved card record. | Feature a permitted production report, with its real version and evidence. Keep any explanatory illustration plainly labeled. |
| The journey displays `00:00` through `48:00`, despite being labeled illustrative. | A clock is a stronger service promise than a small qualification below it. | Use four named steps without invented elapsed times. Put the actual service terms in their own comparison. |
| The illustrative map contains six example locations. | It resembles an operating network. | Use only the real configured directory; contact-only entries retain that status. |
| Claims include perfect repeatability, discovery of every flaw, unique defect fingerprints and an unforgeable label. | Source qualification does not establish these broad claims. A static NFC link is not cryptographic authentication. | Explain what photographs, reviewed findings, calculations and the NFC link actually provide. |
| A long sequence of competitor criticism repeats the argument. | It asks visitors to accept claims about others instead of examining ATLAS. | Replace it with a short account of the method and a working evidence explorer. |

The current marketing component is approximately 1,493 lines with 7,901 lines of scoped styling. That is an implementation observation, not a performance measurement. A later rebuild should replace the approved homepage composition coherently instead of layering another animation system onto every existing section.

### Existing capability versus proposed scope

| Capability | Evidence and limits |
| --- | --- |
| Versioned human-approved public reports | Implemented at `/reports/[token]?v=[approvalVersion]`; public V2 projection binds report, version, images and reviewed findings. A page is not physical finishing evidence. |
| Interactive inspection | Existing renderer supports Front/Back photographs, zoom/pan/pinch, finding selection, saved outlines, geometry layers, category filters, measurements, calculations and finding links. Reuse these behaviors. |
| Grading explanation | Existing report explains Front/Back weighting, category contributions, raw calculation and final half-point policy. Marginal finding effects are explicitly **not additive**. |
| Report printing | Browser print/save PDF is implemented. This is a report copy, not proof of printing a physical label. |
| Actual graded-card photograph | Optional presentation-photo support exists, separately bound to the public approval. A slab photograph must be an actual photograph; it does not replace inspection evidence. |
| Market references and dealer offers | Presentation contracts support selected sourced sales and specifically configured firm/indicative dealer offers with amount, currency, terms and expiry. This does not establish real current offers or a customer marketplace. |
| Homepage report selection and customer showcase | New presentation/curation work. No verified eligible production report or marketing permission was identified in this bounded review. This is not a claim that the production database is empty. |
| Likes, comments, member profiles, collector offers | Proposed new product scope. Not established by the current public report renderer. Marketplace behavior remains a separate owner decision under the blueprint. |
| Live submission services | Recorded release enables customer intake/identification; commerce, dealer operations and physical stations remain disabled. CenterCourt is contact-only. Homepage copy must honor actual availability. |

## Art direction: precision, material, restraint

Use a near-black stage, warm ivory typography and controlled gold details. The card's real colors provide the visual energy. Give photography space and let the interface feel precise through alignment, legibility and response—not through constantly moving numbers.

The supplied PNG was inspected directly: it contains a large metallic gold A with fingerprint ridges, the ATLAS wordmark and GRADING lockup against black. Preserve its proportions, metal texture and fingerprint detail. Do not replace it with a generic A, globe, generated imitation, or an animated reshaping of the mark. The current repository also contains the previously approved owner logo in `packages/atlas-finishing/assets/atlas-grading-logo.png`; confirm the selected master against the newly supplied PNG before deriving web sizes. This proposal does not assume that the two files have identical bytes.

Suggested visual specifications, to be refined in a static design review:

- Background `#080807`; slightly raised panels around `#131310`; ivory `#F5F1E7`; gold accent around `#CDA955`. Use gold for a small number of actions and evidence highlights. Body copy stays ivory or a legible warm gray.
- Use the existing Manrope/Atlas Sans family for clear, confident headlines and prose. Keep mono type for report identifiers, units and short evidence labels. A restrained Instrument Serif italic can provide one editorial accent; do not mix multiple display treatments in every section.
- Desktop content width about 1,240 px with 48–64 px gutters. Hero heading about 88–104 px, compact line height. Mobile heading about 46–56 px with 20–24 px gutters. Body copy 17–19 px. These are design targets, not fixed text sizes that ignore zoom or long content.
- Prefer flat sections, a strong typographic rhythm and fine rules over repeated rounded feature cards. Use one generous product stage and one clearly bounded inspection workspace.
- One actual card/slab hero with a believable resting angle, soft contact shadow and real captured reflections. Do not counterfeit holographic effects, expose a made-up slab reverse, alter a photographed defect or invent card geometry to achieve a 3D turn.
- Keep inspection photographs flat, neutral and free of decorative reflections. A visitor must immediately understand when they are looking at the physical object versus its measured evidence.
- Use the approved label design unchanged if the photographed specimen has that design. Do not composite a newer label onto a customer's older slab or imply physical finishing has occurred.

If no qualified real slab photograph is available, the hero should use the selected public inspection photograph in an honest image frame, accompanied by the real report identity. It should not manufacture a completed slab.

## Page narrative and proposed copy

The following is proposed copy and layout. Bracketed fields are unresolved bindings to real report data, not names, grades, customers or activity to fabricate. The full launch version depends on the evidence and service gates below.

### 1. First screen: understand the offer and see the product

Desktop: roughly 45% copy, 55% card stage. Mobile: promise and two clear actions, then the card. Avoid a full-screen art-only introduction, autoplay audio, forced scroll story or loading curtain.

Navigation: exact ATLAS artwork · **Explore a report** · **How it works** · **Services** · **Your account** · **Grade your cards**.

> ATLAS GRADING
> **Know the grade.**
> **See the evidence.**
> Your card's photographs, reviewed findings and grading calculations—together in a report you can explore.
>
> **Grade your cards** **Explore a real report**
> Sports cards and Pokémon. Choose mail-in or an available authorized drop-off location.

The card stage shows `[actual card name]`, `[awarded grade]`, `[report number]` and **Human-approved report** only when backed by the selected public packet. The useful invitation is **Inspect this card**, not an unexplained drag gesture. An approved date/version appears with the report rather than becoming a decorative authenticity badge.

A narrow strip immediately below the hero makes price discovery easy: **Mail-in · $40/card + shipping** and **Dealer drop-off · $50/card** with **Compare services**. Availability is explicit. Do not rely on animation or clicking a card to discover these terms.

Current preview-state copy must differ from final operational copy: **Submission intake is in preview. Checkout and dealer drop-off are not yet open.** An existing permitted customer can still open their account and save available draft intake. Do not imply unrestricted signup, take payment, open a waitlist, or promise an operational drop-off through a new homepage button. Root should connect the approved homepage CTA to the actual access/availability contract at implementation time.

### 2. The centerpiece: follow one real finding

> INSIDE AN ATLAS REPORT
> **See what shaped the grade.**
> Choose a finding to see its photograph, saved outline and measured effect. Then follow the category scores through to the final grade.

Show a compact interactive preview of one explicitly selected approved report. Four plainly labeled views: **Card**, **Findings**, **Centering**, **Grade calculation**. The complete report remains one click away, with an ordinary URL that works without JavaScript.

The first useful interaction should take less effort than understanding a simulator: tap **Explore a finding**, inspect the same saved photograph and outline, then tap **See the calculation**. Show real values only. If the selected report has no included damage findings, use its centering and grade explanation; never add a mark just to make the demo interesting.

Suggested supporting copy:

> **The mark. The measurement. The reason.**
> Zoom into the saved image. Turn the outline off to see the photograph clearly. Open the calculation to understand how the reviewed evidence contributes to the result.

Microcopy: **Front** · **Back** · **Show outlines** · **Fit image** · **Open full report** · **Link to this finding**.

### 3. A brief explanation of the method

> THE ATLAS METHOD
> **Measured by software. Reviewed by people.**

Three concise editorial columns, each paired with a real crop or a clearly diagrammatic icon:

1. **Capture the detail.** Front and Back photographs preserve the evidence used for review.
2. **Review the findings.** Software proposes findings. A human inspects the images, corrects the record and approves the final report.
3. **Show the calculation.** Centering, corners, edges and surface contribute to the result under the report's saved grading rules.

Then a short link: **Explore the grading rules in the report.** Do not show a second hard-coded grade calculator. Do not claim infinite optical precision or a guarantee that every defect was detected.

### 4. Service choice, with honest operating status

> GET YOUR CARDS GRADED
> **Choose the route that works for you.**

| Mail-in | Authorized-dealer drop-off |
| --- | --- |
| **$40 per card + shipping** | **$50 per card** |
| **Two-week service** | **One-week service from ATLAS collection** |
| Send your cards using the confirmed shipping instructions. | ATLAS collects and returns cards through the selected operational location. |
| **See mail-in details** | **Find a drop-off location** |

These are the owner's service/pricing requirements, not proof that either checkout path is operational. The full launch component must use the service configuration shared with submission; do not create a competing marketing price source. Mail turnaround start and charged shipping directions are unresolved. Do not silently redefine them. The exact tax/shipping total belongs at configured checkout before payment.

Keep each service film as a subordinate, optional visual if useful. The current generated films are illustrative. Label them accordingly and do not present them as footage of CenterCourt or an operating ATLAS collection route. Real collection/receipt/return footage should replace them once it exists and is approved for promotion.

The real dealer map belongs inside this section or behind the finder action; root owns its separate implementation. Zero operational locations produces **Drop-off locations are being prepared** and a directory link. A mapped contact-only partner never becomes an available location merely because it has a pin.

### 5. Four steps without a fictional countdown

> FROM FIRST PHOTO TO FINAL REPORT
> **A clear next step at every stage.**

**Photograph & submit → Send or drop off → Grading & human review → Report & return**.

> Start with Front and Back photographs. Follow the confirmed instructions for your service. Your account shows recorded progress as your cards move through the process.

Use an actual customer-tracker image only after removing private information and obtaining the relevant permission. Otherwise use a plain diagram explicitly labeled **Process overview**. Upload completion is not physical receipt; a grade report is not evidence of shipping or slab assembly. Avoid promises of live GPS tracking or precise completion dates unless implemented and operationally supported.

### 6. Selected reports from real cards

> THE ATLAS GALLERY
> **Real cards. Reports you can explore.**
> A selection shared with permission. Open any card to inspect its approved report.

Start with three to six manually selected cards when that many eligible cards exist. A single excellent report is enough to launch the proof-led page; the gallery can be omitted until there is a collection worth showing. Do not fill empty spaces with synthetic customer activity.

Each tile shows a real photo, exact card identity, awarded grade, report number and **Explore report**. Optional customer credit is a separately permitted display alias. There is no public owner name, hometown, contact information, submission number, declared value or selling status by default.

Use **Selected reports**, rather than **Just graded** or **Live feed**, unless publication dates and a real updating feed establish those claims. A balanced selection should include different grades and useful evidence, not imply that ATLAS only awards high scores. Any ATLAS-owned demonstration card is labeled **ATLAS collection**; sponsorship or employee ownership is not disguised as customer enthusiasm.

### 7. Closing invitation and useful questions

> **Know what you have.**
> Start with your card. Explore the detail. Keep the report.
>
> **Grade your cards** **Explore a report**

Keep the FAQ to questions a prospective submitter actually needs: accepted card types, service availability, what the report contains, how photographs are used, when turnaround starts, and what an NFC link does. Link actual terms/support policies when supplied. Do not invent insurance, authentication guarantees, cancellation rights, reimbursement levels or turnaround exceptions as marketing filler.

For NFC, use: **Tap to open the approved report** only for a qualified equipped slab. Supporting explanation: **The link helps you inspect the saved photographs and report. A tap alone does not prove ownership or authenticate the physical card.** Avoid a separate anti-counterfeit spectacle.

### Layout wireframe

This is a structural wireframe, not a sample customer/card record. No bracketed field is publishable data.

```text
DESKTOP
┌ Logo ─ Explore a report ─ How it works ─ Services ─ Account ─ Grade your cards ┐
│ KNOW THE GRADE.                    [real permitted photograph]              │
│ SEE THE EVIDENCE.                  [real card identity + awarded grade]     │
│ Short explanation                [Inspect this card]                        │
│ Grade your cards | Explore report                                           │
├ Mail-in price ───────── Dealer price ───── Availability / Compare services ┤
│ SEE WHAT SHAPED THE GRADE                                                   │
│ [Front / Back verified image]     [actual selected finding + explanation]   │
│ [Card | Findings | Centering | Grade calculation] [Open full report]        │
├ Measured by software ───────────── Reviewed by people ──────────────────────┤
│ Service comparison + real directory availability                            │
│ Four named submission steps                                                │
│ Selected reports [real tile] [real tile] [real tile], only when permitted   │
│ Useful questions ─────────────── Know what you have / final actions          │
└────────────────────────────────────────────────────────────────────────────┘

MOBILE: same narrative, single column. The evidence preview has a visible
Front/Back switch, ordinary scroll outside the image, and Open full report.
No forced horizontal story, hover-only text, full-screen scroll trap, or
swipe-only route to an essential action.
```

## Make the real report demo actionable

### Select evidence before producing the final hero

No eligible production public report was verified in this review. The current homepage's three hard-coded card profiles are not eligible proof. Do not use old intake photos, machine proposals, fixture reports or a screenshot that merely resembles an approved report.

The next content step is a real human-approved report chosen by Mark or an authorized content owner. For that selection, verify:

- Actual `PRODUCTION` public packet, exact public token, approval version and public hash; real publication succeeds through the existing public reader.
- Both approved inspection images and any selected finding/crop belong to that exact report. The public V2 inspection derivatives are 1350×1858; the homepage must not describe them as untouched full-resolution originals. The retained source originals stay unchanged.
- The chosen illustration demonstrates an actual recorded finding or actual centering. No invented grade, outline, value, physical slab, customer name or receipt.
- Separate promotional permission for homepage featuring and the chosen images; public report availability alone does not constitute that permission.
- A supplied real slab photo if the art direction shows a finished slab. Otherwise use the real report photograph without a fabricated enclosure.

### Reuse the existing authority, add a small presentation layer

The full approved report remains authoritative. A later homepage implementation should read an explicit curated allowlist of approved report references rather than enumerate all customers or list every public token. Start with one selection, not a CMS or public search database.

The selection contract needs only exact report reference/version/hash, an optional actual finding ID, display order and active/withdrawn status; keep consent evidence and internal customer references private. Use the public reader's allowlisted projection. The homepage has no staff access, grading callbacks or model calls. No new report/grade copy becomes authoritative.

Reuse `ApprovedReportView`, `ReportInspectionImage` and the existing explanation/helpers as far as possible. A compact homepage wrapper is new UI work; it is not currently a drop-in four-tab demo. Keep report number, approval version and an ordinary **Open full report** link visible. Existing finding fragments can link directly to the exact saved finding. Use same-origin component composition rather than an iframe with nested scrolling.

A selected finding can transition once from full card to its saved crop. The outline and displayed measurements always come from that same report. In calculation view, explain the category/overall relationship accurately; do not animate a subtraction of independent defect deductions if the underlying marginal effects are non-additive. Do not animate an awarded grade upward as a reward.

When selected evidence is unavailable or the binding fails, show a quiet unavailable message and preserve navigation. Do not substitute an invented card or silently show a newer approval under the old selection. A later revised report requires deliberate reselection or an explicit version treatment. Removing a card from homepage promotion is separate from retaining its historical approved report.

## Motion with a job to do

The desired impression is physical realism and precise response. More movement is not automatically more premium. Use one focal animation per viewport and make the main actions immediately usable.

| Moment | Proposed movement | Purpose and fallback |
| --- | --- | --- |
| Hero arrival | A single 700–900 ms reveal with a small translation and settled shadow; no endless card orbit. | Establish the object. Static final composition under reduced motion. |
| Product material | Ideally a short authentic recorded light sweep over a real slab, played on request. A real-photo desktop tilt may use the existing ±4° limit. | Show real material. No synthetic foil/defect changes. Touch uses a stable image and explicit Front/Back controls; no device-motion permission. |
| Choose a finding | 180–250 ms movement to the selected saved region; the matching annotation becomes visible. | Preserve spatial context. Immediate switch when motion is reduced. A labeled list remains an alternative to precise tapping. |
| Evidence overlay | Short opacity change between saved photograph and its actual outline. | Help the viewer separate the mark from annotation. The original photo never receives decorative glare. |
| Grade explanation | Reveal the relevant source values and category relationship on selection. | Explain computation. Values are stable and readable; no count-up scores or simulated analysis progress. |
| Service/process section | Small state change when the visitor chooses a route; optional user-controlled illustrative film. | Clarify the route. No clock implying a guarantee and no moving map pin implying actual custody. |
| Gallery | A slight image lift on pointer hover, keyboard focus ring, and explicit report action. | Indicate clickability. No auto-scrolling wall, countdown or invented popularity motion. |

Provide a persistent **Motion on/off** control when decorative motion is enabled, honor OS reduced-motion preferences from first paint, and stop nonessential video/animation offscreen or when the tab is hidden. No autoplay sound. Keyboard and touch can reach every essential control; use 44×44 px practical touch targets and visible focus treatment. Outside an explicitly engaged inspection canvas, mobile gestures continue to scroll the page normally.

W3C requires pause/stop/hide controls for qualifying automatic motion lasting more than five seconds, and its interaction-animation guidance recommends allowing nonessential motion to be disabled. Treat reduced motion as a complete static composition, not an animation sped up to almost zero. These motion recommendations go beyond a claim of basic AA conformance; this document is not an accessibility audit. [W3C pause/stop/hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide), [W3C interaction animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).

Proposed performance budgets, to measure during implementation: hero poster around 250–350 KB, roughly 1 MB initial page transfer before optional report evidence/video, and no report viewer bundle loaded merely to paint the navigation. These are design budgets, not measured current results. Lazy-load additional images and the detailed explorer on proximity/intent, reserve media dimensions and keep the first heading/action server-rendered. Report image integrity checks remain intact; a marketing thumbnail never impersonates inspection evidence. Reuse local font assets and existing packages; avoid adding a WebGL engine for a single photograph.

Validate on the owner's actual iPhone and a slower midrange mobile device as well as desktop. Target mobile/desktop 75th-percentile LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 when representative field data exists. Lab checks guide development but do not establish field success. [Google Web Vitals](https://web.dev/articles/vitals).

## The showcase and social features

The curated gallery is worth doing. It makes the work tangible and gives collectors a reason to explore. It also creates a meaningful link between the homepage and the reports ATLAS already knows how to present.

Do not automatically turn every submitted card into marketing. Ask for homepage/gallery permission separately from service acceptance and report publication. The permission should explain the selected images, report link, optional alias and public visibility; it should be optional and withdrawable for promotional surfaces. A customer declining publicity receives the same grading service. Exact permission language and retention behavior need owner policy review before implementation; this proposal does not supply a legal policy.

Initially, a staff-curated selection with a private record of permission is sufficient. A later self-service opt-in/withdrawal control is new product work. Withdrawal removes discovery tiles and promotional assets/cache references promptly while preserving the approved grading record under the service's established record policy. Do not promise erasure of immutable history or third-party copies. Images must exclude labels, addresses, hands/faces or backgrounds revealing personal details unless separately approved. Do not assume a public report link proves ownership or permission to sell.

| Feature | Recommendation | Real product cost |
| --- | --- | --- |
| Open/share report | Launch with the gallery. Use versioned public links and existing finding links. | Small presentation work; verify exactly what is public and what sharing permission permits. |
| Save a card | Best first engagement experiment after the core launch, if requested. Start with an explicitly described private saved list; local-only saving must explain its device scope. | A synchronized list needs customer identity, storage and removal behavior. It is not already implemented. |
| Likes | Optional second phase after repeat visits justify it. Do not add fake initial counts or popularity ranking. | Unique authenticated reactions, undo, abuse/rate controls, privacy choices and truthful aggregate counts. Anonymous counters are easy to game. |
| Public comments | Defer. They are not necessary to evaluate a grade. | Moderation ownership, report/block controls, spam links, harassment, deletion/appeal rules and notifications. Quality arguments can undermine confidence if nobody handles them. Existing support is a better place for a report question initially. |
| Authorized-dealer interest/offers | Consider before public collector offers, only with actual partner terms and an owner opting in. Reuse the existing exact-report offer projection where suitable. | Permission to contact, current authorized partner identity, amount/currency, firm versus indicative meaning, conditions, expiry and an actual handling process. A contact request is not a firm offer. |
| Collector-to-collector offers or purchases | Separate future product decision; omit from homepage launch. | Seller authority/current possession, account safety, offer lifecycle, messaging abuse, expiry/withdrawal, disputes, payment, custody/shipping and commercial terms. A report proves neither title nor availability. This is marketplace scope, which the current blueprint defers. |

No artificial scarcity, fictional customer count, simulated live activity, invented testimonials or fabricated sales volume belongs in the proposed design. If current services are in preview, confidence should come from demonstrable quality and honest availability.

## Credibility corrections and useful exemplars

The current copy can be stronger by being more specific:

| Replace this kind of claim | With this kind of claim |
| --- | --- |
| A borrowed luxury-brand comparison | **Know the grade. See the evidence.** |
| Every flaw is found | **Explore the findings recorded in the approved report.** |
| The same card always receives the same grade | **The saved report shows the reviewed evidence and rules used for this result.** |
| A label cannot be faked / a chip proves identity | **Tap to open the report and inspect the recorded card details and images.** |
| Every isolated mark directly costs a fixed final-grade amount | **See the measured region, its category effect and the overall calculation.** |
| Competing graders never show evidence | Explain ATLAS's own report without unsupported universal comparisons. |
| An illustrated 48-hour return journey | Named steps plus the real selected service terms. |

The competition already offers forms of transparency. TAG's own description documents grading reports with defect annotations, category information and specimen imagery, with different detail by service. That is enough to reject the current blanket assertion that other services provide no evidence. Use TAG as a benchmark for making a report accessible, not as content or grading authority to copy. ATLAS should distinguish itself through its own clear explanation and actual report interaction. [TAG report explanation](https://help.taggrading.com/en/articles/6747781-what-is-the-tag-dig-report), [TAG public report introduction](https://taggrading.com/pages/dig).

PSA separates certification lookup from a guarantee about the physical item in a seller's hands. That distinction is useful for ATLAS: make a report easy to inspect while explaining what the link does and does not establish. [PSA certification verification](https://www.psacard.com/cert).

Take visual cues from physical-product photography: real surfaces, controlled lighting, one object in focus, then close detail. This is an art-direction recommendation, not permission to imitate another company's identity or claim their guarantees. The exact ATLAS fingerprint-A and the card's own evidence are enough to make the page distinctive.

## Proposed delivery sequence and acceptance

1. **Approve the direction and content contract.** Mark reviews this proposal; select one real approved public report and permitted images. Confirm the supplied logo master, feature permission and honest service status. No new approval or grade is fabricated for marketing.
2. **Review a static composition and one report interaction.** Produce desktop/mobile design frames, then an isolated prototype after implementation is requested. Use the selected real report. Until it is available, use explicitly empty layout placeholders, with no pretend score or customer. Review hierarchy, typography, card scale, copy and touch controls before building all sections.
3. **Build the focused homepage upgrade only after authorization.** Reuse the current public app, public reader, report renderer, service source and real directory. Keep grading, identity, capture and approval rules unchanged. The separate map work remains root-owned; this proposal is not a second map implementation.
4. **Release the report-led page after real evidence acceptance.** Verify same report/version/hash, working images and finding links; no private projection; keyboard, mobile and reduced-motion flows; honest service availability; performance budgets. The exact product state dictates CTA copy. Existing deployment and preservation procedures still apply.
5. **Add a small permitted gallery once the content exists.** No minimum volume fabricated for launch. Measure report exploration and service interest. Consider saved cards/likes later; comments and offers each require a separate product brief and operating owner.

Acceptance should answer: Can a new visitor explain ATLAS in one sentence? Can they inspect a real finding within two deliberate interactions? Can they distinguish a photograph, an approved grade and an illustrative process? Can they see pricing and actual service availability without searching? Can an iPhone user scroll and explore without a gesture trap? Does reduced motion retain the complete story? Does featuring a card leave its source evidence and approved report unchanged?

Suggested success measures are report-open rate, finding/calculation engagement and progression to the existing submission flow, segmented by device. Page views and likes alone do not show that visitors understand grading. Any later measurement implementation should avoid collecting photos, card ownership, report tokens tied to customer identity or location in analytics; selecting an analytics provider is outside this plan.

### Source pointers for later implementation

- [Current homepage entry](../../../frontend/atlas-public/pages/index.jsx) and [marketing component](../../../frontend/atlas-public/components/MarketingHome.jsx): present title, illustrated profiles, anchor-only report actions and journey.
- [Homepage styles](../../../frontend/atlas-public/styles/marketing-home.css) and [shared brand styles](../../../frontend/atlas-public/styles/atlas-brand.css).
- [Public report route](../../../frontend/atlas-public/pages/reports/%5Btoken%5D.jsx): exact versioned reader, V1/V2 distinction and approved renderer.
- [Report experience](../../../packages/atlas-manual-workspace/src/FinalReportReview.jsx), [inspection view](../../../packages/atlas-manual-workspace/src/ReportInspectionImage.jsx) and [finding links/helpers](../../../packages/atlas-manual-workspace/src/report-review-ui.mjs).
- [Actual slab photograph and market presentation](../../../packages/atlas-manual-workspace/src/ReportPresentation.jsx), [presentation contract](../../../packages/atlas-report-view/src/presentation-contract.mjs) and [public V2 contract](../../../packages/atlas-report-view/src/manual-public-contract.mjs).
- [Owner-approved label renderer](../../../packages/atlas-finishing/src/label.mjs) and [retained logo asset](../../../packages/atlas-finishing/assets/atlas-grading-logo.png). The newly supplied PNG was inspected from the task attachment path; it was not copied into application assets by this planning work.
- [September 25 release evidence and acceptance limits](../audits/2026-09-25/submission-capture-release.md), [current handoff](../handoffs/2026-09-25-FRESH-ASTRA-ULTRA-LEAD.md) and [approved blueprint](../../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md).

Only this proposal file was created by the homepage specialist. No main-site rebuild, mock customer record, report approval, media generation, database operation or deployment forms part of this proposal.
