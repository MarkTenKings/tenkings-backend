# Disposable Arch installed-service rehearsal

This exercises the signed appliance's real systemd unit and packaged Node on a **fresh disposable Arch Linux x86_64 VM**. It uses generated synthetic credentials, MOCK payment, SIMULATOR controller and an unreachable loopback cloud URL. It does not qualify a physical cabinet, display, serial adapter, production cloud or Nayax terminal. It never automatically reboots or replaces installed state with restored state.

**Current evidence:** the October 8, 2026 attempt could not start systemd262 as PID1 in the available ARM64 Colima / QEMU user-mode environment. It exited255 before any Vault installation. The retained full syscall trace reaches systemd-executor and unsupported x86 syscall439 (`faccessat2`) before teardown; this establishes an environment blocker, not a Vault failure or acceptance pass. No full-system x86 emulator was available, and free disk was1.2GiB. The task VM was removed; the Docker context remains `desktop-linux`. Logs and image provenance are in the release checkout's `outputs/vault-service-lifecycle-rehearsal/`. The runner below has unit validation; its installed lifecycle and reboot phases remain **unexecuted** until a suitable VM is available.

## Inputs and host

Use a newly created VM with real systemd as PID1, at least2GiB free, and Arch's `python`, `openssl`, `systemd`, `util-linux`, `shadow` and `glibc` prerequisites. Keep it isolated from real machine/provider networks. No preexisting Vault installation, account, state, logs, unit or unit drop-in is permitted. The unchanged appliance host guards still enforce Linux/x86_64/Arch and required tools. Containers, a physical cabinet and substituting distribution/architecture labels are refused.

Copy reviewed `deploy/vault-linux/` tooling, the actual signed release directory, the independently trusted release public key, and separately signed update metadata into `/opt/vault-rehearsal-input/`. Use protected root-owned files/directories without symlinks or group/world write access; keep the tooling separate from the signed release. Do not copy any release signing private key, real configuration or existing database. Preserve each payload member's signed mode; do not recursively chmod the release. Verify the public key's fingerprint through the release handoff before starting.

The second `release.json`/`release.sig` must come from the ordinary offline release signer. For this rehearsal, the only manifest difference is a new release ID; source, files, runtime and schema must be identical. This tests a real signed pointer transition without inventing a new application build. The retained metadata uses `ten-kings-vault-20261007-faedb613-rehearsal`, manifest SHA256 `fa964e359ef68c0ccf81e4693f3517c638fce115fb364a098b6fff648467333e`, under `outputs/vault-spark-release-validation/lifecycle-update-metadata/`. The original faedb613 artifact is unchanged.

## Before reboot

Inspect this VM's `/etc/machine-id`, then supply that exact value explicitly. Do not substitute the cabinet's identity. Assuming staged inputs use the names below:

```sh
sudo python3 -B /opt/vault-rehearsal-input/tooling/tests/installed-service-rehearsal.py prepare \
  --acknowledge SYNTHETIC_ONLY_DISPOSABLE_VM \
  --disposable-machine-id REVIEWED_DISPOSABLE_VM_MACHINE_ID \
  --release /opt/vault-rehearsal-input/ten-kings-vault-20261007-faedb613 \
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
