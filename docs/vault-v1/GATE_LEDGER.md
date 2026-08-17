# Vault V1 Evidence Gate Ledger

No gate is closed by assumption. Dates below record the owner decisions carried by the final August 16, 2026 package; external evidence rows remain open.

| Gate | Status | Evidence/decision | Approver | Affected real action |
|---|---|---|---|---|
| G-01 Nayax | OPEN—mock contract only | Exact Marshall kit/SDK/runtime/flow, limits, callbacks, reconciliation, test mode, certification, and written no-sensor vend-result rule are unavailable. | Nayax + Mark | Official/live adapter and any real charge |
| G-02 controller/electrical | OPEN—simulator only | Controller/firmware/protocol/channel map and electrical/thermal/EMI/fail-safe evidence are unavailable. | Technician/Admin + qualified hardware evidence | Real serial command and cabinet actuation |
| G-03 tax | POLICY CLOSED; machine config open | Admin manually enters city/state/percentage; integer basis points; half-up subtotal rounding; signed/versioned sale snapshot. Each real machine still needs a reviewed rate. | Mark, 2026-08-16 | Production checkout per machine |
| G-04 screen/Windows/enclosure | OPEN—responsive software tests only | Final screen/PC/scaling/touch/enclosure/assigned-access evidence unavailable. Elo 1304L remains a candidate. | Technician/Admin | Installed appliance acceptance |
| G-05 cloud outage | POLICY CLOSED | Block new checkout when Ten Kings cloud is unavailable; continue active/authorized fulfillment and retry locally. | Mark, 2026-08-16 | Implement/test now; future offline-payment policy separately gated |
| G-06 staff/support | POLICY CLOSED; deployment values open | Approved role matrix; email/text/call support with hours; no automatic substitute/credit/refund. Real URL/contact values are Admin configuration. | Mark, 2026-08-16 | Production service/support activation |
| G-07 certification | POLICY CLOSED; evidence open | Technician/Admin may approve pre-field certification; retain service life + 3 years; Mark/Admin owns enrollment/keys. Test-mode, recertification, release signing, and pilot-stop evidence remain. | Mark, 2026-08-16 | Certificate, pilot, launch |

## Operational authorization ledger

- Authorized: local code, additive migration source, deterministic mocks/simulators, local/disposable tests, documentation, commits, push, ready PR.
- Not authorized: applying any migration, production/staging deploy or restart, production data access/mutation, live payment, Nayax activation, real controller command, physical actuation, credential change, PR merge, pilot, or launch.
