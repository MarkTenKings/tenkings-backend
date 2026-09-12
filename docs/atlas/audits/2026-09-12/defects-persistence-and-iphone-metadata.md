# Manual defects, durable review and qualified photo metadata

September 12, 2026. Local staged build on baseline
`c39591677962ea2bb2332fff11fce4f2e39458d8`. Mark requested fresh Astra Extra High
specialists to build the next set. Five fresh `gpt-6-astra`/`xhigh` specialists
handled defect/CPU actions, manual persistence, HEIC metadata and independent
HEIC/manual-boundary reviews. Root integrated the paired screen, server/client
workflow and authenticated browser fixture.

This checkpoint supersedes the earlier local gaps for defect editing, durable
manual drafts and separate report snapshots. It is not a serving release or
physical-card acceptance. Serving I remains the previously observed failed
real-card build; the initiating historical timeout cause remains unconfirmed.

## Implemented

`packages/atlas-manual-workspace` now contains the paired defect screen and pure
defect actions. It displays actual 1350×1858 inspection images, crops their 40px
margin to the 1270×1778 card grid, and preserves the existing coordinate/trace
conventions. Users can select, change type, remove, restore, add and reshape
findings, with brush/eraser, undo, zoom and pan. Missing or mismatched images
cannot authorize inspection. Unsaved outlines/traces block stage navigation.

`packages/atlas-measurement-runtime` and the new isolated Python entry call
the existing checked `measure_manual_side`. Type, trace, remove and restore
actions remeasure the whole active side, retaining exact masks, disconnected
components, holes, overlap behavior and source provenance. Source/input/output
hashes and actual child termination are checked. These resource bounds are
host configuration, not a new product card-count or spending allowance.

`packages/atlas-manual-service` adds ordinary staff-cookie/CSRF authentication,
per-card owner/editor/approver/read access, compact PostgreSQL CAS drafts,
immutable action history, exact replay/status and separate approval snapshots.
The current staff role and old orchestration remain unchanged. A separate
restricted manual role rechecks the existing staff session and certification
inside short transactions. CPU, artifact storage and report calculation occur
outside those transactions. The SQL file is an **inactive proposal**.

Full geometry, findings, bitmaps and reports live in immutable verified JSON
artifacts; PostgreSQL contains compact references. Artifacts bind exact bytes,
card, kind and source. Conditional S3 support is injected and locally tested;
the integrated fixture uses private files. No live S3/Spaces acceptance is claimed.

`packages/atlas-manual-workflow` connects these modules. A defect correction is
saved before a separate CPU action; failed measurement leaves its candidate
available after reload. A current-base discard returns to the previous saved
findings while preserving action/artifact history. Missing save replies retry
or reconcile the identical command, then reload the latest view. Definite
validation and precommit CPU refusals do not become indefinite unknown saves.

Both side inspections enable the owner-selected single **Confirm findings**
action. Final trained-human approval remains separate and binds the exact
server-computed report hash and full REPORT artifact reference. Identity and
printed-border edits preserve valid defect inspection. Physical re-preparation
replaces only the affected side's current findings/evidence. An earlier approved
snapshot remains immutable history after a later draft edit.

`packages/atlas-photo-runtime` now validates bounded EXIF IFD graphs and preserves
exact qualified Apple Display P3, compact Display P3 and compact sRGB profiles in
lossless output. HEIF item transforms control orientation once; descriptive EXIF
does not rotate the PNG a second time. Existing odd-origin, dimension and repeated
transform guards remain. An independent reviewer found and fixed unjustified
grid ICC inheritance: without an explicit primary profile, every tile must carry
the same nonempty profile before the whole grid is qualified.

The two retained 3024×4032 iPhone originals contain Apple P3 and HDR gain-map
auxiliary data. Their bytes remain untouched and their HDR form remains refused.
The owner was asked whether the first usable build should use SDR inspection
views while retaining untouched HDR originals, or wait for full HDR inspection.
That answer is pending. No HDR flattening or color-quality policy was inferred.
The existing preparation engine still accepts opaque sRGB RGB8 only; preserving
a P3 decoder output does not qualify it for preparation or optical grading.

