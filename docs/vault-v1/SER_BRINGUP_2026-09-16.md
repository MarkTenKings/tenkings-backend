# SER5 native bring-up — September 16, 2026

**Current native startup — September 17:** Mark authorized startup after transfer. An isolated working copy at `/home/tkvault/vault-native-r3-20260917.mVRi5N` passed 363 native tests, the SQLite durability probe, source integrity recheck, mock purchase smoke and two clean stop/start checks. Portrait B is running at `http://127.0.0.1:55497/?experience=portrait` on the SER and its Chromium window is open. This is a disposable mock preview, without real doors/payments or boot autostart. The original transfer remains unchanged. See [native acceptance and restart instructions](SER_NATIVE_ACCEPTANCE_2026-09-17.md). Earlier access/transfer-only/native-pending descriptions below are historical.


Current ownership is the imported `df09` checkout, branch `codex/vault-integration-20260917-9ddb13`, based on `c4f04006d9302445e2a68b01dcc316def3b4eb73`. The September 17 lead and its three new workers own continuation; preserved `59f4` and earlier sources remain frozen. See [the current handoff](FRESH_ASTRA_LEAD_HANDOFF_2026-09-17.md) and [the native command plan and independent integrity receipt](APPLIANCE_REVIEW_2026-09-17.md).

Mark completed the authorized Omarchy installation on the photographed `/dev/nvme0n1 (447.1G) - CT480E100SSD8` internal SSD. Wired keyboard, mouse, video and network have been observed; the graphical app is installed with Codex selected. Account `tkvault` and last observed address `192.168.2.36/24` are established by owner/photo evidence. On September 16, SSH reached the SER but rejected the Mac key. The September 17 lead's attempt to that last address timed out before authentication; Mac `en0` remains `192.168.2.21`. Current SER address/reachability and public-key authorization still need local confirmation. No authenticated remote command, source transfer or native acceptance has succeeded. The lead owns access and all remote mutations. Installation and erase choices are settled; the Windows/media instructions below are historical recovery reference only.

Scope remains Vault software and its Codex work. Repeated encrypted boot/unlock, installed root-disk mapping, USB touch and installed service acceptance remain unverified. Same-account app sign-in does not transfer Mac-local tasks or uncommitted files.

Preserve the working matched power supplies, HDMI video, keyboard and network. The screen's separate USB touch-data path still needs verification. Keep lock-board and Nayax power separate; software simulation needs neither terminal credentials nor connected relays. The Mac's localhost preview address is not the SER's address.

## Read-only discovery on the actual SER

