# Waveshare 32CH service integration — September 16, 2026

The imported checkout now contains a real Linux serial service adapter candidate, alongside the preserved September 11 supervised bench CLI. No physical device was opened or commanded in this implementation. All ordered parts are **owner-reported received** in the newer September 11 bench handoff; actual connections, observed controller identity, electrical qualification and a door opening remain unverified. One 32CH board is recorded as purchased. The 68-door visual arrangement is not a controller map.

## Reused source and protocol

Copied byte-identically from preserved worktree `24e6`:

| File | SHA-256 |
| --- | --- |
| `packages/vault-machine/scripts/waveshare_bench.py` | `22c71b0dc8e7ea4043d72bede34867b723ec58c357a1b9ad153f3f2851f4e290` |
| `packages/vault-machine/tests/test_waveshare_bench.py` | `2c44f07cb7f6a12d2b074a0ee387bc44fb659483bab9fbddeb8d7592900d904b` |

The [official Waveshare 32CH protocol](https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH), rechecked September 16 through the indexed official page after direct retrieval returned 403, specifies function 03 identity registers `0x4000` and `0x8000`, function 01 for output bits, and function 05 flash-on channels at `0x0200–0x021F` with 100 ms units. The service retains the previously reviewed fixed value of **one unit: nominal 100 ms**. It has no ordinary ON, toggle, bulk output, address/baud write, broadcast, cleanup OFF or variable-duration action. Supported explicit unicast addresses are 1–247; channels are 1–32. Firmware/address registers do not identify a unique board or prove the physical product model.

