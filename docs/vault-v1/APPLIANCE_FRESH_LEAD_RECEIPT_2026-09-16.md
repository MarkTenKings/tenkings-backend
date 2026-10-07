# Appliance receipt for the fresh integration lead — September 16, 2026

This receipt supersedes earlier appliance-document statements that the SER is still disconnected. It records the appliance worker's completed work and current owner observations; it does not establish an installed or qualified machine. The worker read the mandatory context/runbooks and the **entire canonical V2 blueprint** before implementation. The incoming lead must complete its own required reading. V2 card-platform authority was not changed.

## Current owner state and immediate next step

Mark explicitly selected **Omarchy** and asked to replace the SER's existing OS. He powered the SER and Acer, saw initial language/Wi-Fi setup, then reported setup complete and believes it is Windows. Video and the USB-receiver mouse worked; touch did not. Exact Windows edition, monitor model/ports, touch-data connection, disk identity/contents and SER internet remain unverified. Hardware is owner-reported received; do not ask arrival questions again. SER specification is Ryzen 5 5500U, 16 GB, owner-reported **480 GB**, not an inferred 500 GB.

**Mark now has the wired keyboard.** Its actual input operation still needs confirmation. He also reports an owned **32 GB SanDisk USB stick**; contents and permission to erase that exact USB remain unverified. Do not repeat the keyboard purchase recommendation. The former Pebble Keys 2 K380s is Bluetooth/optional Logi Bolt; pairing it in Windows would not establish firmware/Linux/decryption input.

Next: have him plug the wired keyboard directly into the SER and confirm typing, confirm internet on the SER, then identify the actual USB and internal disk and what each contains. Use the read-only PowerShell inventory in `SER_BRINGUP_2026-09-16.md`. Preparing a complete replacement is authorized; naming and confirming the exact erase targets remains necessary before destructive writes. Do not clear TPM, reset firmware defaults, flash BIOS, or enable remote access as a shortcut.

## Implemented appliance candidate

All appliance files live in `deploy/vault-linux/`. Details and command templates are in `LINUX_APPLIANCE_2026-09-16.md`; sparse native build commands are in `SER_BRINGUP_2026-09-16.md`.

- **Runtime/build:** exact Linux x86_64 Node **22.23.2**, pnpm **9.12.0**, better-sqlite3 **11.10.0**. Node archive SHA-256 is `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`. Build uses the frozen lockfile and native SQLite rebuild. `probe.cjs` checks platform/version/ABI and disposable SQLite WAL/FULL commit, rollback, reopen and integrity. `runtime-dependencies.py` recursively materializes the actual installed pnpm runtime graph, including transitive sibling dependencies. No Mac/Windows native modules may ship to Linux.
- **Release/install:** `build-release.py` retains its clean, reviewed committed-source requirement. `appliance.py` verifies Ed25519 signatures and exact membership/hash/size/mode; rejects traversal, links and altered files. Staging uses no-follow descriptors, nonblocking leaf opens and hashing before publication; failed staging remains private. Install is plan-first and leaves the registered service **disabled and stopped**. Existing foreign/populated state is refused. Applied host operations share a retained exclusive deployment lock.
- **Accounts/config:** dedicated non-login `vault` service, protected release directories, root-owned 0600 JSON via systemd `LoadCredential`, loopback service and restricted write paths. Referenced public trust key/controller config must also have protected root-owned ancestors at install and launch. Explicit adapter choices are required; `MOCK` payment plus a physical controller is rejected. Marshall remains unavailable pending official SDK integration.
- **Serial/bench:** exact observed unique serial produces a role-specific udev 0660 rule for `vault-serial`. Waveshare configuration uses its actual `/dev/serial/by-id/...`, not guessed tty numbering. Service and supervised bench share `/var/lib/ten-kings-vault-bench`, mode0700, same `vault` owner. Never reset/recreate evidence or change its owner to bypass a consumed/uncertain attempt.
- **Maintenance/update:** worker supplied `packages/vault-machine/src/maintenance.ts`; root integrated HTTP admission, runtime pause/resume and lifecycle cleanup. `POST /api/v1/internal/maintenance` takes `{action:"status"|"enter"}` and returns the existing `{data: status}` envelope. It uses Origin/contract checks and the distinct protected maintenance token. Unsafe preflight is a no-op; safe entry freezes mutations, drains in-flight work, rechecks DB/controller, persists service lock and ends staff sessions. Unsafe post-drain races resume admission. Physical status requires `OFF_VERIFIED`, which is board-reported state, not measured contacts. Unresolved payments, including settlement/reconciliation, block restart.
- **State preservation:** update stages/probes before maintenance, permits same schema only, stops cleanly and integrity-checks SQLite backups of `vault.sqlite`, its `.mock-provider.sqlite` and `.controller.sqlite` sidecars including committed WAL. Never independently rewind the controller journal, auto-restore DB or auto-downgrade after a failed start.
- **Desktop/diagnostics:** preserve Omarchy/Hyprland; no LightDM/Openbox replacement. Display planner observes exact monitor/touch identities; Chromium retains its sandbox and uses accepted Portrait B. Protected machine and ordinary display accounts stay separate. Diagnostics expose allowlisted status without secrets/raw logs. Public kiosk restriction and actual power-return behavior remain unfinished acceptance work.

