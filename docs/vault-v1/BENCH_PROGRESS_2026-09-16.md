# Controller bench progression — September 16, 2026

**Current native startup — September 17:** Mark authorized startup after transfer. An isolated working copy at `/home/tkvault/vault-native-r3-20260917.mVRi5N` passed 363 native tests, the SQLite durability probe, source integrity recheck, mock purchase smoke and two clean stop/start checks. Portrait B is running at `http://127.0.0.1:55497/?experience=portrait` on the SER and its Chromium window is open. This is a disposable mock preview, without real doors/payments or boot autostart. The original transfer remains unchanged. See [native acceptance and restart instructions](SER_NATIVE_ACCEPTANCE_2026-09-17.md). Earlier access/transfer-only/native-pending descriptions below are historical.


The next controller milestone is **read-only communication with one received Waveshare board, with every external relay load disconnected**. Nayax API access is not required. Owner reports the ordered equipment is present and wants Omarchy; Omarchy and its graphical Codex view are already installed by owner/photo evidence. Current authenticated SER access, controller connections and physical operation remain unverified. This checklist records pending work, not completed hardware tests.

The current September17 lead owns imported `df09`; access is pending after a timeout to the last observed SER address. Resume with local address/key verification, then native software and received-controller discovery. Preserve the working SER/video/keyboard/network setup and give only a few physical steps at a time.

## First three facts to collect

1. **Actual installed SER runtime:** authenticated access, installed Omarchy/architecture/tool versions including `python3 --version`, mounted root and free space. Installation is complete; preserve it. The current source candidate is unsigned and may run simulation, not normal physical service dispatch.
2. **Received controller connection identities:** readable board model/revision and power/RS485 terminal markings, INNOMAKER model and numbered breakout, and the 12 V supply label/output connector. Confirm every relay contact has no external load attached. Photos/observations establish these; schematic screw order and wire colors do not.
3. **Actual serial configuration:** an evidenced unicast board address in `1–247` and compatibility with fixed `9600/8N1`. After the identified USB adapter alone is connected, record its exact `/dev/serial/by-id/...` path. Address `1` in vendor examples is not evidence of this unit's address. If the address is unknown, resolve its documented configuration before running this tool; there is no scan, broadcast or configuration-write fallback.

## Stage 1 — Prepare the unchanged tool offline

Transfer `packages/vault-machine/scripts/waveshare_bench.py` from this checkout to the SER using the owned USB drive or an already working local connection. Its SHA-256 must be:

```text
22c71b0dc8e7ea4043d72bede34867b723ec58c357a1b9ad153f3f2851f4e290
```

It is byte-identical to the preserved September 11 candidate. Python 3 standard-library modules provide serial I/O, CRC parsing, durable records and process locking. No pip, npm, Node, cloud credentials, Nayax library or network package installation is needed **if Python 3 and the actual adapter's Linux driver are already present**. Their presence on this SER remains to be checked. `python3 /absolute/path/waveshare_bench.py --help` only parses CLI help and does not open hardware. USB transfer alone does not install Omarchy or the customer service.

Before inspection, prepare the dedicated `vault` user, its exact serial-device permission and the real `/var/lib/ten-kings-vault-bench` directory owned by `vault`, mode `0700`. Check any existing state first; preserve it and its ownership rather than resetting it. Both the bench CLI and later service must use this same user/directory so their global lock coordinates them. A valid Linux `/etc/machine-id` is required; the tool hashes it internally, and the raw identifier need not be posted. The lead should derive host setup commands from the actual OS/account/device observations. Close other serial applications and leave the Vault service stopped for the standalone bench.

## Stage 2 — Inspect one board, without a relay command

Before board power or RS485 wiring, verify the received terminal functions and supply's measured DC voltage/polarity with the disconnected setup. Keep SER 19 V, screen and Nayax power separate. Review the unpowered September 11 electrical plan against the actual parts, including appropriate protection for the chosen board supply wiring. Use only one board power input. The referenced INNOMAKER manual identifies DB9 `1=A`, `2=B`, `5=isolated GND`; identify stamped pins/breakout continuity rather than assuming screw order or connector viewing direction. The RS485 reference is not an assumed bond to board power negative. No external relay load connects at this stage.

Once those observations are recorded, substitute the verified Python/script paths, exact adapter identity and evidenced address into this **template**:

