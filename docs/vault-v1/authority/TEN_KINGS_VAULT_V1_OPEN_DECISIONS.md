# Ten Kings Vault V1 — Final Decision and Evidence Register

**Status:** All owner-policy decisions closed; deployment configuration and external evidence remain  
**Date:** August 16, 2026

Only decisions that materially affect scope, safety, accounting, hardware, or launch are listed. Engineering should not ask the owner to decide routine implementation details that can be proven safely.

## Final status

**Owner-policy status:** Closed. Mark approved the cloud-outage rule, role matrix, certification retention period, and support configuration requirement on August 16, 2026.

**Deployment configuration:** Before production activation, Admin must populate the support page URL, email destination, text number, phone number, and displayed support hours. These are environment/machine values, not open product decisions.

**External evidence that can be collected during the build:** exact Nayax certified flow (D-01), controller/electrical qualification (D-05), and final screen/Windows/enclosure qualification (D-06). These do not block mock-backed implementation.

**Future and non-blocking:** the Card Platform V2 identity bridge (D-11). It is outside Vault V1 and requires no discussion to build or launch Vault V1 anonymously.

## Resolved owner decisions

### R-01 — Vault is independent from Speedster

**Owner decision:** Vault V1 has zero dependency on Speedster. It is a separate product, code branch, runtime, and data domain and may be built now on a clean branch.  
**Boundary:** Vault V1 does not infer or write Card Platform V2 pack/card identity or ownership. A future identity bridge is a separate project.  
**Effect:** Removes the former sequencing blocker from all Vault implementation phases. This is not an open decision and does not block work.

### R-02 — Paid-door retry and escalation

**Owner decision:** After the initial unlock attempt, show one `OPEN DOORS` button. Pressing it sends exactly one second command to every original paid door. It never opens a substitute or unpaid door.  
**Escalation:** If the customer still reports a problem, show the Ten Kings support page/QR. Do not automatically substitute, issue store credit, or initiate a refund.

### R-03 — Manual per-machine tax

**Owner decision:** Admin enters each machine's city, state, and tax percentage. Tax is added to the transaction subtotal and paid by the customer.  
**Engineering rule:** Version/sign/audit the machine tax configuration, store the rate in integer basis points, calculate half-up to cents on the subtotal, display it before payment, and pin it to the sale.

### R-04 — Support channel design

**Owner decision:** Route customers to a Ten Kings support page offering email, text-message, and phone-call choices.  
**Deployment requirement:** Admin supplies the actual page URL and contact destinations before production activation.

### R-05 — Certification approvers

**Owner decision:** A Ten Kings `TECHNICIAN` or `ADMIN` may approve pre-field testing/certification of each machine. Retain certification evidence for the machine's complete service life plus three years.

### R-06 — Enrollment and key ownership

**Owner decision:** Mark, acting as Ten Kings Admin/owner, owns machine enrollment and security-key management. Admin alone approves, rotates, revokes, recovers, or decommissions credentials; a Technician may perform an explicitly authorized one-time physical enrollment.

## Decision and evidence register

These decisions gate only the affected live, physical, accounting, migration, deployment, or launch actions. The next Codex agent may build unrelated software now with mocks and simulators.

## D-01 — Nayax certified flow

**Owner/provider question:** Which exact Marshall flow, SDK/version, item/amount limits, cancel/timeout semantics, provider transaction ID, restart reconciliation, and test mode will be certified for a mixed multi-door cart?  
**Critical sub-question:** With no door sensors, what evidence permits the peripheral to report vend success, and what happens when only some commands are ACKed or unknown?  
**Recommendation:** Obtain written Nayax design approval before real-adapter implementation. Never treat `Vend Approved` as settled payment.  
**Blocks:** G-01; live payments and final transaction state mapping.

## D-02 — Resolved: customer retry and support escalation

**Decision:** One transaction-level `OPEN DOORS` retry sends a second command to all original paid doors. After it is used, unresolved problems route to Ten Kings support.  
**Financial boundary:** There is no automatic substitute, store credit, or refund. Admin handles any later financial resolution through the approved support/reconciliation process.  
**Blocks:** Nothing in mock-backed implementation; the real Nayax refund process remains part of D-01 evidence.

## D-03 — Resolved: manual machine tax configuration

**Decision:** Ten Kings Admin manually enters city, state, and tax percentage for each machine. Tax is added to the purchase subtotal.  
**Implementation:** Signed/versioned configuration, integer basis points, half-up cent rounding on the transaction subtotal, pre-payment subtotal/tax/total display, immutable sale snapshot, and original-tax preservation for later void/refund reporting.  
**Blocks:** Production checkout only until that machine has a reviewed rate and passing calculation tests.