## Completed validation, with exact scope

Existing records were read for this receipt; tests were not rerun.

| Recorded check | Result and limit |
| --- | --- |
| Appliance behavior tests | **20 passed**, including signing/tampering, maintenance/schema gates, backups, dependency closure, staging symlink race, referenced config trust, FIFO refusal and concurrent deployment. |
| Maintenance tests | **6 passed**, included in the root's 170 machine tests. Includes a real partial-body HTTP race: drain admitted mutation, reject new mutation, detect resulting cart and resume. |
| Candidate export tests | **8 passed**; dirty provenance, Git-free verify, exclusions, mutation/membership/path/link/FIFO refusal and concurrent edits. Log: `outputs/vault-integration-2026-09-16/candidate-bundle-tests.log`. |
| Shared root baseline | Contracts11/11, machine170/170, kiosk106/106; TypeScript/Vite builds; controller Python36/36; isolation1,862 paths. Root later added3 passing source-identity tests. Treat totals as recorded checkpoints, not a fresh aggregate run. |
| Relocated native dependency closure | Mac Node20 only: **1,207 regular files, zero links**, SQLite value42/integrity `ok`. This proves runtime dependency closure, not Linux ABI. |
| Sparse frozen workspace | Tiny manifest-only `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` passed with unchanged lockfile hash; no dependencies/network/native install. |
| Git-free candidate smoke | Root ran absolute Mac Node20 with `PATH=/nonexistent`: passed exact72-door simulated flow, initial1/retry1, maximum1 concurrent command,453 events. Log: `outputs/vault-integration-2026-09-16/git-free-candidate-smoke.log`. |

**No Linux container ever executed.** Docker image extraction failed with I/O errors; another public pull failed with token-service EOF. Linux native/Node22, installed systemd credentials/permissions, Omarchy desktop, touchscreen, serial I/O and physical effects remain untested. No appliance service was installed/restarted, lock actuated, payment made, production changed or source committed by this lane. Root's later session log reports Mac free space recovered to7.1GiB; the earlier152MiB value is historical. Continue downloading the6.19GB OS image on the SER, not the Mac, and recheck actual space before large work.

## Preserved source-only export

Existing create-only export, verified using its copied verifier:

```text
/Users/markthomas/tenkings/vault-handoffs/2026-09-16-ser-candidate-r1
185 source files; 35,014,959 source bytes
baseCommit: c4f04006d9302445e2a68b01dcc316def3b4eb73
candidate-source.json SHA-256:
16501f644168fea4a73f6269517e9473f71da2553bf02f0285ebbcfc6863f6c7
sourceState: UNCOMMITTED_CANDIDATE
sourceCommit: CANDIDATE_SHA256:16501f644168fea4a73f6269517e9473f71da2553bf02f0285ebbcfc6863f6c7
```

