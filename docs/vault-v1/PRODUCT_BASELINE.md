# Current Vault V1 product baseline

## Latest owner decision — a configurable family of Vault machines

Mark requires one Vault software platform that supports different cabinet sizes, door quantities and door sizes. His latest direction sets the current maximum design at **125 doors** and a compact concept at **roughly 72 doors**. Earlier 100-door and original 150-door descriptions are historical, not the current production target or new global constants. Standardize the door locks, ViewSonic TV/touch displays, Nayax terminals and one SER mini PC per machine. Exact models, controller protocol/capacity and qualified operating limits still need confirmation.

The compact concept places the touchscreen, Nayax terminal and product-display cutouts in the **center, surrounded by doors**. Mark has now explicitly requested a 72-door CAD review using the measured 100-door Rev27 source, half the product-display height, reduced width/height, and a three-sheet target with a 6-inch cassette and shallower cabinet while keeping 6 × 2.5-inch door faces. This is a review design within the configurable family, not a physical release or a new software minimum. A smaller physical touchscreen still requires a suitable model; an existing display cannot be trimmed.

Mark selected **ATOPLEE B01IBEVV0Y**, with supplied product specifications **73 × 58 × 13 mm, 12 V DC / 2 A**. The exact lock is now a design input; controller protocol, qualified pulse/duty limits, wiring and installed electrical behavior remain open. See `MACHINE_PROFILES.md` for the CAD coordination record. Executable test profiles remain explicitly synthetic.

The acceptance target is **the same application build for every supported, qualified machine profile**, with cabinet/layout differences supplied by approved versioned configuration. The software profile envelope is now implemented and under integration validation with explicitly synthetic fixtures. No physical machine profile, unlimited-capacity or arbitrary-hardware compatibility claim is made.

A machine profile must distinguish:

- Stable machine/model/profile identity and profile revision.
- Each door's stable internal ID, printed customer label, physical/display position and dimensions. Support mixed-size doors and nonuniform arrangements; do not make a rectangular row/column grid the only representation.
- Explicit door-to-controller endpoint/board/channel mapping, independent of door labels or screen position. A layout never authorizes a guessed relay address.
- Hardware/adapter identity and qualified capacity; payment/cart limits remain bounded by the actual payment integration rather than equaling cabinet door count.
- Customer-touchscreen and TV/display roles, supported orientation/resolution/scaling and touch association. Shared brands alone do not prove interface, driver or capability compatibility.
- Per-door product assignment and per-profile completeness/certification coverage. Cabinet dimensions are distinct from inventory, payment and fulfillment authority. Record usable compartment dimensions separately from exterior door/cutout size; any product-fit restrictions for different compartments need an explicit operator/product policy rather than an assumed fit.

Profiles must be validated, signed/versioned and activated at a safe service boundary. Freeze the applicable profile/mapping with every sale, command, restock and certification record. Profile edits must not relabel historical transactions, remap paid doors or erase retired-door history. Physical reconfiguration of stocked/in-use machines needs an explicit service/reconciliation procedure and applicable recertification.

New sizes/layouts within tested interface and capacity limits should require configuration and acceptance testing, not application changes. New controller protocols, unsupported capacity, sensor semantics, payment behavior or incompatible display/OS interfaces can still require code changes. Lock power, duty cycle, wiring, larger-door mechanics, cooling, usability and installed-machine safety remain physical qualification obligations even when software is unchanged.

General software review and the profile architecture/refactor can proceed before final cabinet dimensions are chosen. Real wiring maps, final CAD/fabrication, installed-display acceptance and physical certification still require the actual selected design and hardware. Use the owner's approximate 72-door and maximum 125-door direction for design and software test cases, while keeping final topology and qualified operating bounds explicit and preserving legacy history.

## Earlier owner update — 2026-09-07

Mark's latest instructions supersede the August 16 brief where they differ:

