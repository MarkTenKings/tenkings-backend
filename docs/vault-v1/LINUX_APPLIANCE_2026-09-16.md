# Vault SER5 Linux appliance candidate — September 16, 2026

**Current native startup — September 17:** Mark authorized startup after transfer. An isolated working copy at `/home/tkvault/vault-native-r3-20260917.mVRi5N` passed 363 native tests, the SQLite durability probe, source integrity recheck, mock purchase smoke and two clean stop/start checks. Portrait B is running at `http://127.0.0.1:55497/?experience=portrait` on the SER and its Chromium window is open. This is a disposable mock preview, without real doors/payments or boot autostart. The original transfer remains unchanged. See [native acceptance and restart instructions](SER_NATIVE_ACCEPTANCE_2026-09-17.md). Earlier access/transfer-only/native-pending descriptions below are historical.


Current implementation ownership is `df09`, branch `codex/vault-integration-20260917-9ddb13`, with the September 17 lead and its three new workers. Mark completed the authorized Omarchy replacement; the installed graphical app shows Codex. Preserve that installation and accepted Portrait B. The lead's September 17 connection attempt to the last observed SER address timed out before authentication, so current address/reachability and Mac public-key authorization remain the immediate access checks. No source transfer or native acceptance is established. See [SER bring-up](SER_BRINGUP_2026-09-16.md) and [the current command plan and integrity receipt](APPLIANCE_REVIEW_2026-09-17.md). Native Linux, touch, serial, service and power-return acceptance remain outstanding.

All ordered equipment is owner-reported received; do not repeat arrival or purchase questions. Reuse the September 11 Installation Studio, its electrical connection data and the existing supervised controller script. The preserved original is `/Users/markthomas/.codex/worktrees/24e6/ten-kings-mystery-packs-clean`; imported authoritative bench material is referenced by `docs/vault-v1/BENCH_SETUP_2026-09-11.md` when present. Actual labels, connections and measured behavior remain the authority for hardware acceptance.

## Delivered software and boundaries

`deploy/vault-linux/` contains:

| Component | Implemented behavior |
| --- | --- |
| `appliance.py doctor` | Read-only OS/tool/storage/serial-count discovery; no hardware open, disk writer, partition or network configuration |
| `build-release.py` | Linux x86_64 native build using a checksum-pinned Node archive, frozen pnpm lockfile, machine tests and disposable SQLite probe; rejects dirty source and existing output |
| `appliance.py manifest/verify` | Exact-file Ed25519 signature and hashes; rejects extra members, links, traversal, altered bytes/modes, wrong platform/runtime |
| `appliance.py install` | Plan by default; `--apply` creates service user and protected config, stages/probes signed bytes, atomically selects release, registers **disabled/stopped** service |
| `appliance.py restart/update` | Plan by default; `--apply` consumes authenticated maintenance barrier, stops cleanly, verifies SQLite backups, changes release only for the same schema, starts service; never restores DB automatically |
| systemd unit / `launch.py` | Dedicated non-login `vault` account, protected credential loading, loopback HTTP, restrictive filesystem, durable databases/logs, crash recovery with bounded restart rate |
| `appliance.py bind-serial` | Generates role-specific udev permission rule from an explicitly observed unique USB serial; no generic tty permissions or serial writes |
| `kiosk-session.sh` / autostart fragment | Existing Omarchy Wayland session launches sandboxed Chromium at accepted Portrait B; separate process account from the machine service; duplicate launch excluded with flock |
| `display-plan.py` | Read-only exact-monitor/exact-touch selection; prints reviewed portrait Lua setup without applying it |
| `appliance.py diagnostics` | Loopback health bootstrap and allowlisted metadata; no database, environment, provider/SIM/USB identity, journal dump or credentials |

These are source candidates, not an installed or signed appliance release. The full Linux native build, systemd execution, exact installed Omarchy version, touchscreen behavior and physical serial I/O still require the target. No service restart, package install, disk install, payment, relay command or OS modification was performed while preparing these files.

## Runtime and release identity

