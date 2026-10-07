# Vault continuation — fresh Astra Extra High lead, September 17

This is the current handoff. It supersedes earlier lead settings, hardware-starting-state instructions and ownership pointers in September 16 handoffs. Preserve their implementation/evidence details where still applicable. The owner requests a **fresh separate user-owned task**, model **gpt-6-astra**, reasoning **xhigh / Extra High**, with **three gpt-6-astra subagents**. Three workers fit the available four-agent capacity including the lead. This replacement must not run as a child of the old lead. Do not fork the old lengthy conversation.

## Objective, scope and conversation

Continue the existing Ten Kings Vault integration with Mark until the actual SER, Vault software, accepted touchscreen UI, controller/lock and Nayax test-payment path are working and qualified. **Only Vault software and its Codex work belong on the SER.** Do not synchronize all Mac chats, install unrelated applications or expand into ATLAS, Speedster or the V2 card platform. Mandatory product documents are agent context, not authorization to implement other systems.

Mark needs a few short, concrete steps at a time and dislikes repeated permission loops. Give him the next action, using photographs when physical observation is needed. Preserve the settled Omarchy choice and accepted Portrait B UI. Do not restart installation, rename his account, repeat keyboard shopping/pairing or ask him to call Nayax again. Treat a question/status update as steering ongoing work. Do not ask him to paste the previous conversation.

Old task: **VAULT SOFTWARE 3rd**, id `01a0ac33-e255-7020-a980-d94e749ef922`. It freezes after packaging. Its source checkout is `/Users/markthomas/.codex/worktrees/59f4/ten-kings-mystery-packs-clean`, branch `codex/vault-integration-20260916-8137f7`, actual base `c4f04006d9302445e2a68b01dcc316def3b4eb73`. No implementation commit, push, merge or production deployment was made by this lead. Its three old workers are frozen; create your own.

## Immediate stop point: SSH public-key authorization

Omarchy and the graphical desktop app are installed by owner/photo evidence. Codex view is selected. The app shows **No projects** and the local task **Install ChatGPT app on Arch**. Existing Mac-local Vault task/files have not synced or transferred.

Last observed network/account:

- SER Linux user `tkvault` (lowercase, directly observed with whoami).
- Hostname `tk-vault-01` (shown by Omarchy SSH setup; a remote hostname command has not succeeded).
- SER Wi-Fi interface `wlo1`, UP, `192.168.2.36/24`.
- Mac user `markthomas`, en0/default route at `192.168.2.21`; gateway `192.168.2.254`. Recheck addresses after this day change before assuming they remain current.
- Mac Remote Login/sshd was not observed running; no need to enable it for Mac-to-SER access. Existing user SSH config has only the unrelated external `tenkings` alias. No SER alias has been added.

Mark ran Omarchy **Windows/Super+Space > Setup > Security > SSHD** and selected his GitHub account **MarkTenKings**. IMG_0389 shows OpenSSH started, a rate-limited UFW port22 rule added, GitHub public key already authorized, and SSH password authentication disabled. Root then reached TCP/22 at 192.168.2.36 with banner **SSH-2.0-OpenSSH_10.5**. An explicit existing-Mac-key attempt failed **Permission denied (publickey)**. No remote shell command has succeeded.

The imported GitHub public key differs from the Mac's actual key. Mac file `/Users/markthomas/.ssh/id_ed25519.pub` and the loaded SSH agent both have this verified fingerprint:

```text
256 SHA256:PObuF9eh2j/jkC8hHkWwq1finAFgXlsbo8hamQQEvGQ mark@macbook (ED25519)
```

Do not copy/read out the private key or ask for passwords in chat. A first-use SSH host key for 192.168.2.36 was recorded in the Mac's known_hosts during that failed login. No other credentials were copied or changed.

The last two commands given to Mark, to run in a new SER terminal, were:

```sh
curl -f http://192.168.2.21:8765/mac.pub -o ~/vault-mac.pub
ssh-keygen -lf ~/vault-mac.pub
```

