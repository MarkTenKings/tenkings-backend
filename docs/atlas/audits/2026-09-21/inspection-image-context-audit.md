# Inspection image context audit — September 21, 2026 UTC

Status: source audit and proposed backend contract only. No backend change is implemented by this audit, and no proposed backend behavior is in production. No live database access, provider inference, image preparation, upload or paid analysis was performed. The separate UI work is owned by the workspace agent and is not certified by this document.

## Confirmed image boundaries

- `backend/ai-grader-speedster-service/card_geometry.py` defines a 2 mm inspection margin, equal to 40 pixels at the existing 20 pixels/mm scale. `warp_to_inspection_map` maps the physical card corners to `(40,40)` through `(1309,1817)` in a **1350 × 1858** image. It warps the original working photograph with the translated perspective transform, retaining actual surrounding photo context where that source evidence exists. It does not invent missing photo context beyond the source image.
- The canonical rectified card stays **1270 × 1778**. `packages/atlas-preparation-runtime/src/index.mjs` verifies those dimensions and records inspection `cardBounds: {x:40,y:40,width:1270,height:1778}`. Preparation and its source transforms should remain unchanged for this presentation/crop correction.
- `packages/atlas-connected-manual/src/defect-images.mjs` verifies the saved inspection image hash and dimensions, then supplies Astra with the **entire inspection image** plus four extracted PNG crops per side. The PNG conversion/cropping does not resize. Thus Astra already receives the 40-pixel surrounding context in each whole-side image; this audit does not claim that Astra's own internal image processing is pixel-identical.
- `packages/atlas-defect-analysis/src/index.mjs` currently plans four **699 × 953** crops at `(40,40)`, `(611,40)`, `(40,865)` and `(611,865)`. Their outer edges stop exactly at the canonical card rectangle, excluding all 40 pixels of outside context. The image descriptors preserve the source hash, extraction rectangle and canonical card bounds; model inputs request `detail: original`.
- The deployed ada00815 browser version of `packages/atlas-manual-workspace/src/defects.css` clips the same margin (the separate local viewer checkpoint now changes this presentation): `.ad-viewport` has aspect ratio `1270/1778`, `.ad-plane` hides overflow, and its image is enlarged to `106.2992126% × 104.4994376%` with negative offsets. `DefectReviewWorkspace.jsx` draws and edits canonical masks on the 1270 × 1778 card grid. Exposing the existing surround must preserve that grid and adjust presentation/pointer mapping together.

The successful existing Astra analysis and its proposals should remain usable. A display change needs no new photo preparation, source hash, canonical coordinate change or paid analysis. The proposed detailed-crop update below affects only explicitly requested future analyses.

## Minimal future crop change

Preserve the whole-side image, four-crop count, canonical geometry, grading and no-resampling policy. Expand only each detail crop's outer sides to include the existing 40-pixel inspection surround:

| Crop | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| 1, upper left | 0 | 0 | 739 | 993 |
| 2, upper right | 611 | 0 | 739 | 993 |
| 3, lower left | 0 | 865 | 739 | 993 |
| 4, lower right | 611 | 865 | 739 | 993 |

All rectangles fit inside 1350 × 1858. They preserve the existing interior overlap and card detail while adding source context beside every outer card edge. Existing physical-card bounds and polygon normalization remain `(localX + crop.x - 40)/1269` and `(localY + crop.y - 40)/1777`; polygons in the surrounding photograph must still be rejected as outside the card.

## Why a new top-level V3 requires a migration

The deployed migration source `frontend/atlas-app/prisma/migrations/20260921000100_defect_analysis_background/migration.sql` explicitly requires `request_evidence.version = 'atlas-astra-defect-analysis-v2'` in both the replacement guard and `append_provider_event`. Changing only JavaScript to emit top-level V3 would prevent background custody from being saved, including acceptance of the provider response ID. Never edit historical migration bytes to bypass this restriction.

A true V3 would require a separately reviewed additive migration and updates to the provider, executor, repository and background persistence version checks. That is unnecessary for a crop-layout correction.

Recommended smaller design, **not implemented**:

