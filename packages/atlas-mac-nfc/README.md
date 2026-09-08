# Native macOS read-only NFC probe

This standalone Swift/C CLI discovers one ACS ACR1552U PICC interface through Apple's installed PCSC.framework. It can inspect a tightly restricted Type 2 header. It does **not** establish FEIJU F8215 identity, certify compatibility, determine a complete lock state, or authorize writing. No write/lock/authentication/reset APDU, generic APDU input, service, daemon, enrollment, key, network, database, or installer exists in this package.

**Known limitation:** prior same-lot legacy observations included ISO-DEP classification. This probe deliberately does not inspect ISO14443-4/ISO-DEP tags. `unsupported_tag_atr` means the present tag is outside this narrow read gate; it is not evidence that macOS, the ACS reader or native software cannot support F8215. There is no alternate APDU fallback.

Requires macOS 15+, installed Apple Command Line Tools with Swift 6. No package dependencies or downloads. Build output stays ignored under `.build`.

```sh
swift build --package-path packages/atlas-mac-nfc
packages/atlas-mac-nfc/.build/debug/atlas-mac-nfc-tests
python3 packages/atlas-mac-nfc/scripts/test-native.py
python3 packages/atlas-mac-nfc/scripts/test-deadline.py
packages/atlas-mac-nfc/.build/debug/atlas-mac-nfc-probe list
```

`list` never connects to a card or sends an application APDU. It requires exactly one supported PICC interface; SAM is excluded. Multiple matching interfaces, unknown ACR1552 interface names, malformed names or excessive enumeration fail closed. It emits a normalized interface label/count, not reader serial-bearing names. Matching names require ACS, exact ACR1552 or ACR1552U, and PICC tokens; other device families are ignored.

After operator review, the explicit read-only command is:

```sh
packages/atlas-mac-nfc/.build/debug/atlas-mac-nfc-probe inspect
```

Inspection opens an exclusive PC/SC connection, checks the exact documented standard ACS ISO14443A-part3/MIFARE-Ultralight ATR (card code 0003 and valid checksum), and sends **only `FF B0 00 00 10`**: READ BINARY, page zero, sixteen bytes. Unsupported/alternate ATRs stop before that command. Reader-driver names and ATRs are never emitted. Disconnect uses LEAVE_CARD; there is no reset/reconnect or retry. PC/SC activation and reader polling still occur as part of connecting; this is not an RF-silent tool.

Only an exact 18-byte successful response with valid seven-byte-UID BCC structure and conventional E1/10 Type 2 capability container is summarized. Bytes 1–9 (unique serial data, both checks and internal byte) are omitted completely; byte 0 is exposed only as the nonidentifying manufacturer code. No raw UID or UID hash is computed, returned, logged or persisted. The transient response exists in memory; owned buffers are cleared where possible, and the CLI disables core dumps. This is not a guarantee against privileged process-memory inspection or OS/driver logging.

Output includes the four CC bytes, CC mapping version (not chip version), advertised data-area size/access and two **candidate** static-lock bytes. These are observations under a familiar Type 2 layout, not authoritative F8215 lock decoding. It reads no dynamic lock/configuration pages or NDEF payload. CC advertised read-only access does not prove permanent locking. A clone can imitate all observed fields. `qualification` always remains `not_established`. GET_VERSION is intentionally absent: no exact supported F8215 command/reader transport has been established. A tag rejected by the ATR/header gate remains unqualified; there is no fallback command.

Inspection failures now include typed `failureStage` and boolean `fixedReadAttempted` when the execution path is known. Stages distinguish context establishment, connect, status, protocol/ATR validation, transmit, response/header validation, disconnect, and context release. The first failure is preserved even if cleanup also fails. `fixedReadAttempted: true` means the fixed SCardTransmit call was invoked; it does **not** prove RF delivery or read completion. For example, `no_tag` with `failureStage: connect` and `fixedReadAttempted: false` distinguishes initial detection failure from removal reported later by transmit or cleanup. The public output does not include raw PC/SC status values or exception details. Unknown failures and deadline termination do not invent a stage or claim no read occurred.

The process has an independent native eight-second watchdog covering PC/SC connect/read/cleanup and blocked stdout. It exits **124** at deadline, without attempting diagnostic output that could itself block. Treat empty/truncated output or nonzero exit as an incomplete observation. Normal results are one bounded JSON object; success is exit 0, unavailable/ambiguous/unsupported/read failure is 2, invalid arguments 64, watchdog setup failure 70. No automatic retry, polling or background continuation occurs. Scheduling/suspension of the whole OS is outside a userspace deadline guarantee.

The test executable uses injected reader responses only; the native C fixture replaces all PC/SC symbols with assertions and checks the sole APDU and cleanup. The deadline fixture blocks synthetic native work and stdout. XCTest is not required (the installed standalone CLT lacks it). Python is used only for standard-library test harnesses, never by the production executable.

Primary references:

- [ACS ACR1552U reference manual](https://www.acs.com.hk/download-manual/13475/REF-ACR1552U-Series-1.05.pdf): The official URL currently serves **Version 1.09** (retrieved 2026-09-08), despite its older filename. Section 5.3.1.1, page 32 defines the ATR: the accepted bytes `3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 03 00 00 00 00 68` follow its standard 03/card-name 0003 table and TCK rule. Section 5.3.3.4, page 39 confirms READ BINARY with page address zero and length 10h. These commands are reader-specific; they do not identify the tag silicon.
- [ACS ACR1552U official support](https://www.acs.com.hk/en/driver/575/acr1552u-usb-nfc-reader-iv/): macOS/PC-SC support. Availability of a driver is not proof it is installed or needed on this Mac; this tool installs nothing.
- Apple's actual SDK headers at `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/PCSC.framework/Headers/{winscard,pcsclite}.h` are the ABI authority used by the build. [Apple-origin SmartCardServices source](https://github.com/smartcardservices/smartcardservices/tree/master/SmartCardServices/src/PCSC) provides public background.
- [NXP NTAG213/215/216 datasheet](https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf): seven-byte UID/BCC and conventional Type 2 header layout only. NXP data is **not** substituted for a FEIJU F8215 lock specification.

Live qualification still needs the attached reader's actual supported interface and a reviewed read-only observation, trustworthy F8215 manufacturer/version/memory/lock evidence, and separate design/review of any future native write path. No hosted or staff workflow is activated by this package.