## D-04 — Resolved: offline sales policy

**Architecture clarification:** The door controller is connected to the local Windows service. An active/authorized transaction and its `OPEN DOORS` retry work without the Ten Kings cloud. A full internet/Nayax outage blocks new payments unless Nayax later certifies an offline mode.  
**Owner decision:** No new checkout may begin while the Ten Kings cloud is unavailable. Complete every active or already-authorized transaction locally, including initial door commands and the paid `OPEN DOORS` retry.  
**Future change boundary:** A nonzero cloud-outage sales window requires a separate owner decision with explicit age/clock/storage/outbox limits.  
**Blocks:** Only implementation and tests of the sales-ready evaluator.

## D-05 — Controller, solenoid, and power design

**Owner/hardware question:** What exact controller, firmware, power supply, driver board, solenoid, fuse/wire scheme, pulse profile, and concurrency limit will be used?  
**Required evidence:** Eight-door measurements for current/inrush, release timing, voltage drop, temperature, EMI, flyback, brownout/reset/disconnect, stuck outputs, malformed/duplicate/flooded commands, USB identity, and safe default-off behavior.  
**Recommendation:** Firmware-owned fixed pulse profiles and serialized single-door commands unless measured evidence approves more.  
**Blocks:** G-02; real commands and cabinet wiring.

## D-06 — Screen, Windows, and enclosure

**Owner question:** Is Elo 1304L the final touchscreen, and what Beelink model, Windows edition, scale, browser zoom, mount, orientation, enclosure, ventilation, and service access are approved?  
**Required evidence:** Effective 720×1280 through 1080×1920 CSS behavior, 100/125/150 percent Windows scaling, touch mapping, glare, standing reach, cold boot, and assigned access.  
**Recommendation:** Keep Elo 1304L as the leading candidate until physical validation.  
**Blocks:** G-04; physical UX acceptance.

## D-07 — Resolved: staff roles and PIN operations

**Owner decision:** Use the detailed three-role permission/prohibition matrix in blueprint section 13.2. Restockers stock assigned doors; Technicians diagnose/repair/test and may approve pre-field certification; Admins control business configuration, staff access, financial reconciliation, enrollment/keys, and certification.  
**Security:** Individual six-digit PINs, machine scope, memory-hard verifier, versioned grants, backoff, and two-minute service lock.  
**Blocks:** Only implementation and production staff-mode acceptance testing.

## D-08 — Support destination and customer language

**Owner decision:** The QR/link opens a Ten Kings customer-support page offering email, text-message, and phone-call choices. Use only a short opaque transaction reference and exact paid doors; no raw provider ID or personal data.  
**Deployment configuration:** Admin supplies the production page URL, email destination, text number, phone number, and displayed support hours before production activation. No further blueprint decision is required.  
**Blocks:** Production configuration and final support runbook, not implementation.

## D-09 — Certification governance

**Owner decision:** A Ten Kings Technician or Admin may approve each machine's pre-field certificate.  
**Owner decision:** Retain certification evidence for the machine's complete service life plus three years.  
**Evidence still needed:** Certificate invalidation/recertification matrix, allowed Nayax test mode, release-signing rules, and pilot stop criteria. The certificate remains bound to source/app/schema/config/tax/Nayax/controller/map/hardware versions with zero tolerance for wrong-door or unpaid-door actuation.  
**Blocks:** External certification evidence and launch acceptance, not owner policy.

## D-10 — Resolved: machine configuration signing and enrollment ownership

**Owner decision:** Mark, acting as Admin/owner, owns machine enrollment and security-key management.  
**Implementation:** Unique per-machine revocable credentials and server-signed immutable config; Admin-only issue/approve/rotate/revoke/recover/decommission authority; one-time expiring token for an authorized Technician performing physical installation; no shared kiosk/operator secret.  
**Blocks:** Only implementation and security validation, not an owner-policy answer.

## D-11 — Future V2 identity bridge

**Future question:** If a later project links Vault-sold physical packs or cards to Card Platform V2, what identity and ownership model should that bridge use?  
**Locked V1 decision:** Keep Vault V1 anonymous and separate. Do not infer or write V2 identity or ownership.  
**Blocks:** Nothing in Vault V1. This question belongs to a future integration project and is not required to build or launch independent Vault V1.

## Decision record template

```text
Decision ID:
Decision:
Approved by:
Date/time and timezone:
Evidence reviewed:
Allowed phases/actions:
Rejected alternatives:
Required follow-up:
Session-log entry or approval link:
```
