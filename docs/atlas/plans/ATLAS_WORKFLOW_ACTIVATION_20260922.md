# ATLAS workflow activation notes

This is source implementation and local acceptance evidence for Mark's September 22 next-phase request. It does not record a production deployment or physical printer/NFC acceptance.

## Software boundaries

- Batch intake accepts up to 50 explicitly paired original Front/Back files. It persists originals locally before upload, uses the existing private intake verifier, and preserves individual-card recovery. Automatic enqueue starts after the verified pair is ready. CPU work and outstanding batch-provider jobs each have a shared limit of two in the native composition. Durable provider reservations survive waits and service restarts; an uncertain dispatch retains its slot until the existing provider journal proves completion or a pre-dispatch refusal. Fifty queued cards does not mean fifty simultaneous paid requests.
- Machine grading prepares geometry, identifies the card, runs the configured Astra analysis and measures proposals into a separate machine report. It cannot certify a card or publish a human correction lesson. Uncertain identities, geometry or provider outcomes require attention.
- Rapid review presents the exact provisional report, verified Front/Back images, findings and grade. One deliberate **Approve & print next** action saves the real reviewer's geometry/inspection/finding decisions, certifies through the existing approval engine and publishes that exact report before preparing the label. Each step has a retained receipt; interrupted approval resumes the same decisions. Changed photos, findings, measurements or grade refuse approval and return the card for review. The review control stays unavailable until both evidence images verify.
- `ATLAS_MANUAL_BATCH_ENABLED=true` is an explicit native-service opt-in. It requires the configured defect analysis and memory services plus the reviewed batch SQL/grants. The current worker uses real authenticated staff sessions; a service restart/session expiry requires a signed-in operator to resume. It is not a new independent service principal.
- Saved human approval loads an exact published manual V2 report and derives a deterministic label/print/NFC plan. The browser can open the print dialog from the approval click, while saved report navigation only displays the label. CUPS and NFC intentions remain separate from verified physical completion.
- `ATLAS_MANUAL_PRESENTATION_ENABLED=true` is an explicit native-service opt-in after presentation SQL/grants. Optional original slab photos use a separate upload namespace, full native verification and a separate SDR WebP display copy up to 2400 pixels. They do not replace Front/Back grading evidence. Revisions are append-only and bind to one exact public report version/hash.
- The public signed transport admits only the new exact presentation-image selector. Public report details may enrich omitted identity fields only when the original accepted details revision, source and grading identity match the immutable approval. Missing optional data leaves verified grade evidence readable.

## Inactive SQL candidates

- `packages/atlas-batch-grading/sql/proposal.sql` and `batchGrantSQL(role)`.
- `packages/atlas-connected-manual/sql/presentation-proposal.sql` and `presentationGrantSQL(role)`.

These are candidates, not applied production migrations. Numbered migration allocation reserved during implementation: presentation `20260922210000`, batch `20260922210100`. Before release, review final SQL/grants and promote through the existing ATLAS deployment runbook, recording planned and observed actions in `SESSION_LOG.md`. Do not turn flags on against schema 44 without the required additive schema.

## Label and station acceptance

Source: `packages/atlas-finishing/MANUAL_FINISHING.md`.

The two-face design is 2.73 × 0.83 inches, with a monochrome option and a versioned report QR. The visible ATLAS reference is the existing report number. It does not allocate a new physical certificate. Native automatic printing still needs the actual printer, exact stock/feed configuration, PDF scale/color/QR proof and a paired Mac station bridge. A browser print dialog is not automatic background printing or evidence of paper output.

Existing selected NFC hardware remains the MacBook, ACS ACR1552U and F8215 tags. New `@atlas/finishing/mac-nfc` and `mac-nfc-journal` exports implement an exact approved-URL station core: header-last NDEF writing, full readback, qualified-lock hooks, signed-result/verified-acknowledgement hooks, observed-removal states and one durable active intent per station. Tests inject the hardware and authority boundaries. Unknown outcomes never release the station or trigger a second write.

This is **not a deployable Mac companion yet**. The actual native exclusive PC/SC session and full-sync binding, protected signing/enrollment, paired hosted authorization/acknowledgement endpoints, native tag-presence/removal integration and same-lot F8215 permanent-lock qualification remain unimplemented or unqualified. The core refuses to operate without those capabilities. See `packages/atlas-finishing/MAC_NFC_STATION.md` for the exact remaining path. A previous diagnostic URL write is not proof of this production protocol. No local printer or reader was invoked during this build.

## Dealer directory

