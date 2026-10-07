# SER native acceptance and running preview — September 17, 2026

Mark authorized the next startup step after the verified transfer. The lead used the already authorized Mac SSH key for `tkvault@192.168.2.36` (`tk-vault-01`). Omarchy 4.0.4, Linux x86_64, Python 3.14.7, compiler tools and Chromium were observed. System Node 26.8.2 was preserved and is not used for Vault.

The immutable source/context transfer remains at `/home/tkvault/vault-transfer/ten-kings-vault-r3-20260917T195409Z-5fdfa5ea`. The source manifest and verifier were authenticated before executing the verifier; the source then passed exact verification before and after copying. All build/dependency changes are in a new separate run directory:

```text
/home/tkvault/vault-native-r3-20260917.mVRi5N
```

Its `source/` is the working copy, `tools/` contains the pinned user-owned tools, and `logs/` contains execution evidence. Node 22.23.2 matched the previously trusted archive digest and the official checksum list downloaded directly on the SER. pnpm 9.12.0 and the frozen workspace lockfile were used. better-sqlite3 11.10.0 compiled natively under Node ABI 127. No sudo, system package replacement, installed Vault service, boot configuration, real credential, controller output or payment was involved.

## Native results

| Check | Result |
| --- | --- |
| Contracts | 11 tests passed |
| Machine | 182 tests passed |
| Kiosk | Production build and 106 tests passed |
| Appliance Python | 28 tests passed |
| Controller Python fixtures | 36 tests passed |
| Total | 363 tests, zero failures |
| SQLite | SQLite 3.49.2; WAL, transaction rollback, reopen and integrity passed |
| Source after build | All 186 source entries still matched manifest; declared generated outputs excluded |
| Mock HTTP purchase smoke | Restock, checkout, payment, exact selected door, one initial command and one retry passed; maximum command concurrency 1 |
| Process lifecycle | Two successful startups and clean SIGTERM stops; a third preview was left running |
| Browser | Existing Chromium 152.0.7977.82; 1280×800 headless software-rendered check showed 68 Portrait B door buttons, ready scene, no page errors or failed local assets |
| Desktop | Chromium window titled `Ten Kings Vault - Chromium` observed mapped and visible |

The source identity remains unsigned `CANDIDATE_SHA256:0a50c296f10dfdee3cde4848b06b5a1306e3067c6e5c3f65e3bdda9f5881cc39`. Accepted Portrait B and source files were not edited. Headless browser success does not prove physical touch or installed GPU acceptance. Process restarts create fresh disposable sessions; they do not demonstrate retained financial session recovery.

## Use and restart

Open this address **on the SER**:

```text
http://127.0.0.1:55497/?experience=portrait
```

The current preview was started at `2026-09-17T20:07:45Z`, PID 82708, with output in `logs/preview-start-3.log`. `RUNNING_PREVIEW.json` records that launch; it is a historical receipt, not a live liveness monitor. The mode is `DISPOSABLE_SIMULATION_ONLY`: all payments, door outputs, products and cloud responses are synthetic. Closing Chromium does not stop the separate preview process. The preview is not configured to start automatically after reboot.

If the preview has stopped, run this on the SER and keep that terminal open:

```bash
bash /home/tkvault/vault-native-r3-20260917.mVRi5N/start-preview.sh
```

An occupied port is refused; the launcher never terminates another listener. Ctrl+C stops a foreground preview and removes only its own disposable simulator state.

## Remaining live-operation work

The native doctor reported zero stable serial devices, no protected credentials and no installed Vault appliance. Next are actual USB–RS485/controller identification and supervised unloaded communication, measured lock/power/wiring and signed mapping qualification, physical touch/display and installed service/power-return checks, protected machine enrollment/configuration, and a reviewed committed signed release. The official Nayax Marshall Linux SDK/test configuration is still unverified and the real adapter/callback delivery integration remains incomplete. No real selected-door payment/unlock milestone is claimed.

Earlier access/transfer-only or native-pending notes in September 16/17 review documents are historical and superseded by this receipt. Frozen transfer/handoff snapshots remain unchanged.
