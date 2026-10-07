# Cinematic Vault customer preview — 2026-09-10

The first playable art-direction slice is running at **http://127.0.0.1:55497/?experience=cinematic** on Mark's Mac. It uses the real local Vault machine service with a temporary synthetic 72-door inventory and mock payment/controller/cloud adapters. This is local software evidence, not a tested physical unlock or live Nayax integration.

## Try it

Choose Sports or Pokémon, choose a price tier, and touch a door or its numbered label. The bottom HUD keeps exact selected door numbers, line prices and the tax-inclusive total visible. Review order opens a focused purchase review. Pay performs a simulated payment using the existing checkout and payment handlers. Only the exact authorized paid doors receive the preview hinge/reveal animation. OPEN DOORS retains the existing once-per-order retry, and Done returns to shopping. Sold stock becomes unavailable.

The top-right Experience settings control offers optional sound, reduced motion, Automatic/Rich/Lightweight rendering and a live browser frame-rate/p95 readout. The hidden staff gesture remains ten taps in the top-right corner for this preview; service entry and operations use the existing protected interface.

To launch another disposable preview, use Node 20 and run `pnpm vault:cinematic` from the repository root. The command prints its new loopback URL. Ctrl+C ends that preview and removes its temporary database. Do not treat an old port as permanent. The prior flat preview at 65353 remains a separate older process; use the cinematic link above for this work.

## Delivered slice

- Three actual 3D doors per gallery page: beveled titanium and gold frames, shadow gaps, real cavity geometry, handles, hinge barrels, illuminated insets, local detailed metal artwork and engraved authoritative profile labels.
- A collector's gallery environment with architectural reveals, overhead light tracks, physically based metal shading, environment-map reflections, dynamic shadows, flooring and a physical foil-pack display.
- Two original generated 1024×1536 artwork assets: pack-front.png and door-surface.png. The pack artwork is concept packaging; the surface design is art direction, not a manufactured door or CAD specification. Prompts/provenance are recorded in `frontend/vault-kiosk/public/art/vault/ASSETS.md`.
- Native HTML buttons track the projected 3D doors. Mouse, keyboard and touch actions use stable inventory IDs. Hover highlights respond immediately; camera focus follows a service-confirmed selection. Review and retrieval have controlled camera transitions. Reduced motion disables camera/hinge interpolation.
- Collection/tier discovery, paged exact-door selection, persistent multi-item order HUD, native modal review, simulated payment, paid-door reveal, support/retry/Done and a usable no-WebGL fallback.
- Cinematic assets and code are lazy loaded. The preview activates only with the explicit query and a CERTIFICATION/SYNTHETIC service snapshot. Production and staff views retain their existing behavior.

The gallery is **not a physical cabinet map**. It groups three matching product doors for this focused interaction study. Physical sizes, cutouts, final CAD, relay mappings and cabinet-wide navigation are not changed. The existing full profile map remains available outside the cinematic query. Orders may contain additional doors beyond the three shown; the review/paid receipt lists the complete exact order.

## Correctness fix found through hands-on testing

After an empty attract screen idled for at least 70 seconds, the original `/cart/select` could return HTTP 200 with an empty cart: selection committed, but `publicState()` immediately applied the old idle deadline before the kiosk's debounced activity update arrived. Direct selection and Pick for me now update the public activity timestamp inside their existing validated cart transaction. Both new tests failed before the fix and pass afterward; later unpaid idle expiry still works. Payment/authorization/command policies are unchanged.

## Evidence

- Kiosk TypeScript/Vite build passes. Three.js and its types pinned to 0.180.0. The lazy 3D chunk is about 514 KB raw / 132 KB gzip; Vite reports the expected >500 KB chunk advisory. Artwork is served locally (about 6.9 MB total PNGs), with no external asset dependency.
- 95 kiosk tests and 109 machine tests pass.
- All 17 existing browser layout/recovery scenarios pass.
- Four new cinematic browser scenarios pass at 1920×1080, 1280×720, 768×1024 and 390×844: mouse and single-touch exact-ID selection, unavailable door, category/gallery changes retaining the cart, modal focus, exact checkout/payment, paid reveal, one retry, Done, unknown-payment recovery and local artwork loading.
- Additional no-WebGL selection and idle-warning-over-review checks pass. The review closes before idle recovery takes focus.
- Screenshots and browser-validation.json: `outputs/vault-cinematic-2026-09-10/`. Screenshots were visually inspected; mobile scene ordering was corrected after inspection.
- Live local-service D9 and D1 simulated purchases reached the exact paid label and $27.06 total during development. The final process at 55497 includes the idle fix; final first-touch/checkout verification is recorded in the session log.

## Rendering and hardware qualification

Three.js/WebGL2 is the provisional rendering approach for this slice. It combines real geometry and animation with generated surface art; no Blender installation or external asset service is required to run it. Environment reflections are prefiltered room lighting, not ray tracing or screen-space reflections. No expensive full-cabinet renderer or postprocessing stack was introduced.

Observed on this Mac's Chrome browser at 1019×731 CSS pixels, device pixel ratio 2, capped render scale 1.5: approximately 119–120 fps, foreground p95 frame intervals around 9.7–9.9 ms, 283 draw calls and 28,126 triangles. These are requestAnimationFrame/cadence measurements, not GPU timestamps or touch-to-photon measurements. Headless screenshots are not hardware performance qualification.

Automatic quality starts at a capped 1.5 render scale. After two slow foreground sample windows (p95 >28 ms), it drops to 0.85 and disables dynamic shadows. Rich and Lightweight are explicit comparisons. Rendering skips hidden-tab work. Context failure falls back to native exact-ID door controls. Performance details live in the optional settings panel, not the purchase flow.

**SER5 + physical touchscreen measurements remain pending.** Before selecting production rendering quality: run this same build on the SER5 at the actual touchscreen resolution (expected 1920×1080), record OS/browser/graphics driver/DPR, warm for 30 seconds, then measure at least 60 seconds while changing tiers, paging, selecting/removing and reviewing. Compare Automatic/Rich/Lightweight, check a sustained session for thermals, verify real touch targets and latency, and record frame p95 alongside the visible result. Target smooth 60 Hz use; the measured result decides the final quality level and whether further optimization is needed. The Mac result cannot close this gate.

## Remaining work

Owner visual/gameplay feedback comes before cabinet-wide expansion. Final physical packaging art, cabinet/door spatial matching and production rollout remain later work. Nayax still uses mock adapters: official Marshall SDK/test setup and integration/qualification remain required. Real controller actuation, electrical qualification and the first physical lock test are not completed by this preview.