The public `/dealers` page uses the authorized ATLAS roster only. It supports buy/submission service filters, city/postal/name search, optional user-requested distance ordering, Google directions, and actual supplied submission program prices/turnaround/terms. Future/expired authorizations and expired programs are excluded.

The optional server setting `ATLAS_PUBLIC_DEALER_DIRECTORY_JSON` contains the strict `atlas-dealer-directory-v1` document defined in `frontend/atlas-public/lib/dealers.mjs`. It defaults to an empty directory. Do not populate it with unapproved shops, inferred Ten Kings partners or illustrative offers.

An embedded map loads only after user interaction and after both `ATLAS_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` and `ATLAS_PUBLIC_GOOGLE_MAP_ID` are configured. The browser key is intentionally public and must have production HTTP-referrer/API restrictions and the intended billing project. Map IDs and positions must be supplied; dealer locations are not discovered or declared authorized by Google. The route-specific allowlist follows the [Maps JavaScript CSP guidance](https://developers.google.com/maps/documentation/javascript/content-security-policy); live keyed map acceptance remains pending.

## Market evidence and offers

The report supports timestamped, newest-first graded eBay sales, grader filters, disclosed/undisclosed sale amounts, independently supplied estimates with methodology, and separate expiring dealer offers. It does not compute card value from the latest sale or convert a PSA grade into an ATLAS valuation. An unknown accepted-offer price must not be the listing's asking price.

The private service now supports an explicit staff search and selection flow using the existing SoldComps engine, with `ATLAS_MANUAL_MARKET_ENABLED=true` and a dedicated `ATLAS_MANUAL_SOLD_COMPS_API_KEY`. It requires presentation persistence. Each search has a durable reservation; an uncertain response is replayed/reconciled, never automatically purchased again. Staff selection reloads the exact server-retained preview, validates approval/freshness, and appends a separate public presentation revision with private source provenance. An already committed selection replays its receipt even after the preview expires. Public page views make no paid lookup. The existing provider gives verified prices only for disclosed USD sales; unsupported/undisclosed rows are excluded rather than assigned an invented amount.

Actual source access, selected comparable-card evidence, authorized dealers and commercial terms are required before these sections can show live data. Empty optional sections stay absent. No dealer has been enrolled, no buyback has been offered, and no payment or trade execution was introduced by this build.

## Local acceptance evidence

- Node 20.20.1 is the checked runtime.
- Public Next production build and private-dependency boundary check passed with `/dealers` and the presentation image route.
- Real browser desktop/mobile report and label previews passed; report photo uses an explicitly labeled retained inspection-photo fixture for layout, not a fabricated slab.
- Rapid review passed the actual Python measurement path using the pinned NumPy/OpenCV/Pillow libraries in an isolated local environment. Partially overlapping findings retained the same measurements, score arithmetic and grade before and after human confirmation. Fully duplicate findings correctly require attention rather than receiving invented measurements.
- Populated dealer browser checks used fictional fixture shops, supplied coordinates and an intercepted Maps SDK. Search/service filters, currency/terms, nearest ordering, direct-dealer focus, empty/restored map state and mobile/reduced-motion behavior passed. These establish UI behavior, not live Google billing or a real dealer relationship.
- Native photo tests verified unchanged original bytes/full working frame and a distinct 2400-pixel WebP, repeat recovery, exact public binding, stale revision refusal, corrupt bytes and authorization revocation.
- Fresh owned PostgreSQL fixtures verified batch size 50, ownership, shared concurrency, lease recovery, changed-photo rejection and durable provider slots through waits/restarts/uncertain outcomes. Separate presentation fixtures verified photo replay/access/CAS/immutable history/new-approval fencing and market reservation/selection receipts. These used disposable databases only.
- Final integrated core suite: 250/250 passed, including actual local native CPU parity, photo/public binding, market uncertainty and eight new Mac station-core tests. Staff suite: 561/561 passed. Manual workspace suite: 116/116 passed. All three suites had zero failures or skips (927 tests). Final browser/build evidence is recorded in the session log.

## Review package

The local interactive hub is saved outside Git at `/Users/markthomas/.codex/visualizations/2026/09/22/01a0c70b-0130-7d70-8d8c-610000b78a06/atlas-workflow-review`. Its `README.md` and `server-receipt.json` describe startup and the current loopback URL. It includes batch review, public report, label design/actual-size PDF, dealer-directory simulation and market selection. All commercial data is explicitly illustrative. The retained card photograph is inspection media for layout, not a finished-slab acceptance image. The hub has no live mutation, provider or device capability; its eight desktop/mobile smoke checks passed without external requests.

Physical throughput, live Maps, real sold-comps entitlement, actual printer output and NFC production write/lock are not established by local fixture tests.
