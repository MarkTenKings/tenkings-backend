# Atlas slab quality and progressive media

Status: implemented in isolated `codex/atlas-slab-quality`, with local visual qualification complete. No production deployment, database change or approval rewrite from this task.

## Implementation

The existing approved-card renderer composes saved photographs and saved label artwork at display time. This change reuses that architecture: no per-card AI generation, exported model, queue or paid rendering service.

- Gallery/detail stills request the existing 558×768 source-bound preview. The 3D module and full photographs are requested only when selected. Full replacement preserves the scene and rotation; leaving 3D cancels unfinished full reads. Ready resources remain owned by the mounted card and are disposed on access loss or departure.
- Preview and full reads retain exact source/side/version validation, hash and byte-count checks, bounded two-request admission and no-store transport. Corruption fails closed. Only unavailable preview transport may fall back to the independently verified full descriptor from the same grant.
- The shared illustrative shell has curved bevels, a two-piece seam, open card windows and a single lower support. Exterior dimensions remain 80.264×135.382×6.096 mm; interior details are illustrative. Local neutral studio reflections require no remote HDR. Rendering is event driven and pauses when hidden.
- Actual photographs and saved front/back labels remain unlit textures. Historical front-only labels stay supported. Optional load, GPU, label decode and context failures preserve available photographs and expose appropriate retry.
- Existing approved-label commit `6e74df01` is merged. The quality work does not change its approved artwork, print outputs or backend contract. After owner review, front stills and 3D now show the NFC reference above the approved B circle at its recorded coordinates. Historical transparent labels retain their original below-artwork placement. Both use the optimized shared 55,492-byte WebP instead of the 2,283,376-byte JPEG. This separate illustrative layer does not change saved label/print pixels or assert physical NFC completion.

## Measurements and limits

The retained sample front/back pair is 155,004 bytes in corrected white-composited local display previews versus 4,025,092 bytes at full resolution: about 26× smaller, or 96.1% fewer photo bytes before optional 3D. These are sample payload sizes, not a guarantee of instantaneous loading or a production/mobile timing benchmark. The fixture uses Sharp previews; production uses its existing saved OpenCV previews.

New B labels contain pinned 6458×1898 PNG artwork. The actual first fixture label transfers 902,226 front SVG bytes and 137,697 back SVG bytes without compression. Separate synthetic measurements give approximately 641 KB/73 KB gzip. Production Content-Encoding and real device decode/memory were not measured. The old vector-label figures do not apply to B.

A potential next delivery optimization is a versioned display-only label derivative made once from the exact authenticated saved SVG, bound to item, approval, side, source digest, layout and material, with original SVG fallback. A local lossless WebP experiment measured 47,438/18,116 bytes at 1024×301 and 119,440/33,344 bytes at 2048×602 for front/back. Those derivatives were not implemented or visually accepted; saved/print assets remain unchanged.

## Qualification and release

The combined staff suite passed 914/914 with no skipped tests. The production build and staff boundary check passed. Final focused checks pass 75/75; independent backend projection/label-route checks pass 12/12. Scoped lint and the final production build pass. Full-turn framing and depth precision have explicit regressions; real Chrome captures confirmed removal of oblique white carrier stripes. Real Chrome checks cover progressive upgrades, retained angle, layouts at 320/390/1024/1440 CSS px, front/back artwork, optional-chunk failure, graphics-context recovery, access cleanup, gallery/table and report-return navigation. Before the requested NFC overlay, the B scene reported 30 draw calls and 28,866 triangles; the NFC follow-up added one circle and reported 31 draw calls and 28,914 triangles. The subsequent owner-requested border simplification reduces the current scene to 23 draw calls and 22,218 triangles. During an injected six-second full-photo delay, the preview stayed interactive at 15°; after full detail arrived the angle was still 15°. Leaving 3D cancelled both pending full requests. These checks establish behavior, not production latency.

Evidence: `~/.codex/atlas-handoffs/atlas-slab-quality-20261022/`. The loopback fixture uses synthetic records/certificates and retained copies of approved public photographs. It makes no production writes. Desktop viewport emulation is not physical-phone performance qualification.

