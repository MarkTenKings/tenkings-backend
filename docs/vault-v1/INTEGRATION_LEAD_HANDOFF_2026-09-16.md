# Ten Kings Vault — hardware/payment integration lead handoff

> Historical first transfer from 3c63. The latest owner-requested transfer now comes from 9bb0 after controller/payment/appliance implementation and receipt of the wired keyboard. Read [FRESH_BENCH_LEAD_HANDOFF_2026-09-16.md](FRESH_BENCH_LEAD_HANDOFF_2026-09-16.md) first. Do not re-import this older package over the new implementation.

Prepared September 16, 2026, America/Los_Angeles. Read this first. Mark has accepted Portrait B as good enough for now and requests a fresh Astra Ultra lead to finish the system and connect the hardware with him today. This record supersedes older source-path, team, UI-priority and 70–72-door assumptions where they conflict. It does not claim hardware has already been installed or tested.

## Owner direction and team

- Stop design iteration. Preserve the approved Portrait B main screen and checkout; change UI only when required to make the real workflow function correctly.
- Finish the software, install/configure the existing SER mini PC, connect the lock controller and Nayax, and demonstrate one selected physical door unlocking after an authorized payment/test transaction. Work toward this today without promising unavailable hardware/vendor access will be resolved today.
- Lead: **gpt-6-astra, ultra**. Use **three gpt-6-astra, xhigh subagents** throughout the active build/integration work, reassigning them from implementation to validation as needed. Mark requested 3–5; the current capacity is four agents including the lead, so three workers fits. Explicitly set both model and effort when spawning, with a fresh/bounded context rather than a full-history fork that forbids overrides. Respect any actual destination capacity and report it honestly. Do not start more user-owned tasks for the workers.
- This September 16 request replaces the earlier “do not create a team of subagents” instruction. That older line is historical and must not block delegation.
- Mark wants streamlined, cost-effective, durable hardware, one lock energized at a time, reuse of owned parts, clear practical guidance, and sustained progress. Ask only for genuinely missing physical access/information or a concrete operational choice, while independent software work continues. Do not return to repeated one-item shopping or ask him to approve the same work again.

## Exact code and protected intake

Frozen source at preparation:

- Worktree: `/Users/markthomas/.codex/worktrees/3c63/ten-kings-mystery-packs-clean`
- Branch: `codex/vault-hardware-linux-20260909`
- HEAD: `c4f04006d9302445e2a68b01dcc316def3b4eb73`
- **Substantial tracked and untracked work is not committed. Checking out HEAD alone loses the UI, assets, simulator corrections and current docs.**
- The older `/Users/markthomas/.codex/worktrees/2dbc/ten-kings-mystery-packs-clean` is a preserved earlier source, not the current implementation. The saved project's main checkout is also not the continuation source.
- Durable package: `/Users/markthomas/tenkings/vault-handoffs/2026-09-16-integration-lead/`. It contains this handoff as `START_HERE.md`, `tracked.patch`, `untracked.tar`, `manifest.json`, and `intake.py`.

Read the mandatory AGENTS documents from the source before work: `docs/context/MASTER_PRODUCT_CONTEXT.md`, the **entire** `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md` (current Vault section), and current/relevant `docs/handoffs/SESSION_LOG.md`. The V2 card-platform blueprint is isolation/architecture context; do not expand this task into Speedster, ATLAS, card grading or unrelated cloud changes.

The app may create your task on the default project branch. Import the package into **your own pristine new task worktree**, not either preserved source or the saved main checkout:

`python3 /Users/markthomas/tenkings/vault-handoffs/2026-09-16-integration-lead/intake.py /absolute/path/to/your/new/task/worktree`

The importer checks the destination, creates a new `codex/` continuation branch at the exact base, checks/applies the binary tracked diff, validates/extracts listed untracked files, and verifies resulting hashes/diff. It refuses dirty or protected destinations. Do not bypass refusal by resetting user work; inspect and reconcile or use a fresh isolated worktree. Ignored dependencies, caches, credentials and environment files are not transferred. Verify the intake receipt before implementation, then use your imported checkout for every subagent and build. Source task stops editing after packaging.