**Their completion and fingerprint output are unobserved.** We asked for a photo before authorizing the downloaded key. A temporary HTTP service previously served only the PUBLIC key, not any script/source/secret, from `/var/folders/kj/0fq4__ts66710yfj_m1x8r4c0000gn/T/vault-ssh-public-rkqy41c2`. On September 17, a bounded HTTP check failed and lsof showed no port8765 listener: **the temporary server is now stopped**; do not assume old exec session52755 exists.

Next steps:

1. Verify the existing Mac public-key fingerprint and current LAN address. If the SER file was not downloaded, recreate/restart only the tiny public-key server on the Mac LAN address, log start, and refresh Mark's short download instructions. Preserve password authentication off; do not disable the firewall or expose app-server transports.
2. Inspect Mark's photographed `ssh-keygen -lf ~/vault-mac.pub` output. Require the exact Mac fingerprint above (or explicitly verified current replacement) before using that file. A downloaded public key is not trusted merely because curl succeeded.
3. Once verified, guide a bounded local append to the existing `~/.ssh/authorized_keys`, preserving current entries and correct user-only directory/file permissions. Do not overwrite authorized_keys. No authorization command has yet been given. Then retry a bounded explicit-key SSH read-only identity/OS check from the Mac.
4. Stop the temporary public-key service after transfer; log the result. Add an exact observed SER SSH alias only after authentication works. Continue source transfer and native acceptance below. Mac-to-SER direct SSH shell access is sufficient for the lead to work; a Codex app host/project connection can follow.

The official desktop app Linux preview supports Arch, calls itself **ChatGPT**, and includes Codex selected from the upper-left **ChatGPT/Codex dropdown**. The user already completed this; do not claim no Linux app exists or reinstall it. Current sources: https://learn.chatgpt.com/docs/linux/linux-app and https://learn.chatgpt.com/docs/use-chatgpt . Current remote/project/handoff guide: https://learn.chatgpt.com/docs/remote-connections . Its Mac/Windows device-pairing flow does not establish Linux pairing support. A real task handoff requires a connected host and matching saved Git project; same-account sign-in and a source-only folder do not establish task migration. The calling task cannot hand itself off with the app tool. Do not promise a clone or a copied summary automatically transfers the original task.

## Full fresh-lead package and intake

The new full package is `/Users/markthomas/tenkings/vault-handoffs/2026-09-17-fresh-astra-lead/`. It includes this START_HERE, all tracked modifications as a binary patch, every non-ignored untracked file, per-file hashes/modes, guarded intake, physical evidence and adjacent electrical/controller references. Exact artifact hashes/counts are in manifest.json; the old lead sends its trusted manifest digest in the new-task prompt. Later intake/team receipts live externally so frozen payloads stay unchanged.

**A branch/base clone alone loses uncommitted code, art, tests and documents.** Use your pristine isolated task worktree and the supplied intake.py. It validates hashes, refuses dirty/protected destinations, creates a fresh codex branch at the exact base, checks/applies the patch, imports only verified regular files and verifies exact diff, untracked membership, bytes and modes. Never reset unexpected work. Do not edit preserved 59f4, 9bb0, 3c63, 2dbc, 24e6 or the saved main checkout. All new work belongs to your imported checkout.

At start read the six AGENTS-required documents: product context, the **entire** approved V2 blueprint, both runbooks, HANDOFF_SET_OPS and current/relevant SESSION_LOG. The package provides current copies for pre-intake reading; use the imported current copies afterward. Do not flood your context with the entire multimegabyte historical session log: read current sections and relevant linked evidence. Evidence outranks old docs; update contradictions in your checkout. Append planned and observed actions around deploy/restart/migration, and after commit-worthy changes.

After intake, report the exact destination/branch, manifest digest, tracked/untracked counts and verification receipt to the old lead. Start your three Astra workers and report their task names/model/effort. Record ownership in your own handoff/session log. Then continue the actual Vault work; receipt completion is not product completion.

## SER source snapshots and transfer constraints

Keep the fresh full-lead transfer distinct from the sparse SER build candidate:

