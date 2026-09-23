# Mac NFC station — source checkpoint

**Production hardware qualification and station activation remain pending.** The software now includes the station algorithm, durable recovery, a compiled native Mac companion, protected-key setup/signing source, signed hosted protocol and browser/Node station bridge. The native F8215 qualification registry is empty, so the executable reports `productionReady:false` and refuses production open/write/lock. No chip/driver/key/production DB operation was performed for this checkpoint. The prior fixed diagnostic executable is unchanged.

`@atlas/finishing/mac-nfc` exports `createMacNfcStation`, `encodeApprovedNdef`, and `createQualifiedType2Io`. Creation is cold. It requires trusted native profile/signer/authority/PCSC/host/journal dependencies, never browser callbacks. The real binding and executable are documented in [native companion](../atlas-mac-nfc/COMPANION.md); the loopback station composition is in `packages/atlas-finishing-station`. Hosted protocol schemas live in `station-protocol.mjs`/`station-wire.mjs` and the connected manual service. Setup does not silently activate them.

## Lifecycle

1. `prepare({plan,association})` verifies the exact immutable production plan and signed hosted arm, then durably reserves one station-wide intent. `WAITING_FOR_TAG` is returned only after qualified station preparation. An unresolved other intent is refused across processes/restarts.
2. Presence is checked before `onTagPresent`; an empty reader does not poison a pending arm. `onTagPresent` atomically claims the intent before the exclusive native session. Qualified writable identity and an empty affected region are required.
3. The exact approved versioned report URL is encoded as a short URI NDEF/TLV. Each page is attempted once, header last, with transient same-tag checks, page/full readback, unchanged trailing bytes, and durable intent before mutation. A lost write/lock outcome remains occupied and is never automatically repeated.
4. Readback and lock verification are separate durable facts. Only a reviewed compiled F8215 implementation may supply permanent locking; security-page addresses/masks are absent from the current source. Verified lock plus another payload readback precedes signing.
5. The protected enrolled signer signs only the fixed allowlisted WRITE receipt. No UID or UID digest is saved. Only the cryptographically verified exact hosted acknowledgement establishes `hostedAcknowledged`.
6. Native removal is separate. Core `NFC_COMPLETE` requires readback, lock, WRITE acknowledgement and removal; assembly remains `NOT_RECORDED`. The bridge subsequently signs/relays the fixed removal receipt, and the hosted station slot is released only when its completion acknowledgement is durable. A fresh native process starts only after that completion.

`recover` never writes. Interrupted processing/write/lock phases become `UNKNOWN` and retain the station slot. Before expiry, a fully verified lock may finish signing; a durable signed receipt can reconcile host acknowledgement and observe an empty reader. Native `restore-receipt` verifies the exact existing signature and permanently restricts that child to read-only recovery. It cannot start another write.

After expiry, only custody of an already saved signed receipt and an exact already-committed host acknowledgement can be reconciled. No RF observation, new signature or renewed arm is allowed. Already-signed removal can be relayed after expiry; unfinished removal/signing remains unresolved for explicit operator reconciliation. `status` still exposes saved facts. No automatic UNKNOWN clearing or operator override is supplied.

## Durable slot and verification

`createFileMacNfcJournal` uses one protected authoritative directory per station, an atomic cross-process mutex, revision compare-and-swap, mode 0600 records, native `F_FULLFSYNC` and directory synchronization. It retains all completed intents to prevent re-encoding. A crashed mutex is not expired/deleted at startup. History is bounded to 4096 intents/16 MiB; exhaustion stops admission until reviewed archival is implemented.

Nine injected-effect core tests cover cold arm, exact NDEF/order, readback/lock/ack/removal separation, lost writes, expiry, unsupported/swapped/nonempty tags, concurrent callbacks, station-wide exclusion across recreated journals, terminal replay and crashed journal locks. The native suite adds actual compiled fault fixtures, full-sync/deadline checks, protected-protocol validation and Node↔Swift signature/recovery interoperability. These tests use fake PC/SC and CPU-only fixture keys; they do not qualify hardware or create station keys.

Remaining production work is qualification and release acceptance: authoritative F8215 evidence and reviewed lock implementation, actual chip overwrite rejection and phone/read/removal/restart tests, operator-provisioned enrolled protected key with host allowlist activation, signed/notarized package/OS permission acceptance, physical printer/media qualification and measured throughput. See the native companion document for exact command/wire contracts and limitations.