On the installed SER Linux system, run locally (or through the lead's authenticated session):

```sh
cat /etc/os-release
uname -m
lsblk -o NAME,PATH,MODEL,TRAN,RM,SIZE,TYPE,FSTYPE,MOUNTPOINTS,RO
findmnt -no SOURCE,FSTYPE,OPTIONS /
df -h / "$HOME"
ip -brief address
ip route show default
command -v python3 openssl git make gcc node npm pnpm hyprctl chromium
```

After transferring the candidate, `python3 deploy/vault-linux/appliance.py doctor` adds read-only service/tool/device-count discovery. It does not open serial ports. Review USB identities locally only when assigning a specific adapter; do not paste serial numbers, credentials, SIM details or recovery keys into logs. Network inventory does not enable SSH, change a firewall, or establish external reachability.

### Historical Windows and installation reference

The following material records the earlier pre-installation workflow. It is not the current next step and does not request another installation or erase. These PowerShell queries identified Windows and its disks without changing them:

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture
Get-Disk | Select-Object Number,FriendlyName,BusType,Size,PartitionStyle,OperationalStatus,IsBoot,IsSystem
Get-Partition | Select-Object DiskNumber,PartitionNumber,DriveLetter,Type,Size
Get-Volume | Select-Object DriveLetter,FileSystemLabel,FileSystem,Size,SizeRemaining
Get-NetConnectionProfile | Select-Object InterfaceAlias,IPv4Connectivity,IPv6Connectivity
```

The storage queries are read-only: [Get-Disk](https://learn.microsoft.com/en-us/powershell/module/storage/get-disk), [Get-Partition](https://learn.microsoft.com/en-us/powershell/module/storage/get-partition), and [Get-Volume](https://learn.microsoft.com/en-us/powershell/module/storage/get-volume). Identify the installer stick in three short steps:

1. Run the disk inventory without the SanDisk, then insert only that stick and run it again. If already connected, close its files and safely eject it before removing it. Observe which disk disappears and returns.
2. Match that disk's model/name, USB bus and actual byte capacity. Use its partition drive letters and volume labels to review the stick's contents locally. Review the internal disk's partitions and any data to preserve separately.
3. Match the observed device to Etcher's selected target before confirming the whole-USB erase. At the Omarchy installer, identify the internal disk again before confirming its whole-disk erase, including Windows and its recovery partitions. Disk numbers, drive letters and Linux device names can change; if matching remains ambiguous, inspect unique identifiers locally and resolve it before writing.

If encryption status is needed and the command is available, inspect only `Get-BitLockerVolume | Select-Object MountPoint,VolumeStatus,ProtectionStatus,EncryptionPercentage`. Keep recovery material locally with the owner. Do not decrypt, shrink, format or repurpose any disk as part of discovery.

| Observed starting point | Next pathway |
| --- | --- |
| Existing Omarchy/Arch x86_64 | Preserve the installation. Check free space and prerequisite tools, then use the source-native workflow below. Confirm the installed Hyprland config version before portrait/autostart changes. |
| Another Linux distribution on x86_64 | Native source tests can run after its prerequisites are verified. The appliance installer intentionally requires Arch. Omarchy remains the selected destination; identify and confirm the exact erase target before replacement. |
| Existing Windows | Mark has chosen to replace it with Omarchy. Inspect the exact disk/partition/encryption inventory and any data to preserve, then obtain concrete target/erase confirmation. Do not reopen the general OS preference. Windows or WSL results do not qualify the actual Omarchy service, serial driver or touchscreen. |
| No usable OS | Identify the exact disk and any contents before preparing installation media. Select the actual destination disk and USB with owner approval before any destructive write. |

Use the [official Omarchy installation guide](https://omarchy.org/manual/getting-started/) for the selected installer. Its [dual-boot guide](https://omarchy.org/manual/dual-boot-install/) describes a possible alternative, but Mark has already chosen replacement; it is not the current plan. Prefer downloading the verified installer on the SER once it is online. The Mac previously fell to 152 MiB free during a failed Docker pull; a later read-only check showed 7.1 GiB available. Both are historical observations: recheck before any large Mac download, and do not delete unrelated user files. Default encrypted boot needs an explicit, tested unlock arrangement before unattended power-return operation can be claimed.

## Exact source transfer and provenance

`deploy/vault-linux/candidate-bundle.py` exports a **new directory outside the checkout**. It includes only the root package/lock/workspace/TypeScript configuration, three simulator/test scripts, the contracts/machine/kiosk/Linux-deploy source trees, existing kiosk artwork and four bring-up/bench documents. It excludes `.git`, dependencies, build output, databases, private keys, environment files and unapproved JSON configuration. A candidate source tree must contain no secrets in its actual source files; this allowlist is not a content-level secret scanner.

The included manifest is `candidate-source.json`, with schema:

```json
{"schemaVersion":1,"sourceState":"UNCOMMITTED_CANDIDATE","baseCommit":"ACTUAL_40_CHARACTER_BASE_HEAD","files":[{"path":"package.json","size":123,"sha256":"EXACT_64_CHARACTER_FILE_HASH"}]}
```

The real manifest lists every transferred source file. Its SHA-256 binds the exact JSON bytes; each entry binds relative path, size and content. The source is rechecked after export so a concurrent edit fails. The exporter rejects source symlinks and special files, caps total source at 40 MiB and leaves failed partial output private. It never invents a commit, initializes Git on the real candidate, or describes dirty code as the base commit. The manifest provides **integrity only, not a signature or release authorization**. Compare the expected manifest hash from the trusted source handoff before running transferred code; replacing the verifier and manifest together cannot establish authenticity.

From the current source checkout, the lead can export directly to a new folder on an existing transfer destination:

```sh
python3 deploy/vault-linux/candidate-bundle.py export --source /absolute/current-checkout --output /absolute/existing-transfer-location/new-vault-candidate
python3 deploy/vault-linux/candidate-bundle.py verify --bundle /absolute/existing-transfer-location/new-vault-candidate
```

At this preparation point the measured source was approximately **35 MB**: 33.27 MB of existing approved art plus about 1.7 MB of code/config/tests. Added small scripts/docs change the exact count; the exporter reports authoritative file and byte counts. Do not duplicate dependencies or compress/regenerate approved images. No archive is needed until the transfer method is selected. An existing USB filesystem can carry the directory without formatting; an already authorized transfer channel can carry the same files. This work does not enable remote access.

On the SER, transfer into a new user-owned build folder. Before running copied code, authenticate both the manifest and the verifier: use the independent bootstrap in [the current command plan](APPLIANCE_REVIEW_2026-09-17.md#2-authenticate-the-transferred-source-before-executing-it). Checking only the manifest and then executing an unverified verifier is insufficient. The current trusted r2 manifest is `1313aeed7b8232b990236d572dbd2b905570dfa7e9864f4108d8336114fcc05e`. After that bootstrap succeeds, the normal verifier command is:

```sh
cd /absolute/local/new-vault-candidate
python3 deploy/vault-linux/candidate-bundle.py verify --bundle .
```

Use the candidate manifest in the simulator. Its reported build identity is `CANDIDATE_SHA256:<manifest-hash>`, deliberately distinct from a 40-character Git SHA and ineligible for physical hardware certification. Native `dist` output is tested locally but is not covered by the source manifest. The signed release builder still requires a reviewed, clean committed checkout; candidate export does not bypass that gate.

## Native build and tests, without Nayax access

Prerequisites on the target are Linux **x86_64**, Python 3, a C/C++ compiler and make, OpenSSL, HTTPS access to the Node/npm registry, sufficient free disk space for dependencies/builds, exact **Node 22.23.2** and **pnpm 9.12.0**. Existing Arch package availability/versions must be inspected before installing missing packages from its official repositories. No OS package command was executed here. The frontend uses the existing Omarchy Chromium/Hyprland for manual visual acceptance; Playwright browser suites need their declared browser runtime separately.

Download `node-v22.23.2-linux-x64.tar.xz` from the [official release directory](https://nodejs.org/download/release/v22.23.2/) into a new local build-tools folder. Before extraction, verify SHA-256 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`, matching the [official checksums](https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt). Extract the verified archive into that folder and put its `bin` first in this shell's PATH. Do not replace the OS Node installation. If pinned pnpm is absent, that verified Node's npm can install `pnpm@9.12.0` into a new user-owned tools prefix; add its `node_modules/.bin` to this shell's PATH. Recheck both executable versions before continuing.

From the candidate root under that pinned runtime:

```sh
node --version
pnpm --version
python3 deploy/vault-linux/appliance.py doctor
npm_config_build_from_source=true pnpm --filter @tenkings/vault-machine... --filter @tenkings/vault-kiosk... install --frozen-lockfile
npm_config_build_from_source=true pnpm --filter @tenkings/vault-machine rebuild better-sqlite3
pnpm --filter @tenkings/vault-contracts build
pnpm --filter @tenkings/vault-machine build
pnpm --filter @tenkings/vault-kiosk build
pnpm --filter @tenkings/vault-contracts test
pnpm --filter @tenkings/vault-machine test
pnpm --filter @tenkings/vault-kiosk test
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/vault-linux/tests
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s packages/vault-machine/tests -p test_waveshare_bench.py
node deploy/vault-linux/probe.cjs .
python3 deploy/vault-linux/candidate-bundle.py verify --bundle . --allow-build-output
node scripts/run-vault-simulator.mjs --doors 72 --stocked --cinematic --smoke --source-manifest ./candidate-source.json
```

Stop if versions differ from the pins or any command fails. Native SQLite must compile/load under this same Linux Node executable; Mac/Windows `node_modules` are never transferable. `probe.cjs` exercises disposable SQLite WAL/FULL commit/rollback/reopen/integrity and reports the actual ABI. `--allow-build-output` rechecks source while explicitly ignoring declared generated directories, whose bytes it does not authenticate. Do not run root aggregate `vault:build`/`vault:test` on this sparse candidate: they include the separate cloud/database application.

For a bounded native stop/start check use the current receipt's [process restart sequence](APPLIANCE_REVIEW_2026-09-17.md#5-disposable-simulator-stopstart-and-portrait-b). The simulator deletes its temporary database on graceful exit; restarting it creates a new synthetic session. Durable reopen/recovery evidence comes from the native SQLite probe and existing machine tests, not this process restart.

To inspect the local UI after the smoke test:

```sh
node scripts/run-vault-simulator.mjs --doors 72 --stocked --cinematic --port 55497 --source-manifest ./candidate-source.json
```

Open the simulator's printed **SER loopback** URL in its Chromium, using `?experience=portrait` for accepted Portrait B. The 72-door fixture is explicitly synthetic, unrelated to a verified cabinet map. This uses a disposable local database, mock cloud/payment/controller, and no real terminal. It can validate startup, UI, workflow and native persistence without Nayax's SDK. Physical controller/power work uses the included `BENCH_PROGRESS_2026-09-16.md`, `WAVESHARE_INTEGRATION_2026-09-16.md` and existing `waveshare_bench.py` only after actual wiring/identity checks and the separately scoped supervised step. No software smoke test proves an energized relay or lock opened safely.

## Evidence and remaining target gates

The source-only workspace shape was tested locally with a tiny temporary copy of the root plus three workspace manifests and complete lockfile: `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` passed and left the lockfile SHA unchanged. This involved no dependency download or install scripts. Eight small candidate-bundle tests pass for dirty-source provenance, Git-free verification, exclusions, create-only output, altered/missing/extra files, traversal/duplicate manifest paths, symlink/FIFO refusal and concurrent-source mutation. The broader appliance lane previously passed 20 Python behavior tests. These are Mac source checks, not Linux/systemd acceptance.

The earlier relocated native dependency probe proved module closure on **Mac Node 20** only. Docker never reached a running Linux container due to extraction/I/O and disk pressure. Native Node 22/SQLite, exact Omarchy version, systemd credentials/permissions, serial naming, portrait/touch, sleep/power return and the real screen remain pending the actual SER. Native software tests and simulator acceptance can proceed immediately once that target is ready. Protected cloud enrollment, real signed hardware configuration, reviewed clean release identity, and the official Nayax SDK remain separate gates for installed physical commerce.
