# ATLAS V4 labels and saved print sheets

Implementation branch: `codex/atlas-v4-label-sheets`, based on live R23 web source `ab045d2afa5252c921edcf76aa015094b1bd21ce`. This document describes the implementation, not a production deployment receipt.

## Staff workflow

The Labels page at `/admin/labels` and the Batch Labels tab show persistent sheets plus individual labels. A successful PRODUCTION publication records one durable label intent for the exact human approval. The background worker loads that immutable published packet, renders its approved identity and final grade, and allocates the first free position in a compatible sheet. Capacity is 50. The 50th label seals its sheet; the next label opens another. Sports defaults to gold and Pokémon to holographic stock, independent of grade. Gold-only-for-10s remains undecided.

A partial sheet can be exported at any nonzero count. Export freezes the current positions, including empty transparent positions; new labels enter the next compatible draft. The UI distinguishes preparation, downloadable file, and an explicit staff record of successful physical prints. Downloads have no printer or NFC side effects. Individual V4 PNG preparation remains available. A replacement request creates a separate item from the saved original artwork and preserves history. The existing station/NFC workflow remains separate.

Staff access follows existing reviewer/card ownership and approver permissions. Sheets are scoped to the acting staff account, and every member card is reauthorized before access or download. They are not a global all-staff pool. All saved requests and retries remain bound to that account, exact source, approval and export bytes.

## Artwork and geometry

The authority is the owner-supplied `ATLAS_V4_Print_Test_Package`, including original vector outlines. The source PRINT artwork preserves the unprinted substrate openings; PREVIEW_ONLY material colors never enter the production PNG. Pinned Montserrat 900 and Roboto Condensed 700 outlines match specimen font metrics. Dynamic names, identity details, exact grade and the complete certificate/version are rebuilt. Text that cannot fit truthfully enters Needs layout rather than being truncated or replaced.

The accepted jig uses 50 positions, 10 columns × 5 rows, on a 310 × 400 mm canvas. Native labels are 68.342 × 20.082 mm, rotated 90° clockwise on the sheet. Position 1 begins at x36.590/y21.145 mm from top left. Pitches are 24.082/72.342 mm. The browser and exporter share the integer-micrometre geometry. Nominal metal DXF has 50 closed cutouts on `CUT_LABEL_OPENINGS` and a separate outer-plate layer. Geometry and source DXF hashes are pinned in `packages/atlas-finishing/assets/jigs/atlas-label-jig-v1.json`.

Individual PNG: 6458 × 1898 pixels at nominal 2400 ppi. Full sheet: 9764 × 12598 pixels at nominal 800 ppi, preserving the full 310 × 400 mm transparent canvas. PNG physical-density metadata and an exact import-dimensions manifest accompany the saved export. Native raster work runs in one bounded child process using 256-pixel strips. The browser receives protected SVG previews and a short-lived, reauthorized object-storage download URL for PNG bytes.

The full sheet profile is diagnostic until the physical jig and eufyMake import have been checked together. Actual fixture fit, kerf/clearance, printer origin and transparent-canvas cropping are not inferred from a successful single-label print. The user already tested and accepted the original individual labels. No new individual print qualification is claimed here.

## Release contract

- Apply additive standalone migration `004-label-sheets` only through the checked standalone ledger and migration manifest. No historic card or grading rows are backfilled by this migration.
- Apply narrow manual-role label grants. Variant worker receives no label permissions.
- Package the exact V4 vectors, font files and licenses, provenance, jig JSON/DXFs and native raster worker. The clean native verifier renders an actual individual V4 PNG.
- Set `ATLAS_MANUAL_LABEL_SHEETS_ENABLED=true` only on the qualified private main service. Construction is cold and the variant runtime ignores the flag. Startup checks the label schema and required grants before listening.
- Deploy the staff page/proxy and qualified native source together with fresh current production control bindings. Preserve unrelated catalog/release work and current protected containers. Do not replay previous release intents.
- Existing published approvals need a separate, explicit reconciliation: inspect the read-only candidate list/plan hash, then apply the exact named card IDs and hash. A Labels page visit never backfills or starts grading/provider work.
- Confirm the normal signed-in flow against the deployed service and verify downloaded bytes/dimensions. Complete one physical alignment test in eufyMake before treating the new sheet origin as calibrated.

No production deployment, schema migration, reconciliation or physical printing is recorded by this implementation document. Follow the current deployment runbook and SESSION_LOG for actual release evidence.