## What works and what does not

| Area | Current evidence | Required next work |
| --- | --- | --- |
| Customer/staff UI | Playable Portrait B, original cinematic A, native no-WebGL controls; exact selected IDs, cart/tax/review, idle recovery and paid-flow presentation | Preserve approved design; wire existing handlers to qualified real services |
| Machine core | TypeScript local authority, durable SQLite sale/event lifecycle, inventory, configuration/profile validation, staff operations, recovery, one queued controller command at a time | Audit/finish composition and recovery with actual adapters; simulated command serialization is not proof that physical coils cannot overlap |
| Nayax | `packages/vault-machine/src/mock-nayax.ts`, durable mocks; real dispatch is rejected | Official Marshall SDK/terminal configuration, real native/serial adapter, callbacks, reconciliation, vend-result policy and certification |
| Controller | `packages/vault-machine/src/controller-simulator.ts`; no real serial transport | Waveshare-specific Modbus RTU transport, actual board identity/address/channel mapping, bounded controller-timed pulse and verified OFF/uncertain behavior |
| Appliance | Owner chose Linux direction; old source/install artifacts are Windows-oriented and not a finished installed appliance | Linux Node/native SQLite runtime, startup/service, serial permissions, browser kiosk/touch/orientation, protected credentials, recovery and state-aware signed updates |
| Cloud/config | Existing contracts, signed profiles and cloud routes/tests exist | Real machine enrollment/configuration, tax/support values and connectivity must be established; cloud outage policy blocks new checkout but allows authorized fulfillment/retry locally |
| Physical evidence | No physical lock unlock, real Nayax charge, SER installation or physical touchscreen qualification recorded | Progressively verify actual bench and observe results; do not label simulation a hardware pass |

Integration traps from the independent read-only code audit: `cli.ts` unconditionally composes `DurableNayaxMock` and `DeterministicControllerSimulator`; `machine.ts` has explicit LIVE readiness/payment/dispatch rejection. `packages/vault-contracts/src/adapters.ts` permits only `SIMULATOR_ONLY` vend-result policy, and vend reporting advances only for MOCK. `OFFICIAL_TEST` is a declared interface mode, not a working implementation. Replace these with a reviewed explicit composition/settlement design; do not merely flip a feature flag. Portrait B is also deliberately gated by `src/cinematic/experience.ts` to CERTIFICATION + SYNTHETIC. Promote the accepted visuals to the real mapped profile through deliberate tested product integration, not by relabeling fixture provenance. Hosted cloud code is real (`frontend/nextjs-app/lib/server/vaultV1`, routes `pages/api/vault/v1`, admin `pages/admin/vault.tsx`) while the preview injects `mockFetch`; deployed state remains unverified.

Primary code entry points: `frontend/vault-kiosk/src/App.tsx`, `src/portrait/PortraitVault.tsx`, `ProductShelf.tsx`, `PortraitWorld.tsx`, shared `components/PaidFlow.tsx`; `packages/vault-machine/src/cli.ts`, `runtime.ts`, `machine.ts`, `store.ts`, `operations.ts`, `types.ts`, `http-service.ts`, `mock-nayax.ts`, `controller-simulator.ts`; `packages/vault-contracts`; `scripts/run-vault-simulator.mjs`; cloud/database paths identified by root `vault:*` scripts and package READMEs. Do not bypass service authority with browser-generated payment/door state.

## Current UI and preview