The [INNOMAKER product documentation](https://www.inno-maker.com/product/usb2rs485-cable/) identifies an FT230X and isolated RS485 transceiver and lists Linux support. This establishes a supported interface direction, not evidence about the received adapter or its actual host driver. Nayax RS232 is a separate connection.

## Composition and configuration

New source files are `waveshare-protocol.ts`, `waveshare-serial.ts`, `waveshare-journal.ts`, and `waveshare-controller.ts` under `packages/vault-machine/src/`.

Composition order:

1. Validate `WaveshareControllerConfig` with `validateWaveshareConfig`.
2. Open `WaveshareCommandJournal` at a protected persistent sidecar path using `waveshareBindingDigest(config)`.
3. Construct `LinuxWaveshareSerialTransport` with the same exact `devicePath`, `serialFormat`, and endpoint addresses.
4. Construct `WaveshareControllerAdapter(config, transport, journal)` and call `initializeReadOnly()`.
5. Pass that adapter to the existing local machine authority; close it during orderly shutdown after machine work settles.

The strict config includes the adapter ID `waveshare-modbus-rtu-relay-32ch-v2`, mode `OFFICIAL_TEST`, exact `/dev/serial/by-id/...` path, fixed `9600/8N1`, explicit endpoint IDs/unicast addresses/expected firmware register values, exact door mappings, mapping version, profile digest, `pulseMs:100`, `offSettleMs` from 300–5000, `minimumOffMs` from 100–60000, and a nullable `qualificationEvidenceDigest`. No observed host values are supplied by defaults. The qualification digest must bind reviewed physical/electrical/pulse/mapping evidence; writing an arbitrary hash does not create that evidence. Null permits read-only initialization but keeps output readiness false. The service composition additionally requires the signed schema-2 QUALIFIED profile and exact matching mapping before real output.

This adapter is OFFICIAL_TEST only. It does not authorize LIVE payments or provide a Nayax implementation. First characterization of the received unqualified bench remains the preserved `inspect` → `pulse-unloaded` → `pulse-lock-once` procedure and its existing exact setup requirements, not a fabricated QUALIFIED customer profile.

## Serial and physical-effect lifecycle

The Node adapter launches a bounded Python child using Python's standard library and imports only the already-tested transport/protocol/guard from the copied bench source. The copied file's historical top-of-file “Never imported by the Vault service” scope statement is superseded by this deliberate reuse; its bytes remain unchanged for provenance. `-I`, no shell, bounded JSON lines, exact response IDs, command/address allowlists, strict CRC/address/function/count/echo validation, and response deadlines govern the boundary. The actual child shares the bench tool's fixed host-wide `GlobalBenchGuard`. Keep `/var/lib/ten-kings-vault-bench` as a real directory owned by the service/operator user with mode 0700. The helper holds that guard throughout its lifetime, so the service and supervised bench CLI cannot own different ports/boards simultaneously. It never reads, resets, deletes or changes the one-shot bench records.

The underlying transport also acquires serial `flock` and `TIOCEXCL`, resolves the exact stable symlink, checks the opened character-device identity, and rejects stale, extra, truncated or malformed input. Errors poison the session. There are no transport retries. The parent bounds the helper startup and exchange, kills a failed helper, and observes process closure before reporting termination. A close failure leaves the output latch uncertain.

One adapter queue owns **all configured boards**, including their unmapped output channels. Before an energizing write it verifies each board's expected address/firmware and all 32 output bits. The journal atomically records the immutable command identity and a halt before the pulse can be sent. After the one 100 ms board-timed command and exact echo, the queue waits the full pulse plus settle interval, verifies all outputs on all boards are reported OFF, then holds the minimum OFF interval. Only then may it persist an ACCEPTED/OFF_VERIFIED receipt and release the queue. It does not populate `observedDoorId` from a relay ACK.

Lost acknowledgements, output bits remaining ON, wrong firmware, corrupt/truncated replies, disconnects, storage errors and helper failures halt output. A post-write failure remains SENT_UNKNOWN/UNCERTAIN. An idle helper exit also invalidates readiness and persists the halt at the next identity probe. The queue rejects following commands while preserving the old effect record. Success replay returns the durable receipt without another pulse; changed reuse of a command ID fails closed. Startup reads do not clear a durable halt. Reopening the same journal with changed configuration is rejected, and the adapter rejects a journal or real transport bound to different configuration. This includes changing the qualification digest after an unqualified service initialization: finish qualification through the preserved bench path before creating the service ledger, or undertake an explicit reviewed ledger transition. Never delete or replace an existing ledger to bypass that binding. The sidecar must accompany the primary database in preservation/backup planning.

`recoverReadOnly(evidenceSha256)` is an explicit operator recovery method. It terminates the previous helper, reacquires the shared host/serial ownership, waits beyond the supported timer, verifies current identity/all-output-OFF, then records a recovery reference. The caller must enforce authenticated staff authority and resolve the machine's separate sale/automation halt. This method sends only reads; it never repeats a command, sends cleanup OFF, rewrites a prior SENT_UNKNOWN receipt or pretends an unknown vend succeeded. Replaying a historical uncertain command relatches the adapter. No automatic recovery route is added.

## Evidence and limits

Hardware-free validation in this checkout:

- 36 preserved Python protocol/durability/PTY/child-process tests passed.
- 15 service tests passed for official vectors, strict mapping/authority, qualification gating, cross-board non-overlap, unmapped output states, ACK/readback/CRC faults, persistence failure, durable replay/restart and explicit recovery.
- 5 new real Python-helper process tests passed for bounded request/response operation, configured address enforcement, timeout, exit, excessive output, bad CRC, observed child termination and no reuse after error. The child uses an injected fake serial module and opens no tty.
- 5 independent machine-dispatch review tests passed: missing-OFF acceptance becomes unknown, uncertain/time-out receipts halt even if they claim OFF, historical schema-1 profiles cannot dispatch physical diagnostics, and mixed diagnostics remain AUTOMATED without authorizing customer payment. The old 12 audit tests and 9 kiosk certification HTTP/UI tests also pass after their fixtures supply explicitly fabricated qualified-profile and OFF evidence.
- Independent payment-lane review reproduced idle helper death through the actual Python helper, then confirmed the corrected readiness and durable halt in `marshall-controller-review.test.js`.
- TypeScript machine build passed. Broader integrated validation and independent review are recorded by the lead in `SESSION_LOG.md`.

Commands: `python3 -m unittest discover -s packages/vault-machine/tests -p test_waveshare_bench.py -v`; build the machine package, then run Node 20 `--test` on `waveshare-controller.test.js` and `waveshare-serial.test.js`.

These results prove software behavior against fixtures. The actual Linux tty open, FTDI behavior, board address/firmware, contact timing, current, coil suppression/protection, release, physical mapping and restart/host-loss behavior still need the supervised bench. The ATOPLEE seller's 200 ms maximum claim is unqualified. Nominal 100 ms command timing is not measured lock acceptance. Board-reported OFF cannot detect a welded contact or prove zero coil current. A single software queue is therefore a necessary control, not full unattended-cabinet electrical qualification.

No live payment, lock actuation, operating-system install, production mutation, migration, deployment, purchase, vendor message, commit or push occurred in this lane. Protected worktrees `3c63` and `24e6` remain unmodified.