It contains only allowlisted source/configuration templates/tests and existing artwork, no dependencies, `.git`, built output or private configuration. The manifest proves consistency, **not a signed release or clean Git identity**. The simulator uses `--source-manifest`; its non-40-character identity cannot qualify physical certification. The real release builder remains unchanged. Preserve r1 rather than overwrite it. This new receipt and later handoff edits are not part of r1. Compare source hashes before using r1 as the representation of any subsequently edited checkout; create a new revision if code changes.

After actual Linux setup, follow the sparse three-workspace install/build/test/probe sequence in `SER_BRINGUP_2026-09-16.md`. Avoid root aggregate `vault:build`/`vault:test`, which pull in the separate cloud/database application. Native software and disposable simulator acceptance need no Nayax credentials. Preserve an external source copy while replacing Windows; do not erase the sole transferred copy with the installation disk.

## Verified installation facts and bounded physical progression

The [official Omarchy4.0.4 release](https://github.com/omacom/omarchy/releases/tag/v4.0.4) supplies [ISO](https://iso.omarchy.org/omarchy-4.0.4.iso), [checksum](https://iso.omarchy.org/omarchy-4.0.4.iso.sha256) and [signature](https://iso.omarchy.org/omarchy-4.0.4.iso.sig). Earlier HEAD-only observation: **6,185,304,064 bytes**; no ISO downloaded. Published SHA-256: `ddeded2758c48318d201dfdac905ecb28f570441883f0c052ea3cd5d05acf92d`. [Signing-key fingerprint](https://omarchy.org/manual/security/#signing-keys): `40DFB630FF42BCFFB047046CF0134EE680CAC571`. Recheck the selected version if the handoff is resumed later.

Official Windows route: download on the SER, verify hash, then [balenaEtcher](https://etcher.balena.io/) → ISO → exact approved USB → flash and validation. USB flashing erases the selected stick. The [Omarchy guide](https://omarchy.org/manual/getting-started/) requires wired/2.4GHz input for encrypted startup. Default disk encryption means unattended power-return is not solved merely by service autostart. Its broad Secure Boot/TPM wording is not an instruction to clear TPM or reset firmware; inspect the actual boot blocker and setting.

Beelink staff confirms repeated **Delete** at startup/restart for [SER5 5500U BIOS entry](https://bbs.bee-link.com/d/8464-ser5-5500u-issues). **F7 remains unverified for this exact revision**; do not upgrade other SER models' evidence. Identify the boot menu from the actual label/screen. Before final installation confirmation, match the internal SSD's actual identity/size and review its contents and erase scope with Mark.

For touch, exact Acer model remains unverified. If it is PM161QT, HDMI plus wall power lacks a host USB data path. Its [official manual](https://global-download.acer.com/GDFiles/Document/User%20Manual/User%20Manual_Acer_1.0_A_A.pdf?BC=ACER&LC=en&OS=ALL&SC=PA_6&Step3=PM161QT&acerid=638802941973198702) distinguishes host USB-C input from right-side OTG for downstream peripherals. Confirm the port labels/cables; keep matched power and working video. Do not claim Windows setup or Linux touch support from that failed first touch alone.

After OS/native/UI verification, continue `BENCH_PROGRESS_2026-09-16.md` with one unloaded board: observed hardware/power/terminal identities, exact stable adapter, evidenced address/firmware, read-only all-OFF inspection, then the separately reviewed one-shot unloaded pulse and accessible-lock continuation. Reuse preserved September11 electrical revision and `waveshare_bench.py`; do not invent wiring or duplicate tools. A single32CH board and a visible68-door layout do not establish complete cabinet capacity/mapping. The official Nayax SDK/test setup, actual physical qualification and real selected-door payment/unlock are still open.

Appliance edits stop with this receipt. The root lead owns the main transfer package and `SESSION_LOG.md` update.
