# Controller review and next bench steps — September 17, 2026

Reviewed in `df09`, branch `codex/vault-integration-20260917-9ddb13`, imported base `c4f04006d9302445e2a68b01dcc316def3b4eb73`. Read all 1,638 lines of the owner-approved V2 blueprint, the other five required context/runbook/handoff documents (current/relevant handoff history), and the frozen September 17 `START_HERE.md`. Vault remains separate from V2/card-platform work; accepted Portrait B is unchanged. The lead owns conversation, host actions, shared integration and `SESSION_LOG.md`.

The reviewed starting state includes owner/photo evidence of Omarchy and Codex on the SER. The older BENCH_PROGRESS opening paragraphs and controller receipts that still ask whether Omarchy is installed are historical, superseded by `FRESH_ASTRA_LEAD_HANDOFF_2026-09-17.md`. Actual board/adapter identification, serial I/O, relay output, coil current and physical release remain unobserved. This review performed no device open, output, payment, remote mutation, dependency installation or build.

## Received equipment: evidence versus missing facts

| Item | Preserved evidence | Required observation before use |
| --- | --- | --- |
| Controller | Owner reports **one** Waveshare Modbus RTU Relay 32CH; purchase reference SKU25140 / B0CC5P8NC2 | Readable received model/revision and power/RS485/contact terminal labels; actual address/settings and firmware readback. Neither address `1` nor firmware `100` is established. |
| USB–RS485 | Ordered/received report names INNOMAKER USB2RS485-C / USB2RS485-CABLE, B0B2QSW67D | Actual adapter model, breakout pin numbers and continuity, jumper position, Linux enumeration and exact stable device path. Do not substitute the separate Nayax USB–RS232 adapter. |
| Board/lock supply | CHANZON B073QTNF9F, seller reference 12 V/5 A and center-positive 5.5×2.1 mm barrel | Received label, breakout identity, disconnected measured voltage/polarity and protection for the actual conductors/connectors. Keep SER, display and Nayax power distinct. |
| One accessible lock | ATOPLEE B01IBEVV0Y, reported 12 V/2 A, seller maximum single signal 0.2 s | Coil versus sensor leads, actual polarity, pigtail/connector rating, built-in suppression/electronics, secured mechanism, release and later waveform/duty evidence. Seller data is not qualification. |
| Distribution/protection | Owner has WAGOs/wire/meter; preserved electrical plan is revision `2026-09-11-electrical-r2` | Actual WAGO/wire identity and ratings. F1 Littelfuse MINI 3 A/covered holder and D1 Vishay 1N5408 are **conditional proposals**, not confirmed purchases/receipt or blanket wire qualification. |
| Cabinet/bus | Accepted UI shows 68 positions in 4×17; one board has 32 outputs | Actual door count, wiring routes, independently identified channels, required capacity and full map are unknown. The earlier KWANGIL cable reference is not receipt or measured routing evidence. |