- B: `http://127.0.0.1:55497/?experience=portrait`; A: same origin with `?experience=cinematic`.
- **September 16 check: port 55497 was not responding; the previously detached PID 67243 no longer exists.** Prior September 10 “running” entries are historical. If needed, log planned restart, build/start from your imported checkout, verify the actual listener and record the result. A restart creates fresh synthetic stock; it is not restoration of real inventory.
- Local launcher: `pnpm vault:cinematic -- --port 55497`; without `--port` it chooses a free port. This is a Mac-only preview, not installed software on the SER.
- Local Node 20: `/opt/homebrew/opt/node@20/bin/node`; pnpm: `/opt/homebrew/bin/pnpm`. Usual prefix: `env PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin`.
- Approved layout: compact header with owner's real gold logo; swipeable pack imagery, All packs/Sports/Pokémon filters; 4 columns × 17 rows, 6-inch-wide × 2.5-inch-high metal door faces. Gold matching doors; stable positions and unmistakable selection; original checkout preserved.
- The fixture profile is still 72 synthetic doors; B shows its first 68 service-ordered IDs. **4 × 17 = 68 is the owner's latest visible cabinet arrangement, not a qualified physical address/label map.** Preserve configurable-family support and historical schema1 data. Do not hard-code fixture order into a physical machine profile.
- $25/$50/$100 cards use six price/category-verified repository pack images (four photographs, two existing product artworks). $250 retains labeled concept artwork. All runtime assets, real logo and provenance are included; no owner attachment needs to be requested again for the UI.
- Current docs: `PORTRAIT_COMPARISON_2026-09-10.md`, `CINEMATIC_PREVIEW_2026-09-10.md`, `PREVIEW_AND_NAYAX_INTEGRATION_2026-09-09.md` under `docs/vault-v1/`; asset provenance `frontend/vault-kiosk/public/art/vault/ASSETS.md`.

## Confirmed equipment — do not re-buy these

“Ordered” below is Mark's recorded purchase confirmation, **not proof of arrival or successful connection**. September 10 delivery estimates are historical; establish what is on his bench today in one concise intake.

| Item | Known status / identity |
| --- | --- |
| SER5 | Owned. Ryzen 5 5500U, 16 GB RAM, **480 GB** storage, 2.5 GbE; SKU SER5-5500U-16480EJ0W64PRO-DP/XB; 19 V / 3.42 A input. Keep it. Installed OS/access not established. |
| Touchscreen | Owner purchased after Acer PM161QT bmiuuux / UM.ZP1AA.004 discussion (15.6-inch 1080p). Actual received label/box contents remain unconfirmed. HDMI video, USB touch data and correct screen power are separate needs. |
| Keyboard/mouse/USB drive | Owner reports purchased. |
| Nayax VPOS Touch | Owned, PN **R144GUSY01S10**, 40-pin rear connector, small LAN connector; SIM physically present. Antenna and Nayax PSU owned. Firmware/account/test readiness and PSU output remain unverified. Do not print/search serial or SIM identities. |
| Nayax USB-RS232 | Original USB2COM C310004 probably owned (owner 90% sure); one **FTDI CHIPI-X10** backup confirmed ordered. |
| Nayax Marshall harness | **Unconfirmed and may be missing.** Regular VPOS Touch/Onyx harness documented as C130011; match actual terminal/kit with Nayax. MDB booklet does not prove Marshall harness ownership. |
| Lock USB-RS485 | One **INNOMAKER isolated USB-RS485** adapter confirmed ordered. Shared bus for boards; separate from Nayax RS232. |
| Lock controller | **One Waveshare Modbus RTU Relay 32CH**, SKU25140 / Amazon B0CC5P8NC2, confirmed ordered for first bench. Do not assume three boards bought. |
| Lock | ATOPLEE B01IBEVV0Y, at least one owned. Supplied dimensions 73 × 58 × 13 mm, **12 V / 2 A**; actual label/polarity/duty/suppression unqualified. |
| Bench PSU | One **CHANZON 12 V / 5 A / 60 W enclosed PSU** (B073QTNF9F), confirmed ordered. Not automatically a qualified full-cabinet supply. |
| Wire | BNTECHGO 18 AWG fine-stranded tinned silicone, 10 ft red + 10 ft black, confirmed purchased. |
| Connectors | Plenty of WAGO already owned; exact series/ports need identification only as required for wiring. No new WAGO kit purchase. |
| Meter | AstroAI M4K0R auto-ranging multimeter confirmed ordered; includes leads/batteries per historical listing. |

Full current electronics workbook: `outputs/01a089a3-541f-74c2-9e87-915095421fbd/Ten_Kings_Vault_Electronics_Parts_List.xlsx`. Connection PDF: `output/pdf/Ten_Kings_Vault_Current_Parts_and_Connections_2026-09-09.pdf`. Older September 8 workbook/PDF are historical. Source hardware photos already inspected: `/Users/markthomas/Downloads/IMG_0077.HEIC`–`IMG_0083.HEIC`, `IMG_0085.HEIC`–`IMG_0098.HEIC`; do not ask for those again if still available locally.