- `/Users/markthomas/tenkings/vault-handoffs/2026-09-16-ser-candidate-r2`: **185 files, 35,017,097 source bytes**, source manifest SHA256 **1313aeed7b8232b990236d572dbd2b905570dfa7e9864f4108d8336114fcc05e**. Export and copied verifier passed. Unsigned/uncommitted source only; no native Linux result.
- `/Users/markthomas/tenkings/vault-handoffs/2026-09-16-ser-continuation-r2`: **16 total files, 4,765,478 bytes**. Fourteen payload files plus MANIFEST.json/SHA256SUMS; SHA256SUMS digest **229ff05122fa50ad3be83979f462f15f1609eb3c57e66dcd53bed529d6c34528**. Read-only agent context; not other apps. Worker verified every hash/exact membership. It predates this fresh-lead handoff and retains old checkout/pending-auth references.
- Older candidate-r1 remains immutable: 185 files, 35,014,959 source bytes; manifest SHA256 **16501f644168fea4a73f6269517e9473f71da2553bf02f0285ebbcfc6863f6c7**. Prefer r2 and its exact digest above.

Never mutate old candidates. Export a new revision if source changes. Transfer the verified Vault-only candidate to a new user-owned SER build directory; keep continuation material and new logs beside it, because the exact-file verifier rejects extra context files inside the candidate. Compare expected manifest digest from this trusted handoff before running its verifier. Never copy Mac node_modules, build output, secrets or the entire .codex state. A source-only candidate is enough for native build/simulation; moving full Git development/task ownership requires a separately verified matching project/intake.

**Mac disk pressure is current:** September17 check fell to 274MiB free. The old lead removed only five known agent-generated inspection PNG conversions after confirming original HEICs remain, recovering 61,647,378 bytes. Other files/worktrees are preserved. Recheck free space before copying/building; use APFS clone copies for immutable references when appropriate. Do not install dependencies or download OS images on the Mac. Prefer actual SER native work after access.

## Established physical history

- SER5 Aptio AMI BIOS SERAL202 (2026-04-14), Ryzen 5 **5500U**, **16GB DDR4**, internal **CT480E100SSD8 480GB**. Installer identified `/dev/nvme0n1 (447.1G)` with prior Windows partitions. Do not transcribe raw unit serials.
- Wired keyboard plugged directly into SER works; USB-receiver mouse works; Windows internet worked, followed by Omarchy desktop/CLI/app/network photos. The K380s Bluetooth keyboard is optional and irrelevant to the current blocker.
- Omarchy **4.0.4** ISO, 6,185,304,064 bytes, downloaded on SER. Actual photographed SHA256 matched official previously fetched checksum: `ddeded2758c48318d201dfdac905ecb28f570441883f0c052ea3cd5d05acf92d`. No detached-signature verification is claimed.
- Owner-confirmed empty SanDisk USB showed **USB SanDisk 3.2Gen1 USB Device, 30.8GB, D:** in Etcher; Etcher Windows2.1.6 reported Flash Complete. Delete entered BIOS; first **UEFI: USB** Boot Override booted Omarchy. F12/F7 were not verified. No TPM/Secure Boot reset/change was needed.
- Mark explicitly reaffirmed exact-context full-disk Windows replacement; chose Full disk install and later reported complete. Do not reopen erase approval/OS selection. Default encryption retained; actual repeated power-on unlock and unattended power-return behavior remain unverified. Password stays local.
- User `tkvault` is now observed, correcting the earlier reported capitalization TKVault. Optional Git name TenKings, email Mark@tenkings.co; these installer fields were not GitHub authentication. Hostname shown `tk-vault-01`.
- Acer screen displays working video. Exact external model label and separate USB touch data/rotation remain unverified. PM161QT was discussed; don't assume a USB-C port role without model/connection evidence.
- Owner reports all purchased parts present and **one Waveshare32CH board**. Accepted UI68visible4x17 is not a measured cabinet or sufficient controller capacity. No real serial device opened, relay/lock energized, physical qualification or real Nayax transaction by this lead.

Photos are indexed with hashes in the package. Particularly IMG_0388 provides account/IP, IMG_0389 SSH output, IMG_0387 Codex view, IMG_0367 exact install disk. Use HEIC viewing conversion in a task temporary directory when necessary; do not alter originals.