1. Keep transport/evidence top-level `BACKGROUND_VERSION` at V2 and keep existing `buildAstraDefectRequest` and `buildAstraBackgroundDefectRequest` output byte-identical for existing inputs.
2. Add an explicit versioned crop-layout marker, for example `cropLayoutVersion: 'inspection-context-v1'`, to evidence created by a new context-aware background builder. Absence means the exact legacy crop layout; do not add a null/default field to legacy evidence. Reject unsupported markers.
3. Extend `planDefectCrops(side, cropLayoutVersion)` with a legacy default and the four explicit expanded rectangles above. Use the saved marker when validating/restoring a request. Never infer the layout from the newest runtime or silently reinterpret old rectangles.
4. Add the new builder as a separate exported entry point, such as `buildAstraContextBackgroundDefectRequest`. The connected action explicitly selects it and passes the same layout marker to `currentImages`; legacy builders and default extraction behavior remain available unchanged.
5. Preserve the new marker with new proposal provenance where needed, without changing historical proposal shapes or bytes. No model prompt change is necessary merely to include the existing surround. Any prompt change would require its own legacy restoration handling because the current validator pins the prompt hash.

This approach retains the database's existing background transport version and acceptance semantics while independently versioning image layout. The database request-evidence field accepts an object and does not impose an exact top-level key count; application validation and exact request restoration must enforce the new field. Existing queued, prepared, accepted, completed and unknown V1/V2 analyses must retain their original request bytes, hashes, evidence and results. No automatic paid rerun, replacement, reprepare or reupload is authorized by this recommendation.

## Implementation file map for the next lead

- `packages/atlas-defect-analysis/src/index.mjs`: explicit layout constant/planner selection; new builder; optional evidence marker validation; saved-layout restoration; future proposal provenance. Keep existing `VERSION`, `BACKGROUND_VERSION`, prompt/schema/limits and legacy builder behavior unchanged.
- `packages/atlas-connected-manual/src/defect-images.mjs`: explicit layout selection for new image extraction; existing full inspection source and hash checks remain.
- `packages/atlas-connected-manual/src/defect-assistance.mjs`: select the new builder and matching extraction layout only when creating a new analysis. Existing reconciliation/review paths remain unchanged.
- `packages/atlas-defect-analysis/test/fixtures.mjs`, `analysis.test.mjs`, `background.test.mjs`: retain legacy fixtures and add explicit context-layout fixtures; avoid globally changing the fixture default and accidentally losing legacy coverage.
- `packages/atlas-connected-manual/test/defect-images.test.mjs` and `defect-assistance-review.test.mjs`: pixel extraction and connected selection coverage.
- `packages/atlas-defect-analysis/README.md`: document both layouts and their compatibility meaning.
- Review the existing version consumers in `provider.mjs`, `executor.mjs`, `repository.mjs` and `background-persistence.mjs`; with the recommended independent layout marker they should not need new transport-version branches. Keep the background SQL migration unchanged.

## Focused regression evidence needed

Existing tests already verify decoded crop pixels against extracted source pixels, full-image source-hash binding, canonical proposal mapping through the 40-pixel translation, rejection of outside-card outlines, and exact retained-request restoration. `packages/atlas-preparation-runtime/test/preparation.test.mjs` also checks frame dimensions/card bounds and byte parity with the original preparation functions. These tests were inspected, not executed, during this audit.

For an implementation, add bounded checks that:

- Legacy V1 and V2 fixtures reproduce pre-change request text, request/evidence hashes, restoration and proposal coordinates exactly. Preserve independently captured pre-change golden hashes or artifacts so the test is not merely comparing the changed builder with itself.
- New requests contain two unchanged whole images and eight exact expanded crops, all ten inputs using the existing original-detail contract. Context strips contain the corresponding source pixels with no resizing; both source hashes remain unchanged.
- The four outer card corners map correctly in their corresponding crops, including `(40,40)` in crop 1 and `(698,952)` in crop 4. Adjacent margin points are rejected as outside the physical card. Include all four crop origins, not only the upper-left case.
- New requests restore exactly using the explicit layout marker; unknown markers, legacy markers paired with expanded crops, expanded markers paired with legacy crops and altered dimensions are rejected.
- Both legacy V2 and context-layout V2 retain background acceptance, polling and result parsing. Existing successful proposals remain reviewable; reconnecting or changing the display does not dispatch another analysis.
- Browser verification separately covers visible context at fit zoom, overlay alignment and trace pointer mapping at fit/zoom/pan, especially physical card edges. That UI work must not mutate the inspection image or canonical mask dimensions.

No changes to preparation, scoring, report approval, reviewed-memory crop storage or existing lesson images are needed for this focused correction.
