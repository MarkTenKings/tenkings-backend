# Disposable Arch installed-service rehearsal

This exercises the signed appliance's real systemd unit and packaged Node on a **fresh disposable Arch Linux x86_64 VM**. It uses generated synthetic credentials, MOCK payment, SIMULATOR controller and an unreachable loopback cloud URL. It does not qualify a physical cabinet, display, serial adapter, production cloud or Nayax terminal. It never automatically reboots or replaces installed state with restored state.

**Current evidence:** [hosted run 37737557091](https://github.com/MarkTenKings/tenkings-backend/actions/runs/37737557091) passed the complete rehearsal against immutable signed source `5f75935590508cc0f7f3e75083dcb63847ccce04`. It passed all 34 packaged authority checks, disabled installation, non-root start, maintenance/restart, signed update, coordinated snapshots, immutable held-restore checks, a real reboot and automatic service recovery. Both database canaries, schema 7/integrity, prior signed release and event prefix survived. Before/after boot IDs differ; both container and guest cleanup are confirmed. The 27 safe JSON receipts are retained under `outputs/vault-service-lifecycle-rehearsal/github-5f-reboot-success/vault-installed-service-synthetic-37737557091-1/`; the public release qualification receipt records their hashes. This does not qualify the actual SER, display, cabinet or Nayax terminal.

Earlier real runs of faedb613 exposed a packaged recovery defect: held restore returned success while standalone restored main-database holds remained only in SQLite WAL. **Do not install the faedb613 candidate.** Its signed artifacts and failed qualification evidence remain preserved; the prerelease is labeled accordingly.

The source fix explicitly closes and checkpoints staged writers, converts only the derived main database to standalone DELETE journal mode, then verifies recovery holds with immutable reads before hashes/receipt. Provider journals remain byte-identical to their snapshot. Backup handles also close before immutable verification. The corrected source `5f759355` has passed all 484 Linux build checks and the native probe, and its new signed prerelease is published. The complete fresh qualification now passes as recorded above. All 91 local appliance/tooling tests pass, including a before/after WAL durability regression, actual busy-checkpoint failure and exact backup membership checks. Retained VM receipts are in `outputs/vault-service-lifecycle-rehearsal/github-{attempt2,frozen-retry}/`.

The first replacement run `37735462612` stopped before Arch boot because private host staging permissions prevented the capability-free authority container from reading public release inputs. Its owned container was removed. The external harness now explicitly sets extracted public directories to0755 and the two verified signature-envelope files to0644, preserving all signed payload modes and bytes. Regression tests pass. Retry `37736241161` passed all 34 packaged authority checks and actual Arch installation/start/maintenance/restart/signed update/coordinated backup/immutable held-restore verification. It reached the awaiting-reboot receipt, then an SSH timeout stopped the reboot handshake. No full-lifecycle or post-reboot acceptance is claimed yet. The host now requests an ordinary nonblocking reboot, records any ambiguous request timeout, and tolerates transient probe timeouts only within the absolute480-second deadline; a different boot ID and all resumed service assertions remain mandatory.

The earlier local ARM64 Colima/QEMU user-mode attempt could not start systemd262 and performed no installation. Its owned VM was removed, preserving the default Docker context and retained diagnostic evidence. This environment failure is separate from the subsequent real full-system VM results.

## Inputs and host

Use a newly created VM with real systemd as PID1, at least2GiB free, and Arch's `python`, `openssl`, `systemd`, `util-linux`, `shadow` and `glibc` prerequisites. Keep it isolated from real machine/provider networks. No preexisting Vault installation, account, state, logs, unit or unit drop-in is permitted. The unchanged appliance host guards still enforce Linux/x86_64/Arch and required tools. Containers, a physical cabinet and substituting distribution/architecture labels are refused.

Copy reviewed `deploy/vault-linux/` tooling, the actual signed release directory, the independently trusted release public key, and separately signed update metadata into `/opt/vault-rehearsal-input/`. Use protected root-owned files/directories without symlinks or group/world write access; keep the tooling separate from the signed release. Do not copy any release signing private key, real configuration or existing database. Preserve each payload member's signed mode; do not recursively chmod the release. Verify the public key's fingerprint through the release handoff before starting.

The second `release.json`/`release.sig` must come from the ordinary offline release signer. For this rehearsal, the only manifest difference is a new release ID; source, files, runtime and schema must be identical. This tests a real signed pointer transition without inventing a new application build. The retained metadata uses `ten-kings-vault-20261008-5f759355-rehearsal`, manifest SHA256 `254b01f365b8bc07aaf97466b176f32187a8356851eee4f1ca846f2e5cc72221`, under `outputs/vault-linux-signed-20261008/lifecycle-update-metadata/`. The new signed artifact remains unchanged throughout qualification.

## Before reboot

Inspect this VM's `/etc/machine-id`, then supply that exact value explicitly. Do not substitute the cabinet's identity. Assuming staged inputs use the names below:

```sh
sudo python3 -B /opt/vault-rehearsal-input/tooling/tests/installed-service-rehearsal.py prepare \
  --acknowledge SYNTHETIC_ONLY_DISPOSABLE_VM \
  --disposable-machine-id REVIEWED_DISPOSABLE_VM_MACHINE_ID \
  --release /opt/vault-rehearsal-input/ten-kings-vault-20261008-5f759355 \
  --public-key /opt/vault-rehearsal-input/release-public.pem \
  --update-metadata /opt/vault-rehearsal-input/lifecycle-update-metadata
```

The runner verifies both signatures and all payload members before installation. It checks that installation leaves the unit disabled/stopped, performs the real service-user reference preflight, enables/starts the signed unit, and verifies the actual non-root process and health/source/schema identity. It then enters the authenticated maintenance barrier, stops the writer and inserts one clearly named test-only canary table into each runtime-created main/mock-provider database. It inserts no financial or physical history. Guarded restart and signed update must each produce a valid coordinated snapshot preserving both canaries. A create-only held restore must retain the journals and set all technical recovery holds while leaving installed authority intact. The prior signed release must remain verifiable.

All receipts are create-only. A failure preserves the VM and state for inspection; do not rerun `prepare` over the partial installation. Inspect safe diagnostics and `journalctl -u tenkings-vault.service` inside this synthetic VM, correct the cause, then repeat on a **new** disposable VM. Never clear a recovery hold or weaken a guard to obtain a pass.

## After an explicit VM reboot

Once `evidence/awaiting-reboot.json` exists, reboot the disposable VM through its normal VM controls. The script contains no reboot command. Then run:

```sh
sudo python3 -B /opt/vault-rehearsal-input/tooling/tests/installed-service-rehearsal.py after-reboot \
  --acknowledge SYNTHETIC_ONLY_DISPOSABLE_VM \
  --disposable-machine-id REVIEWED_DISPOSABLE_VM_MACHINE_ID
```

The second phase refuses the same boot ID or a different host. It checks unchanged MOCK/SIMULATOR/loopback configuration, exact signed unit with no overrides, automatic service boot, both retained releases, running identity, SQLite integrity, both canaries and the immutable pre-reboot event prefix. Only `evidence/completed.json` records a full **SYNTHETIC_ONLY** lifecycle pass.

Export only `/var/lib/vault-lifecycle-rehearsal/evidence/` and reviewed diagnostic metadata. The parent directory also contains synthetic credentials, a payload copy and held state; do not publish it wholesale. Destroy the disposable VM after preserving evidence. Real SER boot/recovery, touchscreen/display, cabinet and terminal qualification remain separate required acceptance.

Unit validation, without a VM or host mutations:

```sh
python3 -B -m unittest discover -s deploy/vault-linux/tests -p 'test_installed_service_rehearsal.py' -v
```

## GitHub-hosted disposable VM

The separate `Vault disposable Arch installed-service rehearsal` workflow runs the same two phases in a real QEMU x86_64 guest on `ubuntu-24.04`. Its pull-request trigger is limited to this repository's `codex/vault-spark-release-20261007` branch and appliance/workflow paths. Once the workflow is registered on main, manual dispatch requires `SYNTHETIC_ONLY_DISPOSABLE_VM`. A workflow run is not acceptance until its receipts report success.

Before creating a VM, the host verifies the replacement archive SHA256 `54c150d31c49f6525a36ac2bcc75af8614edf4317daf05458eabdde4c404dc7e`, its signature, source `5f759355` and signed update metadata. It runs the unchanged 34-check production-authority factory test using the actual packaged Node in a fresh labeled container from the already pinned official Python image. The container has no network, dropped capabilities, no-new-privileges and exactly three read-only mounts: release, public key and test source. Synthetic trust exists only inside its disposable overlay; no host trust, installation or writable state is mounted. The host requires all 34 checks, exact source/manifest identity, zero provider/serial activity and confirmed synthetic cleanup, then removes only its ownership-labeled container. Timeout or cleanup uncertainty fails qualification before Arch boot.

The host driver pins official Arch cloud image `v20261001.604814` to SHA256 `360f0fa49db6813bdc8e35bed230a2dc2ae3567b7b5ab74719c0a706e4e34e87` (578,080,256 bytes), the already signed application archive, the public release key and the public-only signed update metadata archive. It checks hashes, signatures and safe archive membership before copying inputs into the guest. Generated SSH client and server keys provide strict host-key verification without importing real keys. The repository token is used only by the host release-download step.

QEMU uses two CPUs, 2 GiB RAM, an 8 GiB sparse overlay and KVM when accessible, otherwise full-system TCG. `restrict=on` blocks guest access to the host and external networks; only the explicit loopback SSH forwarding rule remains. No host directory or serial device is mounted. The official image's existing Python/systemd/tools must pass the unchanged appliance guards; the workflow performs no guest package installation or host-label substitution.

The official Arch image includes both BIOS/UEFI boot support and `cloud-guest-utils` for root-disk growth. Its time-sync wait normally blocks SSH/cloud-final until NTP succeeds. For this network-isolated fixture only, early cloud-init masks `systemd-time-wait-sync`; QEMU supplies host-backed UTC and the driver checks guest UTC against the hosted runner within 30 seconds. The receipt records this fixture setting. Appliance clock/authority checks remain unchanged, and this is not provider clock qualification.

After the first phase succeeds, the host explicitly reboots this disposable guest, observes a new boot ID and invokes the second phase. It exports only known synthetic receipt JSON files plus safe host/doctor metadata. The cleanup path stops the owned QEMU process and removes its generated keys, seed, overlay and temporary input copies. Raw console/cloud-init logs, credentials, databases and signing keys are excluded from the uploaded artifact. The job has a 45-minute bound and does not deploy a physical machine or activate production.
