# Ten Kings Vault — portrait comparison B

> September 16 continuation: [fresh integration lead handoff](INTEGRATION_LEAD_HANDOFF_2026-09-16.md) is now current. Mark accepted the UI and requested an Astra Ultra lead with three Astra xhigh workers. It supersedes old team/source/UI-priority instructions. The September 16 check found the old local preview stopped; earlier running-process claims below are dated history.

September 10, 2026. Owner concept implemented as a separate playable synthetic preview.

- **Version B:** http://127.0.0.1:55497/?experience=portrait
- **Version A:** http://127.0.0.1:55497/?experience=cinematic

Both use the same running local simulator, inventory and cart. Version A is linked from Experience settings. The original cinematic scene remains available. The original process (session 62822) later stopped. It was restored on September 10 at the same port using a detached Node process, PID 67243, with fresh sample inventory. Log: `/Users/markthomas/Library/Logs/TenKingsVault/portrait-preview.log`; PID record alongside it. It runs independently of the task terminal and still requires the Mac/process to remain running; no automatic login/restart service is installed. To recreate the same URL after stopping the preview: `pnpm vault:cinematic -- --port 55497`. Without `--port`, the launcher chooses an available port.

## Experience

The current shopping screen follows Mark’s cleanup mockups: a smaller header with his original logo, All packs / Sports / Pokémon filters, and a horizontal shelf of pack images with compact names and one price beneath each. Six category/price-verified assets cover $25, $50 and $100 (four pouch photographs and two existing product artworks); $250 retains labeled preview artwork. Native touch swiping, mouse dragging, arrow controls and keyboard navigation browse the shelf without selecting doors. A pack tap changes the active product and gold/check feedback. Pokémon $100 remains the initial choice when no order exists. At 1080×1920 the top measures about 550px, versus the former 948px; the door section receives the rest. Smaller previews use a 260px minimum discovery section. Matching doors illuminate without changing position. Other products and unavailable inventory are dimmed and individually labeled. Selected doors stay clear when switching products. Prices/counts, tax and selections come from the existing service and App handlers.

The lower wall uses Mark's confirmed four columns, seventeen rows and 6 × 2.5-inch door faces. Customers can swipe/scroll, jump using the miniature cabinet map or use Next matching. Smaller preview screens add space between rows for 44-pixel hit areas while preserving face proportions. The map is a secondary precision control; large doors, scrolling and Next matching remain available.

Review shows exact selected IDs, product names, subtotal, tax and total. After checkout, the top half becomes the payment/collection panel and the lower half keeps the door wall visible. Exact paid doors animate open only when authorized synthetic service states permit the preview reveal. Recovery, unresolved-payment messaging, one permitted retry and Done reuse the existing PaidFlow and service actions. No real charge or physical unlock is implied.

## Authority and rendering

This view only runs with explicit `experience=portrait`, CERTIFICATION mode and SYNTHETIC provenance. The test service still has 72 doors: the first 68 service-ordered IDs fill the visual slots; four extra simulator doors are outside this comparison. Printed physical label order and hardware addresses are not qualified or changed. Existing sales retain their exact items, including items selected in version A. No profile/CAD, Nayax adapter, lock configuration, V2 platform or production deployment changes.

The Three.js renderer now draws the door viewport during shopping; the removed hero-pack viewport is inactive. Product images use restrained CSS perspective, lighting, shadows and press/selection transitions. Machined frames, real face thickness, hinge pivots, handles, screws, crimped packs and display architecture are geometry; local generated artwork supplies foil and brushed metal detail. Static mesh/material batching and visible-row culling reduce drawing cost. Optional sound, reduced motion, automatic lighter rendering and native no-WebGL controls are included. Settings show local frame metrics. No performance measurement has been made on the SER5 or physical touchscreen.

[Runtime artwork and exact generation prompts](../../frontend/vault-kiosk/public/art/vault/ASSETS.md) record both new assets, their paths, dimensions and built-in-tool provenance. The manifest distinguishes original generated concepts from the owner logo, existing actual pouch photographs and product artwork used in the new shelf.

## Validation

TypeScript/Vite build and all 95 kiosk tests passed. The portrait browser suite exercises 1080×1920, 540×960, 1280×720 and 390×844: compact shopping proportions, proportional faces, visible checkout without page overflow, 68 slots, stable placement across product choices, one-touch exact-ID selection, last-row navigation, tax-inclusive review/modal focus, exact paid reveal, one retry, Done, unavailable stock, unknown-payment recovery and local assets. No-WebGL selection and idle-warning-over-review recovery are included.

Screenshots and detailed results: `outputs/vault-portrait-2026-09-10/`. Commands: `pnpm --filter @tenkings/vault-kiosk build`, `pnpm --filter @tenkings/vault-kiosk test`, `pnpm --filter @tenkings/vault-kiosk test:portrait`, and `pnpm --filter @tenkings/vault-kiosk test:cinematic`.

Hands-on in-app testing selected D6 once, reviewed Pokémon $100 + $8.25 tax, and reached exact paid D6/$108.25 through the actual running local simulator. D1 was consumed in the earlier version A test; D6 was consumed in this version B test. Other stock remains available for owner exploration. Browser fixtures use their own isolated synthetic service state.

Final review: both the four portrait and four original cinematic viewport flows pass, as do both fallback/idle-recovery scenarios. The revealed pack uses frozen sale-category metadata after inventory clears its product ID. Final in-app sample was approximately 120 fps / p95 9.5 ms, 222 draws, 50,080 triangles and render scale 1.5 on this Mac preview. This is a local observation, not a SER5 hardware benchmark. The portrait tab is marked deliverable with an empty cart ready for owner testing.

Recovery verification: no listener was present at 55497 before restoration. The fixed-port stocked HTTP smoke passed 453 events, exact selected-door initial/retry and max one concurrent command. The restored owner tab loaded the complete 3D view; D6 selection showed $108.25, removal returned to an empty cart. No owner-preview payment was performed during recovery. Existing prior purchase examples above are historical; the restored simulator starts freshly stocked. No Wi-Fi is required for these local assets or mock services.

## Compact shelf cleanup — final verification

The final build and all 95 kiosk tests pass. The expanded portrait browser suite passes at 1080×1920, 540×960, 1280×720 and 390×844, including native touch swipes, mouse dragging without accidental selection, category filtering, keyboard navigation/selection, all six matching local pack assets, original exact-door payment/retrieval checks, and no-WebGL/idle recovery. Original cinematic A passes all four viewports and fallback/idle recovery. New screenshots and browser measurements: `outputs/vault-portrait-cleanup-2026-09-10/`. At 1080×1920 the discovery region is 549.55px (42% shorter than the original), and the actual door viewport is 961.27px, showing nine complete rows and part of the tenth. Automated rendering metrics were collected while concurrent browser suites ran; they are not hardware performance qualification.

In the running local owner preview, selected D6, checked the unchanged review showing Pokémon $100 + $8.25 tax = $108.25, closed review and removed D6. The updated tab is marked deliverable, with an empty cart and the existing inventory intact. No payment or physical unlock was performed in the owner preview during this cleanup. The simulator process was not restarted.