## Current code and validation limits

Read INTEGRATION_STATUS, SER_BRINGUP, LINUX_APPLIANCE, BENCH_PROGRESS, WAVESHARE_INTEGRATION and MARSHALL_INTEGRATION plus the three fresh worker receipts. This lead changed documentation only after verifying the prior import; implementation remains the accepted uncommitted candidate.

- Explicit MOCK/MARSHALL and SIMULATOR/WAVESHARE composition; no silent fallback; mock payment cannot authorize normal physical output.
- Controller Python helper reuses preserved bench transport, fixed nominal100ms board-timed pulses, one queue, all32OFF readback, durable journal and halt on uncertainty. Normal physical dispatch needs reviewed signed QUALIFIED schema2 mapping and trusted40hex source commit. Candidate hashes are ineligible.
- Marshall is unavailable/readyfalse without actual official native binding/configuration; LIVE fails closed. Incoming callback journal has no durable pump to VaultProviderCallback. See September16 review for startup/sequence/disposition/maintenance/snapshot gaps. Do not invent SDK ABI.
- Portrait B accepted; preserve styling/checkout. Software tests don't certify the actual touch monitor/cabinet.
- Linux deployment has pinned native runtime/release verification, non-login vault service account, protected credentials, exact udev permissions, draining/maintenance/snapshots and modern Omarchy Hyprland support. Installer leaves real service stopped/disabled. The human account tkvault remains separate.

Recorded prior local checks: contracts11, machine170, kiosk106, their builds; controllerPython36, appliancePython20; later focused source-bundle8 and simulator-source3. Maintenance6 is included in machine170. Do not invent a later combined173 machine rerun. Stocked72door simulated smoke:453events, one initial command + one user retry, max one in flight. Browser/multiple-view/idle/noWebGL tests have their recorded scope. No Linux Docker execution occurred; extraction/network/disk errors blocked it. Mac native SQLite relocation tested dependency closure only. Do not rerun Mac tests merely to occupy workers.

On the actual SER first inspect OS, architecture, mounted root, free space, tools and exact source. Native pins: **Node22.23.2 x86_64**, **pnpm9.12.0**, **better-sqlite3 11.10.0**. Node archive SHA256 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`; verify official checksum. Use a user-owned pinned runtime rather than replacing system Node. Filter to contracts/machine/kiosk workspaces; the root aggregate build/test includes unrelated cloud/database. Follow SER_BRINGUP's source verification, native compile/build/test, SQLite WAL/FULL rollback/reopen/integrity probe and disposable mock simulator. Keep accepted portrait query `?experience=portrait`. Actual restart/touch/physical/payment qualification remain distinct.

## Three fresh worker lanes

1. **Appliance/access/native:** SSH and source-integrity review, actual Linux build/runtime/touch/service acceptance. Lead handles Mark and shared host mutations. Own deploy/vault-linux and appliance docs only when assigned; don't independently change auth or firmware.
2. **Controller/bench:** preserved adjacent electrical/adapter evidence, strict all-OFF acceptance, measured lock/power/duty behavior, mapping/qualification. Start read-only. Do not create a new protocol or guess adapter/address1. Exit0 alone is not all-OFF: require channelsReportedOn empty and allRelaysReportedOff true. ACK/OFF isn't measured contact/current cutoff. Standalone bench precedes normal service journal initialization; never delete a journal to bypass qualification binding.
3. **Payment/Nayax:** identify actual delivered SDK/test access; native adapter and callback/reconciliation work when facts permit. User already called Nayax; “API access later today” was Sept16 and delivery remains unverified. Lynx/Core backend credentials aren't Marshall Linux C SDK ABI. Do not contact vendors without explicit instruction. Shared event-sequence/startup choices stay with lead.

Lead owns shared contracts/machine/runtime/UI, source/release authority, user guidance, documentation ownership and cross-review. Workers get concrete bounded assignments and separate file ownership; idle readiness is not progress. Keep proceeding on feasible software/native work while waiting for physical input or SDK. Existing hardware safety/qualification gates remain; no new redundant approval checklists.