- The first planned Vault has **100 doors**, not 150; later owner instructions above expand this to a configurable machine family.
- Each Vault has its own **SER mini PC**.
- The touchscreen is a **ViewSonic display with no operating system of its own**, as described by Mark. The exact model and connection requirements remain to be identified; do not infer an Android/tablet runtime.

The original engineering package under `authority/` is retained unchanged as historical design authority. It must be read together with this newer owner decision. Its 150-door / six-column / 25-row assumptions and candidate-display discussion are no longer current product requirements.

## Physical reference and remaining hardware decisions

The inspected Rev27 file at `/Users/markthomas/Downloads/Ten_Kings_Vault_Rev27_FINAL_QA/04_DIMENSIONED_4x10_SHEET_LAYOUTS/Final_Ten_Kings_Vault_Rev27_All_5_Sheets_DIMENSIONED.dxf` contains 100 rectangular openings in 5 columns by 20 rows, annotated 5.000 inches wide by 2.250 inches high, plus a TD1655 display opening and Nayax mounting notes. It is a five-sheet fabrication layout, not assembled-fit, electrical or controller-mapping proof. Mark subsequently selected it as the dimensional source for the 72-door review described above. A native 125-door source remains unverified; the older Rev6 PDF describes different, smaller doors. No CAD file was edited by this software task.

1. Actual physical rows/columns and printed door labels, preferably a front-view drawing or photo. Do not assume that X/K/I/N/G/S identifiers or equal column heights still apply. Do not derive relay addresses from a guessed visual arrangement.
2. Exact SER model, processor architecture and intended OS/edition. The existing software targets Windows with Node 20 and native SQLite; that is implementation evidence, not confirmation of the new PC specification.
3. Exact ViewSonic model, installed orientation/resolution/scaling and video/touch connection types.
4. Controller/relay-board model, firmware/protocol, and authoritative door-to-channel mapping. No real controller commands are authorized.
5. Confirm the previously outstanding Nayax terminal/Marshall integration kit and official test/certification information; no payment activation or charge is authorized.

## Current implementation and review status

Software corrections cover runtime synchronization, payment/recovery/concurrency, scoped staff and cloud authority, configuration/reporting/certification integrity, kiosk recovery/accessibility and Windows artifact staging safety. Combined local validation passes: 252 tests, full Vault/Next builds, 13 public-route checks, 17 browser scenarios and the 95-migration disposable PostgreSQL chain with legacy upgrade/resume, public HTTP projections for legacy150/72/125/256, profile publication/reconciliation races, count boundaries and no-op/cleanup proof. Seven findings from independent review of candidate `0c5d9745` were corrected and regression tested. Review of the new final commit and exact-head PR checks remain required.

The profile refactor now spans shared contracts, machine state/history, cloud/database, kiosk layout, operator fit confirmation and per-profile certification coverage. Executable schema 2 accepts complete profiles and independent mappings; draft authoring can retain unknown physical values as null. The **legacy 150-door baseline** is preserved through explicit schema 1 compatibility. Synthetic tests at 72 and 125 doors demonstrate software behavior, not measured cabinet fit or physical qualification. See [MACHINE_PROFILES.md](MACHINE_PROFILES.md) for the supported envelope and remaining hardware fields, and `FRESH_TASK_HANDOFF_2026-09-07.md` for the historical transfer authority.

Preserve the per-door certification policy unless Mark changes it: 5 purchase and 2 restock cycles for every door in the applicable approved profile; never fabricate physical coverage from simulator results. Tests cover multiple capacities and mixed-size/nonuniform layouts, plus migration and recovery of the historical 150-door fixtures without reinterpreting their IDs or snapshots.

Official Nayax/controller adapters, the final Windows runtime/native binary/package/service/protected-storage implementation, installed-appliance validation, authorized migration/deployment, physical certification and pilot remain outstanding. No PR merge, Production access, deployment, hardware actuation, credential change or real payment is authorized.
