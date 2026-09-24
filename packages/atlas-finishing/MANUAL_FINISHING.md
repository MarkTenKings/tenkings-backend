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

`label.reportNumber` is the existing report reference, **not a newly allocated physical certificate**. The plan alone proves no print, tag write, permanent lock, assembly or weld. Local fixture fronts say EXAMPLE and cannot enter the native printer/dispatch adapters. The v2 reverse is entirely black even in a fixture.

## Label and browser

`@atlas/finishing/label` is browser-safe. New plans use `atlas-signature-v2`: the exact owner-supplied fingerprint-A logo is embedded in the Front, followed by the large player/character name and optional parallel/insert variant. Year, manufacturer, set and card number remain in the approved report and are omitted from the center. Base/null variants do not add a line. The renderer uses a real canvas text measurer, escapes text and returns self-contained SVG without remote fonts/images. Names wrap without truncation; text that cannot fit stops with `MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT`. New artwork uses `NOIR_GOLD`. Explicitly supplied saved `atlas-noir-gold-v1` labels still use their unchanged legacy renderer, including its QR and monochrome option.

Both faces retain the canonical 2.73 × 0.83-inch size. The Front keeps the historical 11 mm NFC reserve and 9 mm printed placement guide, at their existing coordinates. The v2 Reverse is one opaque black rectangle: no QR, text, artwork or border. This does not select a cutting die, adhesive, roll/sheet arrangement, printer or physical finishing material.

`frontend/atlas-app/components/ManualFinishing.jsx` accepts `{plan,staffId,csrf,autoPrintWindow?,onPrintDialog?,printDisabled?}`. The explicit approval click can call its named `openManualLabelPrintWindow()` export before awaiting approval, then supply that same target after loading the saved plan. A selected native station returns a cancellable dispatch marker instead of opening a browser print window. Close the owned target if approval/publication fails. The component binds rendered SVG to the current plan, waits for the print document's embedded logo and fonts, and rechecks that binding before opening the dialog. A rapid card switch cannot print the previous card while image loading is pending. Print CSS sizes only the outer face SVG, preserving the nested logo viewport. A popup block leaves the visible Print label action available. Reopening a saved label never automatically prints it.

With browser printing selected, the page invokes its ordinary print dialog and reports only `DIALOG_OPENED`. It cannot silently select a printer or prove paper output. A paired, enrolled and qualified native station instead receives the exact hosted signed approval plan. Native uncertainty does not fall back to a second browser print. The next physical card stays blocked while the prior station intent is unresolved.

Generate a self-contained synthetic design preview:

```sh
node packages/atlas-finishing/scripts/label-preview.mjs /tmp/atlas-label-design.html
```

## Design iteration and release boundary

`src/label-design.mjs` holds the versioned name/variant fonts, sizes, spacing and colors. Its exact values and original logo SHA-256 are copied into the plan and participate in the plan hash. `assets/atlas-grading-logo.png` preserves the supplied bytes; the browser-safe data URI has the same digest. The current [local studio](scripts/label-preview/README.md) edits synthetic name/parallel samples and typography live, then exports an inactive JSON design draft. Its PDF link is explicitly the saved **default** design, not the current slider draft.

The next-phase finishing service has not been activated. This v1-to-v2 source change assumes no production arms or local print/NFC intents were issued by the prior candidate. Verify that condition before first deployment/activation. The current read-only loader derives a plan from the approved report using the selected source defaults; it does not persist an independent historical template choice. A future live default change requires persisted template selection per approval and recovery acceptance, not merely editing the default object. Historical supplied v1 SVG/PDF support does not by itself make hosted plan regeneration version-stable. Previewing/downloading a draft changes none of these operational defaults.

## CUPS software adapter

`@atlas/finishing/cups` exports `createCupsPrinter`, `createFileCupsJournal` and the explicit opt-in `createLocalCupsTransport`. Importing them never queries or writes to a printer. The printer adapter requires an externally qualified exact printer/media/layout profile, its qualification evidence hash, a deterministic PDF renderer and durable journal. It has no guessed/default printer or automatic profile discovery.

The renderer returns `{bytes,sha256,planHash,layoutVersion,renderProfileHash}`. It must retain/reuse the **same exact PDF bytes** for that intent, including stable metadata; a fresh PDF with changed bytes conflicts rather than silently reprinting. Profile qualification must verify the generated PDF's physical size, media placement, actual-size output and color/material. QR readability applies only to a retained v1 profile. The adapter validates the exact PDF content hash and intent/profile before effect. The printer configuration's required `renderProfileHash` must equal the renderer's profile hash.

The file journal requires a private, user-owned 0700 directory and writes/fsyncs separate 0600 intent and outcome records. The Mac runtime additionally supplies native `F_FULLFSYNC` before reservation returns; a failed sync prevents dispatch. Reservation precedes dispatch. A concurrent or restarted invocation finds the same intent and reconciles its known CUPS job; it never resubmits. A timeout or lost response without a saved CUPS job ID remains UNKNOWN for operator reconciliation. Deleting an intent to retry is unsupported. A deliberate additional label-copy/reprint authorization is future hosted integration, not inferred from a retry.

