# Vault integration status — September 16, 2026

**Current owner — September 17:** The independent Astra Extra High lead now owns `/Users/markthomas/.codex/worktrees/df09/ten-kings-mystery-packs-clean`, branch `codex/vault-integration-20260917-9ddb13`. All 29 tracked changes and 127 untracked files were imported and verified from the frozen September17 handoff. Three fresh Astra/xhigh workers cover appliance/native, controller/bench and payment/Nayax; the lead owns shared runtime/contracts/UI and remote mutations. Accepted Portrait B remains unchanged. See the latest `SESSION_LOG.md` and external receipt `/Users/markthomas/tenkings/vault-handoffs/2026-09-17-df09-receipts/verified-takeover.json`.

**The real selected-door payment/unlock milestone has not occurred.** SSH and transfer succeeded, followed by newly authorized native startup. The isolated SER working copy passed all 363 native tests, SQLite/source/simulator checks and two process restarts. Portrait B is running in disposable mock mode and open in Chromium; real hardware/payment and installed service acceptance remain pending. See [native acceptance and restart instructions](SER_NATIVE_ACCEPTANCE_2026-09-17.md).

**Completed transfer-only milestone — September 17 (before subsequent startup authorization):** Explicit authorized-key SSH login succeeded as `tkvault` on `tk-vault-01`. Candidate-r3 and continuation-r3 are now under `/home/tkvault/vault-transfer/ten-kings-vault-r3-20260917T195409Z-5fdfa5ea`; independent remote verification passed all206package files, exact membership and trusted hashes. Remote `TRANSFER_VERIFICATION.json` records the result. Existing files/installations were preserved. No package code or Vault process was launched.

**Earlier September17 access check (superseded):** Mac en0 remains `192.168.2.21`; its public key and loaded SSH identity both have fingerprint `SHA256:PObuF9eh2j/jkC8hHkWwq1finAFgXlsbo8hamQQEvGQ`. A bounded strict-host-key SSH attempt to last observed SER `tkvault@192.168.2.36` now times out before authentication. This does not establish a changed IP or stopped service; the SER's current local network/awake state needs observation. Port8765 has no listener. The earlier download/fingerprint step is still unobserved; do not authorize the file until its fingerprint matches. Preserve existing authorized keys and password authentication off.

September16 photos establish `tkvault`, reported hostname `tk-vault-01`, `wlo1` at `192.168.2.36/24`, enabled key-only SSH and a GitHub key different from this Mac's. The September16 Mac attempt reached SSH but failed publickey authentication. These remain historical observations, not proof of current reachability.

Latest Nayax evidence: on **September16** technical support expected to provide “API access later today.” Delivery remains unverified. Continue other integration work; inspect what actually arrives without asking Mark to repeat vendor contact.

## Preserved source and current work

- Base `c4f04006d9302445e2a68b01dcc316def3b4eb73`; imported candidate remains uncommitted and unsigned. Exact intake manifest SHA-256 `4d56cdaab5e78eb2fa24cb5fa1723429c78439d4fdfd93c0de724cb952443e6c`; tracked diff SHA-256 `e1e52cf30cb73ddea22108600a96a0bf290db66d99465bc9fd34cceaa56953da`. Subsequent dated work is recorded in this destination's session log. Frozen `59f4`, `9bb0`, `3c63`, `2dbc`, `24e6`, main and all prior snapshots remain untouched.
- Current native transfer candidate: `/Users/markthomas/tenkings/vault-handoffs/2026-09-17-ser-candidate-r3`, 186 source files / 35,028,973 bytes, manifest SHA-256 `0a50c296f10dfdee3cde4848b06b5a1306e3067c6e5c3f65e3bdda9f5881cc39`. This contains the September17 source-identity and terminal-health corrections; it is unsigned and physically ineligible. Use current continuation-r3 beside it.
- Immutable SER candidate-r2: 185 payload files / 35,017,097 bytes, manifest SHA-256 `1313aeed7b8232b990236d572dbd2b905570dfa7e9864f4108d8336114fcc05e`. Continuation-r2: 16 total files / 4,765,478 bytes, SHA256SUMS digest `229ff05122fa50ad3be83979f462f15f1609eb3c57e66dcd53bed529d6c34528`. Fresh appliance worker independently reverified membership/bytes/hashes on September17. Neither is a signed/native-qualified release. Keep context outside each exact-file candidate.
- Reused September11 bench source remains byte-identical; its preserved electrical/installation references apply to received-unit observations. [Controller provenance](WAVESHARE_INTEGRATION_2026-09-16.md). Scope remains Vault-only; no broader V2 implementation or migration is authorized.

