# Vault machine profiles and CAD integration

The current design direction is a family with a maximum design of 125 doors and an exploratory compact arrangement near 72, with central touch/payment/product-display regions. All new checked-in geometry and hardware fixtures are explicitly synthetic. No measured production profile or verified hardware map has been supplied.

## Implemented software envelope

Config schema 1 preserves its original signed payload shape, the X/K/I/N/G/S × 01–25 identities, historical channel interpretation and 150-door membership. Config schema 2 embeds `VaultMachineProfileSchema` version 1 and a separate complete `doorMapping`. Transport contract version remains 1. Consumers use the explicit config discriminator; missing schema-2 profile data never falls back to the old grid.

| Concern | Executable fields and validation |
| --- | --- |
| Identity | Machine ID belongs to the config; reusable `profileId`, `modelId`, and positive profile `revision` belong to the profile. Stable opaque door IDs are distinct from printed labels. IDs and case-insensitive labels are unique. |
| Geometry | Positive decimal `cabinetMm`, per-door `openingMm` and `usableCompartmentMm`; an independent display canvas contains per-door rectangles and equipment cutouts. Display rectangles must be bounded and nonoverlapping. Display coordinates are UI projection units, not measured cabinet coordinates. |
| Wiring | Each door maps explicitly to `controllerEndpointId` and one-based `controllerChannel`. Endpoint/channel pairs are unique, complete and within separately declared endpoint and controller capacity. Neither array order, label nor geometry yields an address. |
| Interfaces | `vault-controller-v1` and the exact adapter identity, declared endpoint capacities, computer/OS/lock/payment model strings, and separate touchscreen/TV roles with model, resolution, orientation and scaling. These declarations require qualification; they do not implement an unknown protocol. |
| Fit | `OPERATOR_CONFIRMED` requires an explicit fit confirmation with each schema-2 FILLED restock observation. Opening dimensions and usable interior are distinct; no product fit is inferred from a screen rectangle or flat shelf. |
| Provenance | `SYNTHETIC` or `QUALIFIED`; qualified publication requires geometry, wiring, capability and hardware SHA-256 evidence bindings plus a fresh Admin review of the stored reports. Hashes bind evidence bytes; they do not prove physical correctness. |

The parser supports 1–256 doors as a defensive, tested software resource envelope. **256 is not a cabinet target or a qualified hardware limit.** Synthetic coverage includes 1, 7, 32, 72, 125, 150 and 256 doors; the interactive demos expose only 72 and 125. Payment item/amount capabilities remain independent of installed output count. All currently runnable adapters are deterministic mocks/simulators and force certification mode.

`VaultMachineProfileDraftSchema` is a separate authoring artifact with `status: DRAFT`, nullable physical dimensions/rectangles and explicit unresolved reasons. It is never accepted as an executable signed config. Unknown depth is null, never zero. Admin can retain an incomplete draft without making it publishable or actionable.

## Immutable history and service activation

Published configuration bytes and profile revisions remain immutable. Sales pin their original config, printed labels, endpoint/channel and mapping version. Commands, restocks and certification retain their applicable configuration and per-door snapshots. The cloud resolves the full profile through the immutable config relation; bounded event payloads carry identities/digests and snapshots rather than a duplicate geometry tree.

Local SQLite schema 3 retains door rows when they leave the active profile, uses a partial unique index for active endpoint/channel pairs and preserves existing sale/command foreign keys. A retired stable ID cannot be rebound to a different compartment/address. PostgreSQL receives an additive profile migration; older migration files remain unchanged.

Initial empty-machine activation and nonstructural configuration updates use the normal safe boundary. A changed profile or mapping requires `POST /api/v1/staff/profile-activation` with a freshly checked Technician/Admin session, `expectedConfigVersion`, `expectedConfigDigest`, `compartmentsEmpty: true` and `servicedDoorsClosed: true`. Every current compartment must be empty and unowned, with no cart, unfinished sale/payment, command, restock or certification work. Earlier state-bearing outbox facts must be acknowledged before the atomic activation; only non-projecting freshness, grant/authentication and config-staging audits are exempt. This lets the cloud reconcile old inventory before heartbeat changes its door membership. The operation ends the approving local staff session and retains service lock. Reauthentication and explicit safe exit are required before public shopping. Failed checks preserve the prior active profile and state.

Cloud heartbeat admits an exact already-active config or forward activation of a previously signed/published version above the cloud's active version and no newer than its pending version. If local version 2 activates just before Admin publishes version 3, heartbeat records version 2 and retains version 3 pending. Drafts, missing publication/signature fields, mismatched digests and downgrades remain rejected. If local activation occurs while heartbeat is in flight, runtime defers its outbox until a fresh heartbeat reports the matching active digest. Membership changes before new-profile events are delivered; the pending pointer clears only when that exact version activates.

## CAD and physical authority

The separate CAD task supplied three R01 review memos under `/Users/markthomas/Documents/Codex/2026-09-07/vault-cad-hardware-astra-max/outputs/`: `Vault_Source_Reconciliation_R01.md`, `Vault_Machine_Profile_Interface_R01.md`, and `Vault_Hardware_BOM_Research_R01.md`. These are proposals and source evidence, not deployed configuration.