The Linux runtime is exact **Node 22.23.2**, **better-sqlite3 11.10.0**, **pnpm 9.12.0**. `runtime.json` pins the official `node-v22.23.2-linux-x64.tar.xz` SHA-256 to `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`, verified against the [Node release checksum list](https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt). Node 20 remains a repository compatibility lane; its current [EOL status](https://nodejs.org/en/about/eol) makes it unsuitable as the new appliance runtime.

Build dependencies on a prepared Omarchy builder are Python 3, OpenSSL, the pinned pnpm, compiler/make, and the verified Node archive. Use official Arch/Omarchy repositories; do not run an arbitrary downloaded setup shell. The script extracts only the regular `bin/node` member after checking the whole archive. Build and load native SQLite on Linux x86_64 under that same executable. Never copy Mac/Windows `node_modules` to the SER.

The packaged probe creates only a disposable temporary database, enables WAL/FULL synchronization, commits, rolls back, closes/reopens and checks integrity. It reports actual Node ABI and SQLite version. This catches ELF/architecture/ABI/shared-library incompatibility before startup. The packaged directory preserves relative imports between sibling `packages/vault-machine` and `packages/vault-contracts`. Runtime files and local kiosk assets ship together; there is no CDN dependency for the approved UI.

After the reviewed code is committed and a Linux builder is available:

```sh
python3 deploy/vault-linux/build-release.py --source /path/to/reviewed-clean-checkout --output /path/to/new-release --node-archive /path/to/node-v22.23.2-linux-x64.tar.xz
python3 deploy/vault-linux/appliance.py manifest --release /path/to/new-release --release-id REVIEWED_RELEASE_ID --source-commit EXACT_40_CHAR_SHA --app-version 0.1.0 --schema-version 3 --signing-key /protected/offline/release-ed25519.pem
python3 deploy/vault-linux/appliance.py verify --release /path/to/new-release --public-key /protected/release-public.pem
```

Use the actual built schema version, source commit and release ID. The signing private key stays off the kiosk; the service reads no signing key. First install pins the separately reviewed public key to root-owned `/etc/tenkings-vault/release-public.pem`; later updates accept only that installed trust anchor. A signature proves authorized bytes, not hardware or payment qualification. Rotation of that trust anchor is a separate maintenance decision.

## SER discovery and OS preparation

Preserve the working matched power, HDMI, wired keyboard and network. After authenticated access, inspect the installed OS/root mount and available native tools, then check the separate USB touch-data path. The known SER rating is 19 V / 3.42 A; do not power it from the lock supply. Do not infer USB-C video/power from the connector shape.

Inspect the installed Linux system through the [read-only SER preflight](APPLIANCE_REVIEW_2026-09-17.md#1-initial-read-only-ser-preflight), then run `python3 deploy/vault-linux/appliance.py doctor` only after source verification. Check the mounted root, native tools and free space without changing partitions. The earlier installer/disk identification material remains historical; no further erase or installation is pending. Do not paste serial numbers, SIM identities or passwords into support. The tool contains no partition, format, installer, SSH-enablement, firewall, password or device-control commands.

Omarchy's normal disk encryption and unattended reboot are separate decisions: a boot passphrase prevents unattended power-return recovery until a supported, qualified unlock method is arranged. Do not silently disable encryption to obtain autostart. Service and browser startup after login do not prove recovery from complete power loss. The BIOS's actual AC-power-return setting, encrypted boot, login/session startup, screen power return and network recovery must all be observed on this SER.

## Install, configuration and serial ownership

The installed layout is `/opt/tenkings-vault/releases/<id>` plus `current`; `/etc/tenkings-vault` for root-managed config; `/var/lib/tenkings-vault` for durable SQLite and backups; `/var/log/tenkings-vault` for structured logs. App/desktop accounts cannot edit executable releases or trust anchors. `machine.env.json` is root-owned **0600**; systemd `LoadCredential` copies it into the private service credential directory. `launch.py` parses JSON without shell evaluation, limits keys to `VAULT_*`, and supplies authoritative release/data/loopback paths itself. Never use `VITE_*` or a browser config for private credentials.

Create protected actual configuration from `templates/machine.env.example.json`. The template deliberately cannot enroll a real machine. Needed values are actual cloud machine enrollment/credential, signed-config public key and key ID, distinct random callback and maintenance tokens, and explicit adapter choices. Put public config key and non-secret board binding under `/etc/tenkings-vault` with root ownership and read permission for the service. A hardware path uses `MARSHALL` plus `WAVESHARE`; the current Marshall adapter remains unavailable until the official SDK/configuration is implemented. `MOCK` with a physical controller is rejected. Never relabel synthetic stock/profile geometry as received cabinet mapping.

```sh
python3 deploy/vault-linux/appliance.py install --release /path/to/signed-release --public-key /path/to/reviewed-release-public.pem
sudo python3 deploy/vault-linux/appliance.py install --release /path/to/signed-release --public-key /path/to/reviewed-release-public.pem --config /protected/machine.env.json --apply
```

The first command is a plan. The second registers the unit but leaves it disabled and stopped so unresolved SDK/config/serial/display facts cannot become a running machine. Record the planned first start in `SESSION_LOG.md`, validate configuration and the native probe, then explicitly `sudo systemctl enable --now tenkings-vault.service` during the supervised installation. Record the observed health/build identity and result. Existing state, an existing unit/current pointer, or foreign-owned bench evidence prevents first install.

Connect and identify the INNOMAKER and FTDI separately. Read-only `udevadm info --query=property --name /dev/serial/by-id/OBSERVED_DEVICE` identifies the selected device locally. `bind-serial --device /dev/serial/by-id/OBSERVED_DEVICE --role locks` prints a plan; adding `--apply` installs a create-only exact-vendor/product/unique-serial rule with `vault-serial` group and **0660** permissions. Reconnect only that adapter to apply permissions. A device without unique serial needs a reviewed `/dev/serial/by-path` binding; the current generator fails rather than guessing. No `chmod 666`, broad `dialout` access, VID/PID-only match or guessed `ttyUSB0` assignment.

The generated aliases `/dev/vault-locks` and `/dev/vault-nayax` help identify roles; **the actual Waveshare config retains its observed `/dev/serial/by-id/...` path** because the real transport validates stable by-id paths. Confirm the aliases resolve to different physical adapters. Never use RS232 for the lock board or RS485 for Marshall.

The existing controller/bench global guard is `/var/lib/ten-kings-vault-bench`, private **0700**, owned by `vault`. The service and supervised bench commands must run as the **same vault user** to share its lock and immutable one-shot evidence. Use `sudo -u vault /usr/bin/python3 .../waveshare_bench.py ...` only for a separately reviewed hardware step. Never copy, clear, recreate or change ownership of existing bench records to bypass a consumed/unknown attempt. The installer rejects an existing foreign-owned bench directory. The systemd unit provisions the directory only for the dedicated account.

## Portrait, touch and startup

Current official Omarchy uses `~/.config/hypr/monitors.lua` and `autostart.lua`; prior versions use `.conf`. Inspect the installed version/files first. The [official monitor guidance](https://omarchy.org/manual/monitors/) recommends 1× scaling for a 1080p screen; the [current shipped monitor template](https://raw.githubusercontent.com/omacom/omarchy/master/config/hypr/monitors.lua) demonstrates `hl.monitor` with transform 1 for 90° or 3 for 270°.

Read `hyprctl -j monitors all` and `hyprctl -j devices` locally, then run `display-plan.py --output OBSERVED_OUTPUT --touch OBSERVED_TOUCH_NAME --transform 1` (or 3 for the physical mounting). It rejects missing/ambiguous identities and prints the monitor/autostart fragment without modifying the desktop. Bind that touch device explicitly to the same output and transform using the installed version's per-device input config. Hyprland's [touchdevice contract](https://wiki.hypr.land/configuring/core/config-options/) separates output assignment and touch transform from video rotation. Validate all four corners, center, horizontal product swipe and exact-door tapping; a rotated picture alone is not touch acceptance.

Merge only the one Vault launch entry into the existing autostart file. Chromium runs with its sandbox, native Wayland, the accepted `?experience=portrait` route and a persistent local profile. The machine account has serial/config access; the desktop account must not join `vault` or `vault-serial`. Omarchy developer hotkeys, terminal access and administrator privileges are not a finished unattended kiosk lockdown. Qualify a restricted display session before public operation; keep keyboard/admin recovery during the supervised bench.

Use installed Omarchy controls to turn off idle locking/screensaver and sleep during kiosk service, then verify persistence after reboot. Do not blindly toggle: inspect the current state first. The [current idle manual](https://omarchy.org/manual/toggles-idle-screensaver/) documents `omarchy toggle idle status` and distinguishes idle locking from system sleep. Changing UI defaults must not disable operating-system security updates. Perform Omarchy rolling updates inside the same service maintenance window and repeat native/device/display probes afterward; the pinned app runtime is separate from system packages.

## Planned restart/update and recovery

Use `appliance.py restart` or `update --release /path/to/signed-release` to inspect a plan; actual action adds `--apply` and runs as root. A retained host-wide deployment lock excludes concurrent install/restart/update/binding operations. The tool reads the dedicated-token internal endpoint over loopback with Origin and contract headers. Missing/unsupported responses, unknown controller output, unpaid/unfinished sales, unresolved settlement/reconciliation, uncertain command, active cart/restock/certification or failed integrity block the operation. Health green alone is not permission to restart.

The machine first freezes new mutations, drains already-running HTTP/runtime work, rechecks durable authority and observed controller OFF, persists `service_locked=1`, and ends staff sessions. An unsafe preflight does not freeze the operating service; a race discovered while draining resumes normal request/runtime admission. The barrier remains active until restart. A restart retains the durable service lock and requires the existing authenticated staff safe-exit/closed-door confirmation before sales reopen.

The updater stages and probes all signed replacement bytes **before** entering maintenance. Same local schema version is required; schema changes and downgrades have no automatic path. After clean stop, SQLite's backup API creates integrity-checked mode-0600 snapshots of the main DB, mock-provider DB when present, and physical-controller journal when present. It includes committed WAL content. It never overwrites current data or restores an older journal, and never retries a door/payment as a side effect. These are local private snapshots; off-machine backup requires approved encrypted transfer/storage. Disk encryption must be actually established before calling storage encrypted.

If stage/probe fails, the current pointer/service remains unchanged. If stop or backup fails, no new pointer is selected. If a new release fails to start, preserve the new pointer, previous release, state and backup for review; do not automatically downgrade or restore financial/controller history. Any repair must retain all events and physically uncertain outcomes. A forced host loss is handled by startup recovery and durable adapter intent, not the planned-maintenance path; actual host-loss/relay-OFF behavior still needs bench qualification.

`appliance.py diagnostics` returns safe aggregate metadata and exact app/source identity when the loopback service is reachable. It deliberately omits raw journals, DB files, enrollment/config values, cookies and serial/SIM/provider identity. It is not physical-opening evidence. Review actual service health and build identity after any start/update before staff safe exit.

## Minimal connection progression

Use the Installation Studio's same electrical revision and one connection at a time. Keep the lock inaccessible to accidental power until its reviewed test step.

1. Match screen/SER power, HDMI and separate USB touch; establish OS, portrait/touch and the local UI. The Mac preview loopback URL does not address the SER.
2. With supplies unplugged, follow the existing connection table for the INNOMAKER bus, one Waveshare board power input, and separate positive/return WAGO nodes. Board power does not power a lock through an unwired dry contact.
3. Confirm actual 12 V polarity, appropriate external wiring protection and lock-coil suppression. Reuse owned parts; no extra kit or fuse count is assumed. The supplied multimeter is useful for DC/continuity but cannot establish a 100 ms waveform or transient suppression.
4. Use the imported controller tool for separately authorized read-only identity/all-OFF checks, then its single consumed unloaded pulse, then its separately gated single accessible-lock continuation. No all-relays-on, persistent ON, guessed mapping or repeat after unknown outcome.
5. Keep Nayax's approved supply and Marshall COM2/USB-RS232 harness separate. Obtain actual SDK/Linux runtime, harness identity, terminal test configuration and definitive vend/settlement policy before a payment-authorized physical demonstration. Included cards or a terminal reset are not no-charge/refund authority.

The visible 4×17 arrangement has 68 faces; it is not a qualified software/controller map. One observed unlock would establish the bounded bench milestone only, not all-cabinet power, every-door mapping or unattended certification.

## Validation record

September 16 local source checks: **20 Python appliance behavior tests pass**, including signature/foreign-key rejection, tampering/extra files/symlinks/traversal, strict maintenance gates, schema refusal, failed-native-probe pointer preservation, backup-failure behavior, committed-WAL/controller-journal backup, unique serial rules, diagnostics redaction and concurrent-deployment exclusion. **6 maintenance tests pass**, including durable lock/session invalidation, unresolved sale no-op, race/resume, physical OFF requirement, completed-presentation settlement/reconciliation blocking, and a real HTTP partial-body race that drains the existing mutation, blocks new writes, detects the resulting cart and resumes safely. Machine TypeScript build and `git diff --check` pass.

Independent controller-lane review found and corrected the pnpm transitive-dependency packaging gap, mutable-source copy race, referenced configuration trust gap and FIFO-open blocking gap. Dependencies are now recursively resolved from the exact installed locked tree into regular nested directories; no registry re-resolution occurs. A relocated real native SQLite dependency test under **Mac Node 20** created/read value42 with integrity `ok`: 1,207 regular files, zero links. This is module-closure evidence, not Linux ABI acceptance. Staging reads through no-follow directory/file descriptors with nonblocking leaf opens, hashes before writing and keeps failed stages private0700; signatures validate the exact byte snapshot subsequently parsed. Referenced config keys/mappings require protected root-owned file ancestors at install and every launch. First install refuses unrelated state/log contents.

The read-only doctor correctly reports this development machine as Darwin/arm64 with no systemd, Hyprland, tty devices or installed Vault service. The lead's disposable Linux Docker attempt failed before container execution because of image extraction I/O errors and disk pressure; no Linux/native/systemd pass is claimed. Linux-specific installer/unit/native/desktop checks remain open. No Linux success is inferred from these cross-platform unit tests. Independent shared runtime/HTTP review found no remaining actionable admission race within the reviewed scope; actual hardware qualification remains separate.