## Implemented candidate

| Area | Current behavior | Remaining external dependency |
| --- | --- | --- |
| Service composition | Explicit payment/controller choices; missing/unknown choices fail. Mock payment cannot compose physical control. | Real protected enrollment/configuration on the SER. |
| Waveshare service | Linux Python serial helper reuses the preserved bench transport and host lock. Fixed nominal100ms board-timed pulse, one queue across boards, all-output OFF readback, durable consume-before-write, replay protection and uncertainty halt. Startup reads do not clear old uncertainty. | Actual device/address/firmware, electrical and pulse/release measurements, signed physical mapping and qualification evidence. |
| Marshall payment | Strict process contract, persistent intent/callback journal and unavailable adapter. No invented SDK ABI; actual dispatch remains disabled. Original sale/amount/door/address/profile and provider transaction identities remain bound across restart/reconciliation. | Official Linux C SDK and terminal test setup, then verified callback/reconciliation/vend semantics and integration tests. |
| Machine safety | Checks physical adapter readiness and reported OFF per effect. Missing or uncertain completion blocks later commands; unfinished physical dispatch is not replayed after restart. Ordinary physical service commands require a qualified signed schema2 profile. | Physical evidence and an approved no-sensor vend policy. LIVE dispatch remains rejected. |
| Portrait B | Accepted styling/checkout retained. A complete qualified68-door 4×17 profile uses exact signed IDs/labels and geometric ordering; malformed/incomplete shapes fall back to the existing profile renderer. Durable paid recovery retains collection controls; production does not promise an uncharged checkout. | Measured cabinet profile and actual SER/touchscreen acceptance. Synthetic comparison remains explicitly synthetic. |
| Linux/Omarchy | Pinned Node22.23.2/nativeSQLite build recipe, signed release verification, protected config/systemd credentials, exact serial permissions, display plan and guarded maintenance/update tooling. | Native Linux x86_64 build/probe, selected Omarchy installation, touchscreen mapping, restricted kiosk session and observed restart/power-return behavior. |

Detailed records: [Waveshare](WAVESHARE_INTEGRATION_2026-09-16.md), [Marshall](MARSHALL_INTEGRATION_2026-09-16.md), [Linux appliance](LINUX_APPLIANCE_2026-09-16.md).

## Review corrections

September17 review adds two focused corrections: every non-MOCK dispatch now rejects candidate/unverified source identities, including ordinary restock and retained work; controller completion rechecks helper health and the expected in-flight journal state after the final OFF delay so a recorded failure cannot become ACCEPTED. New focused validation is recorded in the session log. The input r2 snapshots remain immutable; a new source revision carries these corrections. [Controller review](CONTROLLER_REVIEW_2026-09-17.md), [native command plan](APPLIANCE_REVIEW_2026-09-17.md) and [payment delivery design](PAYMENT_REVIEW_2026-09-17.md) describe current work. The payment pump remains unimplemented, and official SDK/test access remains unverified.