Reviewed R01 SHA-256 bindings: interface `ae1f4c5f1c2b7d028a01e65d92639b6ddc50c9c72d8424d2a90ecd8e02f2291d`; reconciliation `0385e06d0cbd3ad9d8c5f7f3f063d834fe09431eb009bbf7234887354b896f62`; hardware memo `5da6a83505c62423e529e0deebb9c747df8752a6f48a297ac4026fbbf3d915e2`. These local artifacts are external review inputs and are not fabricated production profile evidence.

The latest located attachment matches the 100-door Rev27 DXF. Rev6 describes 125 smaller doors, but no corresponding native 125-door source has been verified. The current 125 maximum and compact direction remain the owner's intent; software does not relabel Rev27 as 125 or claim that its nesting coordinates describe an assembled cabinet. The source task rehashed all 297 inventoried files unchanged.

Subsequent owner instructions in the CAD task explicitly select that 100-door Rev27 source for a new 72-door review design, halve the product-display height, center the controls, and prioritize three sheets using a 6-inch cassette and shallower cabinet while retaining 6 × 2.5-inch door faces. These instructions resolve the compact design's source; they do not supply a native 125-door drawing or approve physical release. The delivered V72 Centered R01 package completes the dimensional design-review iteration; its geometry remains non-executable review evidence.

Delivered CAD review input: `/Users/markthomas/Documents/Codex/2026-09-07/vault-cad-hardware-astra-max/outputs/Vault72_Centered_R01/06_MODEL_DATA/V72_R01_MODEL.json` has SHA-256 `aa683989fdb9ab281961a9613e98ca78fb152be26396d01ae66f0e05950c3008`. It declares `DIMENSIONED_DESIGN_REVIEW_NOT_FABRICATION_RELEASE`, 72 doors, a 38.25 × 66.25 × 14-inch shell, a 6-inch cassette, 6 × 2.5-inch faces and three stock sheets. The software lead verified all 72 `stable_door_id` and `controller_mapping` fields are null. CAD instance names D01–D72 therefore authorize neither production IDs nor relay addresses. The companion review archive `Vault72_Centered_R01_CAD_Review_Package.zip` has SHA-256 `9cfe98ffec3fe46ebdc6469ad161e0f930fb28f76c2aa4a11231c675e3a8ca9e`. Its geometry/native verification reports are separate CAD-lane evidence; no physical acceptance or executable profile is inferred. Mounting/strike/hinge overlays, device fit, wiring/electrical/thermal behavior, structure and CAM/first-article qualification remain open.

Mark also selected ATOPLEE B01IBEVV0Y, described in his supplied product text as 73 × 58 × 13 mm, 12 V DC / 2 A. This replaces the unidentified lock assumption for the new design. The CAD task reports a seller-stated maximum single unlock signal of 0.2 seconds; this is not a qualified operating pulse, duty cycle, driver cutoff or electrical acceptance. No pulse default, controller command or production hardware profile was inferred from that report.

The earlier interface memo proposes a right-handed frame (x right, y rear, z up), decimal millimeters and explicit per-part datums/assembly transforms. The delivered V72 R01 model explicitly declares inches; preserve that source unit and convert explicitly when preparing a future millimeter profile. Source inches convert by exactly 25.4; 0.0625 inches is 1.5875 mm. Native mechanical outlines, mounting/obstruction envelopes and assembly transforms remain in the external evidence artifacts; the current UI rectangles must never be used to fabricate or derive wiring. Physical profile release still needs an authoritative mechanical source, exact part identities and independent mapping/capability evidence.

Exact SER/OS, ViewSonic display/touch binding, Nayax/Marshall device and cable kit, controller model/firmware, pulse/duty/concurrency limits and installed power/fault behavior remain unresolved. Door RS485 and Nayax's separately documented USB-to-COM interface must not be conflated. The schema does not select a board, qualify firmware or supply a pulse default. Real adapter implementation and installed acceptance remain required before production.

## Runnable synthetic demonstration

With Node 20 first in PATH and frozen dependencies installed:

```sh
pnpm vault:demo -- --doors 72
pnpm vault:demo -- --doors 125
```

The command builds the machine/kiosk, starts one loopback service on an ephemeral port, and prints its URL. Tap the staff corner ten times and use test user `simulator-tech` / PIN `123456`. Restock a chosen synthetic door, record its fit/outcome, finalize and safe exit, then shop through the same public UI. Payments, controller outputs and cloud responses are injected simulators; no production credentials or remote cloud are used. Ctrl+C closes the service and deletes only its own temporary SQLite session.

For repeatable public HTTP coverage after `pnpm vault:build`, run `node scripts/run-vault-simulator.mjs --doors 72 --smoke` and the corresponding 125 command. Each exercises staff authentication, restock, checkout, payment advancement, one paid-group retry, Done and ordered event delivery. These tests establish software behavior only.