## Evidence and review

Evidence root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-defects-20260912/`.

- 160 local tests pass without skips: 100 photo-runtime/photo-core, 37 manual
 workspace actions/snapping, 9 actual CPU runtime and 14 manual-service/client/HTTP.
- Final native persistence proof passes 15 assertion groups, applying all 95 public
 and 35 staff migrations and checking a second deployment does nothing in the
 owned disposable database. It includes real staff auth with synthetic SMS,
 concurrent CAS, per-card denial, separate-process readback, logout during a
 paused reducer, approval immutability and certification expiry during a row-lock
 wait. Another grader's independent card committed in 10 ms while work was paused.
- Independent manual-boundary review passes 6 regression groups with explicit
 in-memory auth/repository/transport stubs and the actual workflow/artifact/core
 modules. These are separate from the native database proof.
- Final Chrome 152 browser proof passes 9 scenarios with no page errors: actual
 sign-in; geometry save/reload; private-read/CSRF denial; image readiness; durable
 trace candidate and CPU retry; lost committed response; exact trace/type/remove/
 restore; separate approval/reload; physical CPU re-preparation/history; mobile
 layout. Several related checks are grouped in those nine scenarios.
- HEIC independent native oracle covers 32 cases: 30 exact RGB8 comparisons, all 32
 ICC comparisons, and exact 10/12-bit source codes under the documented full-range
 PNG16 expansion. Raw 16-bit bytes differ from libheif CLI's left-shift convention;
 those differences are retained rather than claimed equal. Three qualified ICC
 profiles also match independent LittleCMS XYZ results across 343 samples each.
- Root verified 13 defect, 28 persistence, 20 manual-review, 36 final photo-source,
  161 photo-review and 110 original photo-evidence manifest entries with exact
 hashes/lengths. The original HEIC builder seals remain preserved; the reviewer
 correction has a separate final manifest. The lockfile's four affected importers
 parse with Ruby Psych and match their package dependency/specifier sets.

The first full browser harness used synchronous Playwright `check()` against an
asynchronously saved inspection checkbox and failed after the inspection had
already saved. It now clicks and waits for authoritative state. The final full
run passes. A later CSS-only report-table spacing change was separately rendered
and visually checked. Earlier failure evidence is retained under `browser-final`;
the final full pass is under `browser-verified`.

Native tests used macOS Node 25.6.1, PostgreSQL 17.10 and the pinned Python 3.9.6 /
NumPy 1.26.4 / OpenCV 4.10.0.84 environment. Deployment Node 20/Linux qualification
and the separate native-x86 timeout investigation are not established by these
tests. The component bundles remain isolated from old operator/application auth
code; the fixture deliberately imports existing auth for its real boundary.

## Remaining work and decisions

- Mount the clean workflow in the ordinary serving app with reviewed roles,
 private provider storage, native upload/photo plans and real-card acceptance.
- Resolve HDR/working-color behavior and verify fine detail on fresh actual
 sports/Pokémon photos. Confirm borderless grading behavior separately.
- Connect the already-extracted shared identifier and finish research/SoldComps
 and shared knowledge adapters. No live identification request occurred here.
- Evaluate detector/SAM/Astra behavior, connect Astra to the same tools and settle
 automatic continuation rules. No model or detector selection was changed.
- Select and build the deliberate grading-lesson publication event.
- Connect approved report snapshots to public reports, labels, NFC and actual
 physical finishing. This batch's approval does none of those actions.
- Continue the isolated initiating-cause investigation without reviving canceled
 old-card recovery or changing serving controls.

No production app/data/configuration, external provider, remote runtime, live
schema migration, certificate/publication, inventory/ownership record or physical
completion was changed. Local fixture shutdown receipts accompany the handoff.