Electrical facts for implementation: board power is separate from dry-contact lock power; 32CH accepts 7–36 V and recommends 12 V, unlike the old 5 V 16CH choice. Use only one board power input. Nayax, SER and locks have separate matched supplies. Vendor flash-on is described in 100ms increments, and the recorded seller claim for this lock is a 0.2s maximum single unlock signal; these are **inputs to verify, not a qualified pulse setting**. Do not run long vendor-example pulses or all-relays-on tests with attached locks. A queued serial command is not enough: retain the queue through physical pulse/off certainty and hold safely on uncertain output. Relay-state readback does not prove a door opened. Verify external coil suppression; onboard relay-driver diodes do not prove lock-coil suppression. Keep the lock accessible/unloaded for the first supervised test.

The earlier two inline fuse holders were deferred and not purchased. Mark rejected unnecessary protection shopping and wants minimal parts. Do not revive the old two-holder list or casually require a centralized fuse block. Complete a minimal defensible wiring/power arrangement using actual supplied protection and component evidence; short normal pulses alone do not qualify fault behavior. Do not use the historical holder's included 30 A fuse. No extra purchase without a concrete need and Mark's decision.

## Linux / “AI Operating System”

Mark wants the OS bundled with Vault, no Windows purchase/dependency, unattended kiosk startup and recovery after power loss. **Linux is direction, not installed support.** Omarchy was investigated (Arch-based, DHH/omacom project with AI tools) but **not adopted or installed**. His September 16 phrase “IF we are using the AI Operating system” is conditional; do not claim an existing AI OS decision. Establish whether he means Omarchy while preparing a reliable Linux appliance path. A separate AI agent runtime is not required for deterministic lock/payment operation. Do not delay serial/payment work to add unrelated AI features.

Prepare a concrete install/configuration plan and identify the SER's actual existing disk/OS/data/access before any wipe. Reversible code, local packaging and read-only device discovery are within scope; destructive disk work requires Mark's informed target-specific decision. Do not ask him to repeat existing purchases or assume a remote session/IP/SSH credential exists.

## Three worker lanes and the lead's immediate sequence

1. **Controller worker, Astra xhigh:** audit the existing adapter boundary, fetch current official Waveshare/INNOMAKER/FTDI documentation, implement qualified Modbus RTU transport and protocol tests using a fake serial peer first. Separate discovery/read-only diagnostics from commands, support stable Linux serial identity and exact address/channel profiles, bounded board-timed pulses, conservative timeout/OFF recovery and global non-overlap. No guessed Modbus registers or live actuation before a verified bench.
2. **Payment worker, Astra xhigh:** locate official SDK/integration welcome material in already available project/Downloads context without exposing secrets; use Nayax official sources. Implement the supported Linux x86_64 Marshall bridge from actual supplied SDK headers/sample/runtime. If SDK/test configuration is absent, build the supervised bridge contract/process lifecycle and durable callback/reconciliation tests, with unsupported real dispatch visibly blocked; provide one precise dependency request. Do not invent SDK signatures, HTTP endpoints, protocol bytes or no-sensor vend success semantics.
3. **SER/appliance worker, Astra xhigh:** prepare Linux install/kiosk/service packaging, native SQLite/runtime pinning, serial permissions, protected configuration, health/support diagnostics, state-aware restart/update plan, portrait touch/video setup and a concise bench connection guide using owned components. Assess “AI OS” conditional choice, existing SER access and hardware arrivals with the lead; do not wipe/install an unverified target autonomously.

The lead owns imports, conflict-free file ownership, runtime composition, actual inventory/cloud config and end-to-end integration. Workers should use disjoint files where possible; lead owns shared `machine.ts`, `cli.ts`, contracts and central docs. Bring necessary shared changes together with meaningful regression tests, then assign independent review and failure/recovery tests to the workers. Do not let all three edit the same service lifecycle concurrently.

