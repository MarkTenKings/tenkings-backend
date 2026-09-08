# MacBook reader setup checkpoint

September 8, 2026. This setup concerns Mark's existing ACR1552U on macOS 15.5 arm64. It is a prerequisite investigation for [integrated ATLAS NFC](MAC_NFC.md), not an accepted F8215 writer or lock procedure.

## Observed before installation

The native probe discovers exactly one ACR1552U PICC interface. With an owner-presented unused tag, including after reconnection to another port, it returns `no_tag` at the PC/SC `connect` stage with `fixedReadAttempted: false`. The user observes an indicator on initial connection that then goes dark. The generic CCID 1.5.1 bundle exists; no ACS bundle or package receipt was found in inspected standard locations. These observations do not establish whether RF polling, the driver or another physical factor causes the failure.

Two private, bounded diagnostics attempted only the ACS-documented Get PCD/PICC Status command (`E0 00 00 25 00`), using separately reviewed PC/SC transport codes. Both returned `80100004` at `SCardControl132`. No radio state was obtained and no reader setting, firmware or tag memory was changed. These diagnostics are not production probe features.

## Prepared official driver

[ACS lists Mac driver 1.1.13, dated November 17, 2025](https://www.acs.com.hk/en/driver/575/acr1552u-usb-nfc-reader-iv/). Its own [ACSCCID project](https://sourceforge.net/projects/acsccid/files/acsccid/1.1.13/) supplies the retrieved archive. The ACS website's differently named download was unavailable to the local downloader; byte identity between those two ZIP deliveries is unverified.

The retrieved installer is signed by **Advanced Card Systems Limited**, Apple developer team `4C5LG9ZP6A`, with Apple notarization verified by `pkgutil --check-signature`. Its driver bundle passes strict code-signature verification and contains arm64 and x86_64 binaries; arm64 requires macOS 11.0 or later. Its supported-reader list includes ACR1552U-M1 and M2.

Exact `acsccid_installer.pkg` SHA-256: `9904d0f1c901c20fe9522d4f99197db17c1c3ea8f5bee769ba91c97933a02de2`.

The normal installer selects the ACS driver on macOS 15.5 and installs it under `/usr/local/libexec/SmartCardServices/drivers/ifd-acsccid.bundle`. The obsolete Apple-driver edit and old OpenSC startup packages are excluded by its OS-version conditions. The selected package declares administrator authentication and `RequireRestart`. The user must save other work, complete Installer's normal authentication and choose when to restart. No automatic installation/restart or security-setting override is part of this checkpoint.

The vendor postinstall also attempts an obsolete `/usr/libexec` link and exits zero even if that attempt fails. Therefore an Installer success message alone does not prove the driver loads. Preserve normal system protections and inspect actual loading after restart. Do not use the bundled broad uninstaller as an assumed isolated rollback; it also targets historical smart-card configuration.

## Resume after the user's installation and restart

Observed September 8 at 22:16 UTC: Mark reported installation and restart, and shared macOS's ACS smart-card extension notification. Independent checks found `com.acs.acsccid` version 1.1.13, bundle identifier `hk.com.acs.ccid`, and a valid strict code signature. The installed binary SHA-256 exactly matches the audited package (`f027d102f7fde7efddf85b0f5387b8c5cc699371ce122c6b014e0d8d28be5c1c`). Initial USB/PCSC discovery found no connected ACR1552U, so the user was asked to reconnect it and present an unused tag. That initial observation preceded reconnection; the subsequent successful communication and tag read are recorded below. Private evidence: `MAC_NFC_POST_RESTART_DRIVER_20260908.json` and `MAC_NFC_POST_RESTART_INSPECTION_20260908.json`.

1. Record the actual install result. Check `com.acs.acsccid` receipt, installed bundle version/signature and any selected installation errors. Do not infer installation from the prepared download.
2. Reconnect the ACR1552U, then run `packages/atlas-mac-nfc/.build/debug/atlas-mac-nfc-probe list`. Rebuild with `swift build --package-path packages/atlas-mac-nfc` only if needed.
3. With one owner-presented unused F8215 tag, run the fixed `inspect` command once. Retain only its bounded nonidentifying JSON output and actual exit status.
4. If it still fails, investigate that exact stage. `unsupported_tag_atr` means the tag is outside this narrow read gate, not that Mac support is impossible. Do not introduce speculative tag commands or lock masks.
5. Record the observed result in SESSION_LOG. The exact F8215 write/lock profile and full native station workflow remain separate implementation and acceptance work.

Private receipts under `ACS_MAC_DRIVER_AUDIT_20260908` retain the archive, signature evidence, inspected package scripts and hashes. No driver package or external installer is distributed in this repository.


## Attached reader and first successful native read

After reconnecting, USB showed one ACR1552U-M1 (`072f:2303`), and ACS driver 1.1.13 exposed `ACS ACR1552 1S CL Reader(1)` and `(2)`. The user's System Settings screenshots also showed the ACS extension enabled. The initial PICC-token selector stopped before tag commands because these aliases omit interface names. [ACS's exact v1.1.13 source](https://github.com/acshk/acsccid/blob/ac96e83057072ba1af30a6b40e62919f5095f9d4/src/ccid_usb.c) confirms the two-interface M1 and SAM at USB interface 1. Do not equate a macOS alias suffix with that USB index.

Fixed reader-only Get PCD/PICC Status succeeded through current alias 1 and returned `80100016` through alias 2. On alias 1, the radio reported off, polling options were `00`, and polling types were `0000`. Thus automatic detection was disabled at this checkpoint; the cause of those earlier settings was not established. The screenshots did not indicate a missing Mac permission.

At 22:32:13 UTC, a bounded, separately reviewed reader-setup script restored the [ACS manual](https://www.acs.com.hk/download-manual/13475/REF-ACR1552U-Series-1.05.pdf)'s version 1.09 defaults (pp 66–69): polling types `0705`, options `8B`, RF on with polling. Exact disabled-state and observed-pair gates passed; every setter intent was durably journaled, every acknowledgement matched, and separate getters verified `0705` / `8B` / radio `01`. This changed the reader's configuration only. No firmware or tag memory was modified. No automatic retry was made. These setter commands are not part of the production probe.

The updated native probe lists the exact alias pair as `reader_interfaces_found`, with two candidate interfaces and no claimed physical-reader count. `inspect` resolves it by one presence snapshot: exactly one present candidate must match the strict documented Ultralight ATR and the other must be empty. It then rechecks the ATR on its exclusive connection before the sole fixed header read. Alias order does not select a card. Unknown/partial/extra aliases or ambiguous/busy/unsupported states stop before reading.

At **22:37:48 UTC**, the actual native `inspect` succeeded (exit 0, 0.205 seconds): manufacturer code `1D`, CC `E1103E00`, advertised data area 496 bytes, unrestricted advertised CC access, static-lock candidate bytes `0000`. These are nonidentifying header observations; they do not establish F8215 silicon identity or complete/permanent lock state. Raw UID/ATR were not emitted or retained. The tag was not written or locked. Current probe SHA-256: `5cf7fb3dd5c6d2f260a4653da55eb12442623de87f9a9209dae32e2a55805495`. Synthetic validation:14 Swift + 29 native C + 2 watchdog scenarios passed.

Private evidence under the September7 handoff directory: `MAC_NFC_POST_DRIVER_SLOT_PRESENCE_20260908.json`, `MAC_NFC_VENDOR_DRIVER_RADIO_1_RESULT_20260908.json`, `MAC_NFC_VENDOR_DRIVER_RADIO_2_RESULT_20260908.json`, `MAC_NFC_VENDOR_DRIVER_POLLING_RESULT_20260908.json`, `MAC_NFC_READER_POLLING_SETUP_RESULT_20260908.json`, its per-command setup journal, and `MAC_NFC_POST_POLLING_NATIVE_INSPECT_20260908.json`. Retain the earlier failures as history. Removal/re-presentation validation is next; exact F8215 write/lock qualification and integrated production finishing remain pending.