The separate label chat is actively releasing `6e74df01`. This branch already includes that source; deploy only through a fresh coordinated successor release after reconciling the live label/native/web state. No old release packet or consumed intent should be reused. Public report evidence views, public homepage scenes and printing are not replaced by this staff approved-card viewer change.

Local preview: `http://127.0.0.1:58625/admin/graded-cards/812b359f-6e01-403f-8421-b19f69e7b90a` (task-owned detached fixture process; current PID and source are recorded in `preview-process.json` in the evidence directory). Final images: `final-desktop-front.jpg`, `final-desktop-angle.jpg`, `final-desktop-back.jpg`, `final-mobile-320-3d.jpg`, `final-mobile-390-full.jpg`, `final-tablet-1024.jpg` in the evidence directory.

## Owner-review follow-up: NFC and 3D presentation

The owner’s open in-app browser already reported the v2 model/studio and full photographs, but its holder was approximately 24% shorter than the still because the 3D stage also contained controls and reserved the full rotation envelope. The 3D stage now reserves control height separately and gives the canvas 1.14 times the still height. At the observed 440 px viewport, the canvas grew from 405×398 CSS pixels / 810×796 backing pixels to 405×513 / 810×1026 at DPR 2. The same native 1350×1858 photo textures and 2048×602 label textures remain in use; photo transfer sizes are unchanged. Camera distance, full-turn framing and precise near/far planes are retained.

Fresh browser inspection confirms the visible B NFC overlay, aligned front still and 3D presentation, unobscured back and clean rotation. The loading/error fallback retains the 450 px still height within the expanded stage; injected context loss and Retry 3D passed in the actual in-app browser. Current source texture accounting is 42,025,088 bytes including the NFC texture (an estimate, not measured GPU allocation). Focused follow-up checks pass 51/51; scoped lint and the final production build/boundary check pass.

The old loopback server had stopped, leaving cached content and a failed still-shell resource in the owner's tab. The replacement preserves the shared first-card URL across rebuilds, sends no-store fixture responses and is detached from the temporary command session. Current local process is 20508 on port 58625. Final follow-up images are `nfc-front-still.jpg`, `nfc-review-final.jpg`, `nfc-back-final.jpg`, `nfc-angle-final.jpg` and `nfc-fallback-final.jpg`. Production remains unchanged.

## Owner-review follow-up: clean card edges and simpler shell

Removed the illustrative raised card-pocket ring, adjacent vertical retention rails and lowest foot rib in both still and 3D holders. The label bay, NFC, exterior dimensions, single lower support, camera and depth protections are retained. Fresh Front/Back/3D front, back and45° views show the requested cleaner profile.

The black band came from the loopback fixture converting the source's transparent inspection padding directly to JPEG. Production's preparation encoder already composites over white. The fixture now follows that ordering; its corrected sample preview pair is155,004 bytes (superseding the156,246-byte black-padded local rendition). Saved full photograph hashes and image bytes are unchanged.

The slab presentation now selects only the canonical card rectangle at40,40 with size1270×1778 within the1350×1858 inspection image. `slab-photo-frame.mjs` gates that viewport on verified source provenance, representation and frame dimensions. Stills use a clipped CSS viewport and3D uses matching normalized UVs, including fractional preview coordinates, so preview/full transitions preserve all actual card edges and printed borders. Actual slab photos and unknown representations remain uncropped; report evidence and label/print artwork are unaffected. This is shared deterministic presentation, with no per-card edits, new image exports or extra requests.

Validation:56/56 focused media/frame/scene/UI checks, scoped ESLint and the final staff production build/boundary passed. Astra xHigh reviewers inspected the final source and visual captures. Actual in-app browser reports23 draw calls/22,218 triangles (previously31/28,914), the same full-resolution source texture accounting42,025,088 bytes, and the same810×1026 canvas. Browser evidence: `border-front-final.jpg`, `border-back-final.jpg`, `border-3d-front-final.jpg`, `border-3d-back-final.jpg`, `border-3d-angle-final.jpg`; logs use the `border-` prefix. The task-owned local fixture was rebuilt/restarted successfully as PID24642 on58625 and the owner's tab refreshed. Production remains unchanged.