```sh
sudo -u vault /ABSOLUTE/PYTHON3 /ABSOLUTE/waveshare_bench.py inspect --device /dev/serial/by-id/OBSERVED_ADAPTER --address OBSERVED_ADDRESS
```

Retain stdout, stderr and exit status in new local evidence files. The command reads the address register, firmware register and all 32 output bits. Record the returned integer `firmwareRegister`, exact device identity and request/response trace. Advancement requires successful communication, `channelsReportedOn: []` and `allRelaysReportedOff: true`. `physicalContactsVerifiedOff` correctly remains `false`: register state does not measure relay contacts. A timeout, mismatch, unexpected ON state or occupied lock is a stop for investigation, not an automatic retry or settings change.

## Stage 3 — One unloaded relay pulse, then one accessible lock

- With all external loads still disconnected, identify one physical channel and check its COM/NO/NC functions with unpowered continuity. The preserved `pulse-unloaded` command permits one nominal **100 ms** timed pulse after explicit setup confirmation and fresh identity/all-OFF checks. Use the actual inspection firmware value. Retain its create-only attempt/result/success records. The nominal setting is not a measured contact duration.
- Before connecting the sole secured, accessible lock, establish actual coil leads/polarity, any built-in suppression, pigtail/connector rating, measured supply polarity/voltage, wire-appropriate F1 fuse/holder, verified D1 suppression and insulated COM/NO wiring; NC remains unused. The September 11 candidate 3 A fuse and 1N5408 diode were proposals, not confirmed received parts or blanket qualification. The electrical review must fit the received parts. Keep the supply disconnect immediately reachable and the unloaded mechanism away from fingers.
- Only after successful unloaded evidence and those observations may the lead give the exact `pulse-lock-once` command and confirmation. It must use the same host, adapter, board address, channel and firmware. After that one nominal 100 ms pulse, remove lock supply power and inspect. Record whether the mechanism released and any abnormal behavior. Do not extend the pulse, repeat it after uncertainty, or remove one-shot files. The tool has no reset command.

The seller's 0.2 s maximum is unqualified. Software ACK/OFF evidence and a visible release cannot qualify actual ON duration, current decay, thermal/duty behavior or stuck-contact recovery. The owned slow-reading multimeter can support static checks; it cannot resolve a 100–200 ms waveform, and energization must not be prolonged for a reading. A separate automatic cutoff is an unresolved unattended-operation mitigation, not an established universal prerequisite added to this supervised first-pulse procedure.

## What one lock establishes, and what remains for 68 doors

| Milestone | Evidence required | Resulting scope |
| --- | --- | --- |
| Read-only board check | Received identity, stable adapter path, actual address/firmware and all-OFF trace | Communication with this board only |
| One supervised lock test | Same-setup unloaded records, received electrical checks, one lock pulse records and direct release observation | This accessible lock/setup only; timing and endurance remain pending |
| Complete 68-door profile | Every physical door/controller/channel mapping, sufficient controller capacity, approved electrical/pulse/fault/duty evidence, signed qualified profile and trusted load/restock records | Cabinet commissioning; one owned 32CH board cannot supply 68 independent channels |
| Payment-to-door acceptance | Qualified physical setup plus official Nayax access, terminal test configuration and verified transaction/recovery evidence | Separate integrated acceptance; expected API access later today is not a passed test |

The service preserves qualification and recovery gates. A mock payment never authorizes physical output. No controller was opened, relay pulsed, lock energized or OS installed while preparing this checklist.

## Authority and evidence

- Preserved procedure: `/Users/markthomas/.codex/worktrees/24e6/ten-kings-mystery-packs-clean/docs/vault-v1/BENCH_SETUP_2026-09-11.md` and `outputs/vault-bench-2026-09-11/controller/CONTROLLER_HANDOFF.md` in that same worktree.
- Preserved received-unit electrical prerequisites: that worktree's `outputs/vault-bench-2026-09-11/electrical/sources+unknowns.md` and `connection-data.json`, revision `2026-09-11-electrical-r2`.
- [Waveshare official product](https://www.waveshare.com/Modbus-RTU-Relay-32CH.htm), [official protocol](https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH), [INNOMAKER official manual](https://www.inno-maker.com/wp-content/uploads/2022/06/USB2RS485-C-UserManual-v1.0-EN.pdf).
- Current implementation and hardware-free validation: [WAVESHARE_INTEGRATION_2026-09-16.md](WAVESHARE_INTEGRATION_2026-09-16.md). All physical milestones above remain pending until actual observations are recorded.