Independent reviews found and corrected cached controller readiness after helper death; physical receipts claiming acceptance without OFF evidence; paid collection/support screens losing durable authorization during reconciliation; a production review message promising no real charge; a missing transitive dependency in pnpm release copying; mutable-source staging races; referenced configuration trust and FIFO-open issues; and concurrent updater admission. Regressions cover the corrected boundaries. The relocated dependency test uses real SQLite under Mac Node20 and proves dependency completeness only.

Maintenance now stops admitting new HTTP mutations, waits for existing HTTP/runtime work, rechecks durable state and reported physical OFF, then persists service lock. An unsafe preflight leaves the operating service alone; a race detected after draining resumes admission. Update snapshots include the primary database and existing controller/mock sidecars without restoring or rewinding any event/payment/effect history. Release staging/probing precedes the maintenance barrier; host mutations are serialized by a retained deployment lock.

## Validation and its limits

Final local Node20 compatibility checks:

- Contracts:11/11 tests; machine:170/170; kiosk:106/106. Contracts/machine TypeScript and kiosk TypeScript/Vite builds pass.
- Preserved controller Python tests:36/36. Appliance Python behavior tests:20/20. The6 maintenance tests are included in the170 machine total.
- Stocked72-door disposable HTTP smoke: exact selected door, one initial command plus one requested retry, maximum one in-flight command,453 events. All payment and controller effects were simulated.
- Vault isolation validator passes with1,862 checkout paths. This is isolation evidence, not a new full cloud/Next/PostgreSQL validation run; those components were not changed.
- Accepted Portrait B browser suite passed four viewport flows plus no-WebGL and idle recovery. Subsequent payment/copy corrections pass the independent component regressions included in the106 kiosk total; no new visual design was introduced.
- Final whitespace check passes. [Local validation logs](../../outputs/vault-integration-2026-09-16/) include machine, kiosk, contract, smoke, isolation and browser results.

The attempted Docker Linux x86_64 test **never executed a container**. Image extraction failed with an I/O error; another public pull failed with a token-service EOF. The Mac was nearly full (152MiB free at the lowest recorded check), and Docker's socket became unavailable. Retrying stopped. Only this task's regenerable35,215,360-byte source archive was removed; its input hashes and failure logs remain. That archived-source hash is an intermediate attempted input, not the final source identity. No Linux/native/systemd success is claimed, and no unrelated Docker image or user data was deleted to make space.

## Next concrete steps

1. Mark already called Nayax technical support on September16; inspect the promised access when actually delivered. If clarification becomes necessary, the short request is **“Can you send me the Marshall C SDK for Linux and enable our VPOS Touch for integration testing?”** Nayax calls its onboarding contact an integration engineer; hiring an outside engineer is not a stated prerequisite. [Short request and official sources](NAYAX_SDK_REQUEST_2026-09-16.md).
2. After the package arrives, inspect its actual version/headers/Linux sample, implement the native binding and provider normalization, and verify the configured no-money transaction flow before attempting payment. Keep credentials in protected local configuration.
3. SSH access and exact source/context transfer are complete. Await the next authorized scope before native prerequisite setup/build/tests or supervised simulator launch. Preserve the installed Omarchy system; runtime/root/display/touch acceptance remains separate.
4. Follow the preserved bench procedure from read-only identity/all-OFF to the reviewed single unloaded pulse and accessible-lock continuation. Qualify timing/current/suppression and exact mapping before customer-service physical dispatch. A relay ACK/OFF readback is not proof of a door opening or zero coil current.
5. Demonstrate one selected door after the confirmed test authorization, then retain its evidence before expanding to a full cabinet or LIVE operation. The visible68-door layout and one owned32CH board do not establish a complete cabinet wiring map.

No actual serial device was opened, lock actuated, payment made, vendor message sent by Codex, Vault service installed, production changed, database migrated, commit pushed or PR merged. The owner completed the separately authorized Omarchy installation. The old owner preview at `127.0.0.1:55497` remains stopped; successful disposable test fixtures do not mean that preview was restored.
