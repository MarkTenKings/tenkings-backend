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

1. Record the actual install result. Check `com.acs.acsccid` receipt, installed bundle version/signature and any selected installation errors. Do not infer installation from the prepared download.
2. Reconnect the ACR1552U, then run `packages/atlas-mac-nfc/.build/debug/atlas-mac-nfc-probe list`. Rebuild with `swift build --package-path packages/atlas-mac-nfc` only if needed.
3. With one owner-presented unused F8215 tag, run the fixed `inspect` command once. Retain only its bounded nonidentifying JSON output and actual exit status.
4. If it still fails, investigate that exact stage. `unsupported_tag_atr` means the tag is outside this narrow read gate, not that Mac support is impossible. Do not introduce speculative tag commands or lock masks.
5. Record the observed result in SESSION_LOG. The exact F8215 write/lock profile and full native station workflow remain separate implementation and acceptance work.

Private receipts under `ACS_MAC_DRIVER_AUDIT_20260908` retain the archive, signature evidence, inspected package scripts and hashes. No driver package or external installer is distributed in this repository.