The frozen electrical record supplies the reviewed proposed topology and conditional parts; it does not verify the received unit. Current official [Waveshare product information](https://www.waveshare.com/Modbus-RTU-Relay-32CH.htm) describes 32 outputs and default 9600/8N1. Its indexed [32CH protocol](https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH) confirms FC03 address/version reads, FC01 all-output status and FC05 timed flash-on in 100 ms units. Direct Waveshare retrieval was blocked; indexed official content was readable. The [INNOMAKER manual](https://www.inno-maker.com/wp-content/uploads/2022/06/USB2RS485-C-UserManual-v1.0-EN.pdf) was retrieved; it identifies FT230X, isolated RS485 and Linux support. These published facts do not identify the received hardware or its configured address. The preserved independently checked manual pinout is DB9 1=A, 2=B, 5=isolated reference; identify stamped pins/continuity rather than screw order or viewing direction.

## Confirmed integration findings and bounded corrections

1. **Physical source gate was only on new certification, allowing ordinary restock from an unverified build.** `cli.ts:20,39` accepts a nonempty source string, and `store.ts:88–93` stores it at startup. `operations.ts:123–127` checked 40-hex provenance only when creating a new certification session. Ordinary `startOrResumeRestock` reaches `ensureNextRestockCommand` (`operations.ts:248–263`) and shared dispatch without that check. Resuming an existing certification also skipped the new-session check. An otherwise ready injected non-MOCK controller, qualified signed profile/map and valid staff session could therefore dispatch with `UNVERIFIED`, `UNCOMMITTED_CANDIDATE` or `CANDIDATE_SHA256:...` source identity.

   Lead-owned correction adds `CONTROLLER_BUILD_IDENTITY_UNVERIFIED` to readiness and the common physical dispatch guard (`machine.ts:191` and the guard preceding the dispatch transaction). It leaves the intent unsent and persists halt/recovery. `tests/source-dispatch-review.test.js` adds seven cases: all three candidate markers via ordinary restock; existing certification continuation; an already committed paid intent; trusted-40-hex positive; and MOCK candidate positive. A 40-hex string is the existing candidate-exclusion contract, not independent proof of source trust; reviewed signed release provenance remains required.

2. **Helper death during the final OFF wait could be recorded as success and clear a fault.** After the final all-board readback, `waveshare-controller.ts:143–144` awaits `minimumOffMs`. Previously it then persisted ACCEPTED without checking helper health. `waveshare-serial.ts:84,139–142` marks a dead helper unhealthy, but that does not itself interrupt the controller's sleep. If an identity poll noticed death during that wait, `identity()` latched a halt that `waveshare-journal.ts:65` subsequently cleared when completing the success receipt.

   Coordinated lane correction at `waveshare-controller.ts:145–150` checks real-helper health and that the initialized adapter still owns its expected `WAVESHARE_COMMAND_IN_FLIGHT` journal halt immediately before success. It does not require an unhalted journal: the pre-write halt is intentional. Failure takes the existing SENT_UNKNOWN path. Two focused additions in `tests/waveshare-controller.test.js` inject death after final all32 readback, with and without an intervening identity poll, and require one pulse only, queued rejection and a halt retained after journal reopen. No physical process-death result is inferred from these fixture tests.

These are the only code corrections proposed/implemented by this review. The lead cross-reviewed the OFF-gap change and added a five-second timeout to each new race case. This lane independently reviewed the final common source guard at `machine.ts:621–631`: it applies before every non-MOCK dispatch transaction, persists halt/recovery plus an event/state-version change, leaves the command queued, and leaves MOCK dispatch unchanged. Its readiness reason matches the dispatch gate. No further correction was found within this bounded review.

The lead reports successful contracts/machine TypeScript builds and **7/7** source-dispatch tests. The lead's separate controller/physical-dispatch/audit run passed **39/39**, including both new OFF-gap cases; this lane independently inspected `outputs/vault-integration-2026-09-17/dispatch-controller-regression.tap` with 39 passes, zero failures/cancellations/skips. These are focused Mac hardware-free results using existing dependencies, not a newly executed whole-machine suite, native Linux acceptance, a serial device test or physical qualification. No broad 173/179-test total is claimed.

## Boundaries that remain intact

- **Inspect exit 0 does not mean all-OFF.** `waveshare_bench.py:329–340` returns both the actual ON-channel list and OFF boolean; `main():505–510` returns 0 after a valid read even if channels are ON. Advancement must require `channelsReportedOn: []` **and** `allRelaysReportedOff: true`. `physicalContactsVerifiedOff` remains false. The pulse preflight independently rejects reported ON at `431–432`.
- **Every board, all 32 outputs.** Service `assertAllOff()` reads every configured endpoint and rejects any true output, including unmapped channels (`waveshare-controller.ts:166–169`). It never synthesizes `observedDoorId` from the echo.
- **Consume before output.** Bench attempt file and parent directory are fsynced before the pulse (`waveshare_bench.py:181–201,440`). Service `journal.begin()` atomically stores the command and in-flight halt (`waveshare-journal.ts:47–54`) before the physical request. Unknown/interrupted records survive restart and cannot be retried automatically.
- **Shared ownership and process termination.** Bench and service use the same fixed host-wide guard, plus serial flock/TIOCEXCL. The service helper's close path waits for observed process close (`waveshare-serial.ts:109–118`). ACK/OFF is board state, not physical current cutoff, contact-open proof, door opening, or Nayax vend success.
- **Qualified mapping remains explicit.** The signed schema-2 QUALIFIED profile, exact door/endpoint/channel/profile digest, local observed board settings and reviewed qualification digest remain required. No fixture, arbitrary hash, UI grid or example board address establishes physical authority.

The immutable journal binding includes the entire Waveshare config, including qualification digest and `mappingVersion`. Creating it while unqualified then editing the digest correctly prevents reopening. Finish standalone bench qualification **before** initializing the normal service ledger; never delete/replace an existing journal to get past a mismatch.

There is also a fail-closed configuration lifecycle limitation, not a first-bench bypass: every signed config activation writes `door.mapping_version=String(config.version)` (`config-manager.ts:124–126`), even with the same physical map. The adapter requires its fixed version (`waveshare-controller.ts:120–121`), while changing that version changes the journal binding (`45`, `waveshare-journal.ts:33`). A future price-only/config-version update therefore needs an explicit reviewed binding-transition contract before service use. Do not weaken immutable identity or add an automatic migration in this bench task.

## Minimal ordered hardware progression for the lead

1. **Observe the actual parts unpowered.** Obtain readable board, adapter/breakout and supply labels; confirm every relay contact has no external load attached. Resolve actual adapter pinout, board address and fixed 9600/8N1 evidence. No scan, broadcast, configuration write or address-1 guess. Connect only the identified USB adapter to enumerate it; enumeration alone does not open the serial device.
2. **Verify the unchanged standalone tool and host prerequisites.** Use the lead's verified SER connection/source transfer. Confirm Python, exact script hash, native adapter driver, stable `/dev/serial/by-id/...` link and device permission. Inspect existing `vault` account and `/var/lib/ten-kings-vault-bench` state. The dedicated operator and later service share that real mode-0700 directory; preserve all existing records. Keep the normal service stopped. Setup mutations belong to the lead, derived from actual observations.
3. **Check disconnected power and unpowered wiring, then inspect only.** Compare measured supply voltage/polarity and actual terminal functions against the frozen electrical plan, with protection appropriate to the selected board-supply wiring. Use one board power input and one board on the bus. Do not assume RS485 reference equals board DC negative. Once observed setup and explicit address agree, run the single `inspect` command below and retain new stdout/stderr/exit evidence. Stop on error, mismatch, unexpected ON output or occupied ownership; do not automatically repeat it.
4. **One unloaded nominal 100 ms pulse.** With all external loads still disconnected, identify one physical channel and verify COM/NO/NC by unpowered continuity. Use that channel/address plus the observed firmware register and exact `pulse-unloaded` declaration. Preserve the create-only attempt/result/success files; nominal pulse/echo/OFF does not measure contact timing.
5. **One same-setup accessible lock pulse.** First verify coil leads/polarity and suppression, the actual pigtails/connectors and suitable F1/D1, insulated COM/NO wiring (NC unused), a secured accessible mechanism and reachable disconnect. The retained successful unloaded records must match host, device, address, channel and firmware exactly. Only then give the existing `pulse-lock-once` command with its full declaration. After that single pulse, remove lock supply power, inspect and record direct release/abnormal behavior. No longer pulse, automatic retry or evidence deletion.
6. **Measure and qualify before normal service output.** Establish actual contact/coil timing and current decay, duty/cooling, protection, host/controller-loss and restart behavior, physical map/capacity and required unattended stuck-contact mitigation. The slow-reading meter cannot resolve the 100–200 ms waveform; never extend energization for a reading. The preserved electrical review distinguishes this supervised first-pulse procedure from unattended qualification; no unowned cutoff device is newly imposed as a universal first-pulse prerequisite. Only completed reviewed evidence can support the qualified service profile/ledger, later cabinet certification and separate Nayax test integration.

The next bounded **read-only host commands**, for the lead after actual access and adapter identification, are:

```sh
python3 --version
sha256sum /VERIFIED/SOURCE/packages/vault-machine/scripts/waveshare_bench.py
python3 /VERIFIED/SOURCE/packages/vault-machine/scripts/waveshare_bench.py --help
ls -l /dev/serial/by-id/
id vault
stat -c '%F %U %G %a' /var/lib/ten-kings-vault-bench
```

Expected bench source SHA-256: `22c71b0dc8e7ea4043d72bede34867b723ec58c357a1b9ad153f3f2851f4e290`. Missing account/directory/device information is an observation to resolve, not permission to reset state. Placeholders are not runnable settings. Only after steps 1–3 are satisfied, the existing read-only device command is:

```sh
sudo -u vault /OBSERVED/PYTHON3 /VERIFIED/SOURCE/packages/vault-machine/scripts/waveshare_bench.py inspect --device /dev/serial/by-id/OBSERVED_ADAPTER --address OBSERVED_ADDRESS
```

No pulse command is ready to supply with concrete values yet. The lead must first observe the selected channel, address, firmware and received electrical setup.

## Preserved evidence checked

All 17 members of `/Users/markthomas/tenkings/vault-handoffs/2026-09-17-fresh-astra-lead/adjacent-24e6` matched `adjacent-manifest.json` sizes and SHA-256 hashes. The active standalone bench source and its 36-test source remain byte-identical to those frozen copies:

- `scripts/waveshare_bench.py`: `22c71b0dc8e7ea4043d72bede34867b723ec58c357a1b9ad153f3f2851f4e290`.
- `tests/test_waveshare_bench.py`: `2c44f07cb7f6a12d2b074a0ee387bc44fb659483bab9fbddeb8d7592900d904b`.

Read preserved `BENCH_SETUP_2026-09-11.md`, controller `CONTROLLER_HANDOFF.md`/`evidence-summary.json`, electrical `sources+unknowns.md` and `connection-data.json` revision `2026-09-11-electrical-r2`, plus current integration/bench documents and controller receipt. Earlier tests retain their recorded fixture-only scope. All frozen worktrees and handoff snapshots remain unchanged.