### Deterministic print PDF

`@atlas/finishing/label-pdf` exports `createManualLabelPdfRenderer({layout,palette,layoutVersion})`. It defaults to v2; explicit `layoutVersion:'atlas-noir-gold-v1'` selects the preserved original generator/profile/metadata. Each mode rejects the other label version. The station derives this selection from `printer.layoutVersion`, retaining old configured profiles and saved CUPS job recovery without resubmission. It renders the same SVG design with pinned PDFKit/SVG-to-PDFKit versions and fixed metadata. V2 has vector text/layout and the exact supplied raster PNG; v1 retains vector QR modules. Its `profileHash` binds media placement, palette, renderer/font versions and, for v2, the original logo digest. The SVG root viewport is normalized from inches to points before conversion so both faces stay exactly 196.56 × 59.76 points (2.73 × 0.83 inches). PDF metadata and font behavior follow the [PDFKit documentation](https://pdfkit.org/docs/getting_started.html); conversion uses [SVG-to-PDFKit](https://github.com/alafr/SVG-to-PDFKit).

The strict `atlas-label-sheet-v1` layout supplies `widthPoints`, `heightPoints` and one or two `pages`, each with explicit `{face,x,y,rotation}` placements. Exactly one FRONT and one REVERSE are required. Placement cannot overlap or extend beyond the media; rotation is 0 or 180 degrees. No roll, die or feed arrangement is assumed. The PDF uses checked Helvetica or Times glyphs; unsupported scripts stop with `LABEL_PDF_FONT_UNSUPPORTED` instead of printing replacement characters. Multilingual font qualification remains a separate extension.

`scripts/validate-label-pdf.mjs` is an explicit local optical check. With `ATLAS_PDFTOPPM` and `ATLAS_MEASUREMENT_PYTHON` supplied, it renders an owned temporary PDF at 300 dpi and verifies exact 819 × 249-pixel geometry and an entirely black v2 reverse at both 0 and 180 degrees. The earlier v1 optical QR proof remains historical evidence; these digital checks do not establish printed-stock acceptance.

The real local transport uses `/usr/bin/lp` with an argument array, explicit local scheduler, exact allowlisted printer/media, one copy, no job sheets and actual-size scaling. Verified PDF bytes go through stdin, with no shell, arbitrary file path or inherited `CUPS_SERVER`. Status uses bounded loopback IPP Get-Job-Attributes and matches job identity/title/printer. `SPOOL_COMPLETED` means CUPS reported state 9; canceled/aborted states 7/8 are `SPOOL_FAILED`. Neither state attests to correct physical fit, readable labels, tag programming or slab assembly. Command/status semantics follow the [CUPS lp documentation](https://www.cups.org/doc/man-lp.html) and [IPP specification](https://www.cups.org/doc/spec-ipp.html).

## Paired preparation

`dispatchApprovedFinishing({plan,association,printer,nfc,now})` launches independent print and NFC adapter preparation together. Current native authorization must supply the exact physical card/approval/plan association, station ID and a bounded armed session (maximum 15 minutes). Each adapter owns its durable idempotent intent and recovery. Missing/unqualified adapters return UNAVAILABLE independently; a printer issue does not erase the grade or forge NFC completion. An uncertain effect remains UNKNOWN.

The dispatcher accepts printer spool states and explicit NFC station states, including retained results on exact retries. `NFC_COMPLETE` requires separate readback, lock, observed removal and verified hosted acknowledgement facts; assembly remains `NOT_RECORDED`. The [Mac NFC station core](MAC_NFC_STATION.md) is now composed by `packages/atlas-finishing-station` with the separate Swift/C native companion, protected station signer, signed hosted authorization and receipt relay. The browser acknowledges completion only after both hosted WRITE and REMOVAL receipts have been verified. The diagnostic writer remains an isolated fixed-URI program.

## Remaining physical integration

- Actual printer/model, media stock and feed arrangement; reviewed profile/PDF scale, fitting and color acceptance (plus QR only for legacy v1).
- Installation/code signing and qualification of the implemented Mac bridge on the actual station. Its fixed loopback API requires one-use pairing and a memory-only credential, and admits hosted signed plans rather than arbitrary print data.
- Same-lot F8215 identification and permanent-lock documentation/evidence, including a real hardware overwrite rejection after re-presentation. No NTAG215 addresses or guessed masks are adopted.
- Operator-run protected Mac key provisioning and enrollment, host signing key/trust-list deployment and additive station persistence/grants. The source paths exist; no real key, enrollment or activation was created during development. See [MAC_NFC.md](../../docs/atlas/MAC_NFC.md).
- Physical issuer/label-copy policy if ATLAS intends an issued certificate beyond the existing approved-report reference.

Tests cover exact version/hash/award binding, displayed name/variant and escaping, simultaneous preparation, absent capabilities, card association/expiry, durable CUPS restart/unknown behavior, document/profile conflicts, IPP result distinctions and exact non-shell command arguments. Component tests cover honest print-dialog state, popup failure and stale-SVG/card switching. These are software checks with injected printer/device effects, not hardware or throughput acceptance.
