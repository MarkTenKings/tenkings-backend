# Manual approved-report finishing

This source extension prepares a label and paired print/NFC intents for the current manual V2 report. It has no certificate allocator, Ten Kings ownership writer, migration, device installation or activated printing/NFC service. Historical `./nfc` and `./browser` exports retain their Windows/GoToTags contracts.

## Exact approved source

The authenticated server loads the immutable approval and published public packet, preserving its exact stored bytes/hash, and calls:

```js
import { createManualFinishingPlan } from '@atlas/finishing/manual';
const plan = createManualFinishingPlan({
  cardId, approvalActionId, sourceRevision, sourceHash,
  packet, publicHash,
});
```

The source loader must verify current card access, approval action/source/report hashes, published manifest and the strict public manual packet contract. The helper verifies the packet's exact JSON SHA-256 and derives its label from the saved half-point award, never recalculating a different displayed grade. A stable plan hash binds card, approval action, source revision/hash, report/public hashes, report number, token, version, identity and label design. Print and NFC have separate deterministic intent identities. Re-reading the same approval returns identical intents. A new approved version is a new plan, with its versioned report URL; no client-selected URL is accepted.

The implemented adapter is `createManualFinishing({repository,artifacts})` in `packages/atlas-connected-manual/src/finishing.mjs`. Its `load(staff,cardId,actionId)` verifies those sources and reauthenticates after storage access. The authenticated read-only endpoint is `GET /api/staff/manual-connected/cards/:cardId/finishing/:actionId`; it returns the plan directly. Internal service composition can use `loadPacket(staff,cardId,actionId)` for `{packet,publicHash,row}` under the same checks. The private approval/storage row is never part of the HTTP response.

`label.reportNumber` is the existing report reference, **not a newly allocated physical certificate**. The plan alone proves no print, tag write, permanent lock, assembly or weld. Local fixture labels say EXAMPLE / NOT ISSUED and cannot enter the native printer/dispatch adapters.

## Label and browser

`@atlas/finishing/label` is browser-safe. `renderManualLabel({label,measureText,qr,palette})` accepts the existing `qrcode` module matrix for `label.url` and a real canvas text measurer. It returns self-contained Front/Reverse SVG with escaped text and no remote fonts/images. `palette` is `NOIR_GOLD` or `MONOCHROME`. Identity wraps and fits in full; an identity too long for the defined area stops with `MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT` instead of silent truncation.

Both faces retain the canonical 2.73 × 0.83-inch size. The Front keeps the historical 11 mm NFC reserve and 9 mm printed placement guide, at their existing coordinates. The Reverse uses black/white QR modules and a four-module quiet zone. This does not select a cutting die, adhesive, roll/sheet arrangement, printer or physical finishing material.

`frontend/atlas-app/components/ManualFinishing.jsx` accepts `{plan,autoPrintWindow?,onPrintDialog?,printDisabled?}`. The explicit approval click can call its named `openManualLabelPrintWindow()` export before awaiting approval, then supply that same window after loading the saved plan. Close the owned window if approval/publication fails. The component binds rendered SVG to the current plan before printing; a rapid card switch cannot send the previous card's SVG with a new title. A popup block leaves the visible Print label action available. Reopening a saved label never automatically prints it.

The browser invokes its ordinary print dialog and reports only `DIALOG_OPENED`. It cannot silently select a printer or prove paper output. The current page deliberately reports NFC setup pending. Automatic physical dispatch requires the local bridge described below; this browser component contains no hardware endpoint or credential.

Generate a self-contained synthetic design preview:

```sh
node packages/atlas-finishing/scripts/label-preview.mjs /tmp/atlas-label-design.html
```

## CUPS software adapter

`@atlas/finishing/cups` exports `createCupsPrinter`, `createFileCupsJournal` and the explicit opt-in `createLocalCupsTransport`. Importing them never queries or writes to a printer. The printer adapter requires an externally qualified exact printer/media/layout profile, its qualification evidence hash, a deterministic PDF renderer and durable journal. It has no guessed/default printer or automatic profile discovery.