After intake, open with a short accurate status and one bundled question for **today's physical availability/access and Nayax readiness**: is the SER powered/network-accessible, which ordered items arrived, is the Marshall harness present, and is the official SDK/integration engineer/test configuration available? Do not ask for passwords/payment credentials in chat. While Mark answers, start the three build lanes and complete all independent work. Ask further physical specifics only when they unblock the next concrete step.

Milestones:

- M1: imported code verified; all three workers started; requirements/bench unknowns stated; no UI redesign.
- M2: SER local service + portrait touchscreen working; verified serial device/board identity and safe idle/readback, before a lock pulse.
- M3: one correctly mapped lock on the reviewed bench opens with a bounded command; measured/observed release, OFF behavior, restart/host-loss behavior and one-coil-at-a-time invariant recorded. Never infer success solely from a relay ACK.
- M4: actual Nayax configured official test flow reaches definitive payment state; immutable transaction/sale/amount/door linkage and reconciliation proven.
- M5: one product → exact selected door → review/tax → authorized test payment → only that physical door → retrieval/one permitted retry/Done, with duplicate callbacks, timeout, unknown payment, interruption and restart checks. Any non-test monetary charge must have a concrete amount and informed owner authorization. No silent automatic repayment or re-unlock.
- M6: expand verified physical mapping to 68 doors and full cabinet power/harness only after bench qualification; complete existing certification/pilot requirements. One unlock is progress, not whole-machine certification.

## Evidence, tests and operating boundaries

Historical results, not rerun September 16: September 9 aggregate 263 tests after cookie isolation fix, 17 existing browser scenarios, 72/125 stocked HTTP smoke (453/503 events), exact selected initial + one retry and max one simulated command in flight. September 10: final kiosk build, **95 kiosk tests**, four portrait viewport flows including swipe/drag/keyboard/category/assets, four cinematic viewport flows, both no-WebGL/idle recoveries, and `git diff --check` passed. Browser test fixture teardown now closes HTTP listeners first and bounds stalled browser close; both final commands exited 0. Artifacts: `outputs/vault-portrait-cleanup-2026-09-10/`, `outputs/vault-portrait-2026-09-10/`, `outputs/vault-cinematic-2026-09-10/`.

Useful commands from imported checkout: `pnpm vault:build`, `pnpm vault:test`, `pnpm --filter @tenkings/vault-kiosk test:portrait`, `test:cinematic`, `test:browser`, `pnpm vault:validate-isolation`, `pnpm vault:test-next-routes`. Build/install pinned dependencies in the destination; do not copy ignored `node_modules` or credentials. Run appropriate tests for changes, not endless full-suite repetitions while the actual blocker goes untouched.

Read `docs/vault-v1/PRODUCT_BASELINE.md`, `MACHINE_PROFILES.md`, `GATE_LEDGER.md`, `TEST_AND_CERTIFICATION_MATRIX.md`, `EXTERNAL_EVIDENCE_PACKETS.md`, current package READMEs. G-01/G-02/G-04 and physical evidence remain open. September 16 authorizes hands-on integration work with Mark, not invented evidence or unscoped production changes. Advance code and concrete bench preparation without generic approval rituals; get the missing reviewed setup/target facts before a real physical command or destructive install. No automatic vendor messages, purchases, live charges, credential rotation, production DB mutation, deployment/migration, PR merge or pilot launch. A vendor request may be drafted, but sending it needs explicit authorization. Official test-mode hardware operation still requires correct access/configuration and bench readiness.

Append every commit-worthy change and planned/observed restart/deploy/migration to `docs/handoffs/SESSION_LOG.md`. Preserve all prior user work and approved V2 platform boundaries. Keep explanations clear and practical; report real measurements separately from simulations.

Primary vendor pointers (recheck current details before implementation): Nayax `https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration`, `.../marshall-integration-process`, `https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps`; Waveshare `https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH`; INNOMAKER `https://www.inno-maker.com/product/usb2rs485-cable/`. VPOS Touch Marshall control is RS232 via the approved harness, **not Ethernet control**; terminal LAN/SIM does not supply SER internet. No Marshall SDK package or test configuration was found in the prior targeted check; reassess availability today.
