# Optional 3D and report return — local qualification, October 21, 2026

This increment implements the owner's request to try a **3D** tab beside Front/Back and adds **← Card Detail** on the separate grade report when reached from card detail. It is local, optional and not deployed. Front remains the initial view; owner acceptance of the 3D appearance and broader device qualification are outstanding.

## Implementation

- Detail-only React lazy import of Three.js 0.186.1; no React upgrade. A local error boundary contains failed deferred imports so static photos, detail tabs and report navigation remain usable.
- One procedural beveled holder uses owner-supplied exterior dimensions 80.264×135.382×6.096 mm. Interior/carrier geometry is illustrative, not manufacturing CAD. Exact verified Front/Back photographs are fitted without cropping, relighting, tone mapping or mirroring. The saved front label is rasterized at 2048×602; decorative NFC is independently loaded and cannot delay readiness. No reverse label or unseen card-edge condition is fabricated.
- Horizontal 360° drag, arrows, Home/End and reset. No autorotation or idle render loop. Vertical touch scrolling is retained. Hidden scenes pause; unmount, access loss, pagehide and context loss dispose canvas/resources and abort pending loads. Unsupported full-size textures fall back instead of silently shrinking source photos. Context loss has an accessible Retry 3D action.
- Browser-only report context is exact card/token/version/origin bound: two-minute single-use handoff, retained on that report history entry for 30 minutes. Modified clicks and normal direct/certificate/NFC entry do not create context. No private return path is put in a report URL, public payload or referrer. The public host renders the link outside ApprovedReportView, including a validated temporarily-unavailable branch. Saved report evidence/publication is unchanged; return destination still authenticates.
- Future View Listing / Make Offer report header actions remain planned and require actual public listing/verified-owner/eligibility state. This code performs no commerce or notification effect.

## Qualification

| Check | Result |
|---|---|
| Final focused staff/media/3D/router tests, Node 22 | 80 passed, zero failures/skips; retained focused-tests.log |
| Public specialist focused checks | 35 passed across staff/router/public (overlaps other counts; do not add) |
| Full public suite | 79 passed, zero failures; specialist tool transcript |
| Final staff production build and boundary | PASS; 35 browser chunks, 15 server traces, 2,030 traced files; retained staff-build.log |
| Public production build and boundary | PASS; 14 browser chunks, 14 server traces, 682 traced files, zero staff/write routes; specialist tool transcript |
| Browser lazy loading / recovery | No Slab3D chunk request before selection; one requested after. Forced chunk503 leaves fallback/detail/Back usable. Context loss exposes Retry 3D in native accessibility tree; retry restores ready viewer. |
| Browser geometry / input / resources | Angled front, readable unmirrored Back via End, horizontal drag and reset; canvas removed when Front selected and when access revoked. Idle frame count stopped. |
| Browser responsive | Desktop 1280 and 1440; mobile 320px document/scroll widths both320, controls fit and drag works. This is viewport testing, not physical-phone performance. |
| Report journey | Detail → exact separate report → exact Card Detail, reload retaining link, fresh direct report tab without stale return. Final source round trip reconfirmed after last media-only accessibility fix. |
| Static/fixture inspection | git diff --check and fixture syntax pass; no synthetic records imported and no signed URLs persisted. |

Cross-review found and resolved failed-lazy-import escape and stalled decorative NFC startup. Browser inspection found and resolved failure-state img-role hiding of Retry 3D. Geometry/resource tests cover native texture limits, loading races, source cancellation, context loss, hidden pause and disposal. No claim is made that viewport checks replace real-device qualification or prove physical holder accuracy.

The existing photographs are 1350×1858 approved derivatives, not full-resolution raw intake masters. Texture source dimensions are preserved; display sharpness still varies with view angle, screen resolution and GPU. Source model has 22 meshes plus 5 line loops and 10,182 triangles. The estimated RGBA+mipmap texture footprint is about33.12MiB with these assets; that is a source estimate, not a measured GPU benchmark.

## Preview, evidence and continuation

Final task-owned fixture: `http://127.0.0.1:58611/admin/graded-cards/3ad38eae-49cd-450c-ab08-10f8b44f386f`, process session71401. Earlier58609/58610 previews remain; only task-owned58611 was restarted after the accessibility correction. Card IDs regenerate on restart.

Evidence directory: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/three-preview-20261021/`. Includes final desktop-3d.png/report-return.png, mobile-320.png from the visually identical pre-hardening layout, focused-tests.log, staff-build.log and this public-build-result summary. Public suite/build results are retained in the specialist tool transcript, not claimed as new root reruns.

The fixture compiles actual staff detail/media and public ApprovedReportView/ReportEntryNavigation components. Read-only copies of public saved report/evidence are hash/side/version checked against the retained references; synthetic token/cert/time/context wrap the preview. Public report explanations, measurements and findings remain saved source content. Labels are deterministic synthetic fixture labels. The fixture is not live inventory or an authenticated production session. `ATLAS_ARCHIVE_REPORT_CONTENT` is optional; without it the old source-report redirect remains.

Current production remains web c4b7cc85 / native31c6685e, registered SQL008. SQL009 remains unapplied. No production deployment/restart/migration, paid provider query, grading approval, label/NFC write, customer notification or financial transaction occurred here. The successor handoff contains all30 original plan requirements, completed subitems and remaining work. Next: owner visual review, fresh detail/identity/history release qualification and reviewed ownership/My Collection foundation; keep optional3D experimental until accepted.