The renderer returns `{bytes,sha256,planHash,layoutVersion}`. It must retain/reuse the **same exact PDF bytes** for that intent, including stable metadata; a fresh PDF with changed bytes conflicts rather than silently reprinting. Profile qualification must verify the generated PDF's physical size, media placement, actual-size output, color/material and readable QR. The adapter validates the exact PDF content hash and intent/profile before effect.

The file journal requires a private, user-owned 0700 directory and writes/fsyncs separate 0600 intent and outcome records. Reservation precedes dispatch. A concurrent or restarted invocation finds the same intent and reconciles its known CUPS job; it never resubmits. A timeout or lost response without a saved CUPS job ID remains UNKNOWN for operator reconciliation. Deleting an intent to retry is unsupported. A deliberate additional label-copy/reprint authorization is future hosted integration, not inferred from a retry.

The real local transport uses `/usr/bin/lp` with an argument array, explicit local scheduler, exact allowlisted printer/media, one copy, no job sheets and actual-size scaling. Verified PDF bytes go through stdin, with no shell, arbitrary file path or inherited `CUPS_SERVER`. Status uses bounded loopback IPP Get-Job-Attributes and matches job identity/title/printer. `SPOOL_COMPLETED` means CUPS reported state 9; canceled/aborted states 7/8 are `SPOOL_FAILED`. Neither state attests to correct physical fit, readable labels, tag programming or slab assembly. Command/status semantics follow the [CUPS lp documentation](https://www.cups.org/doc/man-lp.html) and [IPP specification](https://www.cups.org/doc/spec-ipp.html).

## Paired preparation

`dispatchApprovedFinishing({plan,association,printer,nfc,now})` launches independent print and NFC adapter preparation together. Current native authorization must supply the exact physical card/approval/plan association, station ID and a bounded armed session (maximum 15 minutes). Each adapter owns its durable idempotent intent and recovery. Missing/unqualified adapters return UNAVAILABLE independently; a printer issue does not erase the grade or forge NFC completion. An uncertain effect remains UNKNOWN.

The dispatcher accepts printer spool states and explicit NFC station states, including retained results on exact retries. `NFC_COMPLETE` requires separate readback, lock, observed removal and verified hosted acknowledgement facts; assembly remains `NOT_RECORDED`. The new [Mac NFC station core](MAC_NFC_STATION.md) provides the qualified adapter interface and durable recovery, but its native executable, enrolled signer, hosted pairing and real F8215 qualification are not implemented by that interface. The diagnostic writer remains an isolated fixed-URI program.

## Remaining physical integration

- Actual printer/model, media stock and feed arrangement; reviewed profile/PDF scale, fitting and QR acceptance.
- A shipped, paired Mac bridge connecting authenticated hosted plan authorization to the local CUPS adapter and a protected station identity. No public arbitrary-print endpoint is supplied here.
- Same-lot F8215 identification and permanent-lock documentation/evidence, including a real hardware overwrite rejection after re-presentation. No NTAG215 addresses or guessed masks are adopted.
- Protected Mac signing/enrollment, signed hosted completion acknowledgement, durable tag-removal/recovery and current authorization checks from [MAC_NFC.md](../../docs/atlas/MAC_NFC.md).
- Physical issuer/label-copy policy if ATLAS intends an issued certificate beyond the existing approved-report reference.

Tests cover exact version/hash/award binding, full identity/escaping, simultaneous preparation, absent capabilities, card association/expiry, durable CUPS restart/unknown behavior, document/profile conflicts, IPP result distinctions and exact non-shell command arguments. Component tests cover honest print-dialog state, popup failure and stale-SVG/card switching. These are software checks with injected printer/device effects, not hardware or throughput acceptance.
