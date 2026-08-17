# Vault V1 External Evidence Packets

These packets preserve exact unknowns. They do not block mock/simulator-backed software.

## Nayax packet (G-01)

Request dated, versioned artifacts for:

- Marshall hardware sales-kit identity and serials; onboarding/account/test-environment status.
- Supported Windows architecture, language/runtime, SDK package/version/hash/license/provenance, sample/simulator version.
- Approved flow configuration for one mixed multi-vend payment, item and amount limits, exact price/total encoding, keepalive/timing constraints.
- Callback names, ordering/cardinality, provider session/transaction identifiers and uniqueness scope, duplicate/restart behavior, cancellation and timeout semantics.
- Session query/reconciliation behavior after service/PC restart or callback ambiguity.
- Written no-door-sensor rule for reporting vend success/failure, including mixed ACK/timeout/unknown multi-door outcomes.
- Settlement/void/refund/support responsibilities and test-to-live isolation.
- Certification procedure, approver names, evidence format, and stop criteria.

Until approved, only the deterministic normalized mock is allowed. No public documentation is treated as installed-SDK proof.

## Controller/electrical packet (G-02)

Request dated/versioned evidence for controller make/model/serial, firmware version/hash, stable USB identity, COM parameters, framing/checksum, command IDs, channel map, ACK/error/timeout meanings, duplicate/reboot behavior, watchdog/default-off/max-on safeguards, and firmware-owned pulse profiles.

Bench evidence must cover at least eight representative doors and record solenoid/driver/PSU identities, inrush/current, voltage drop, release timing, temperature, EMI, flyback, brownout, reset/disconnect, stuck output, malformed/duplicate/flooded command handling, wire gauge, fusing, and enclosure grounding. Produce a signed bidirectional 150-door-to-channel map. Until complete, only the non-actuating simulator is allowed.

## Machine tax packet (G-03)

For each production machine, Admin supplies and reviews machine ID, street/location context, city, state, IANA timezone, tax percentage with legal source/date, integer-basis-point conversion, effective config version, and sample calculations at $25/$50/$100/$250 plus mixed-cart half-up boundary cases. Engineering does not determine the legally correct rate.

## Screen/Windows/enclosure packet (G-04)

Record final PC, touchscreen, Windows edition/build, drivers, orientation, 100/125/150% scaling, browser version/zoom/assigned access, effective CSS viewport, touch calibration, VESA/mount/enclosure, glare, reach, cable routing, ventilation/thermal, service access, cold-boot/power recovery, USB identity, and photos/results for the 720×1280 through 1080×1920 acceptance suite. Elo 1304L remains a candidate until this packet passes.

## Support/deployment packet (G-06)

Before production activation, Admin publishes a signed machine config with the real Ten Kings support page URL, email, SMS number, phone-call number, displayed hours/timezone, escalation owner, and verified QR/link behavior. Only the opaque support reference and paid door IDs may be transmitted.

## Certification/release packet (G-07)

Define allowed Nayax test mode, physical critical-failure stop rules, recertification/invalidation matrix, signed-build provenance, release signing and verification, pilot stop/rollback criteria, evidence retention owner/storage/immutability, and decommission retention date. Technician or Admin may approve pre-field certification; certificate approval is not launch authorization.
