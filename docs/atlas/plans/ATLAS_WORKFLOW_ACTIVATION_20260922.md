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
- `packages/atlas-connected-manual/sql/finishing-station-proposal.sql` and `finishingStationGrantSQL(role)`.

These are candidates, not applied production migrations. Numbered migration allocation reserved during implementation: presentation `20260922210000`, batch `20260922210100`, station `20260922210200`. Before release, review final SQL/grants and promote through the existing ATLAS deployment runbook, recording planned and observed actions in `SESSION_LOG.md`. Do not turn flags on against schema 44 without the required additive schema.

## Label and station acceptance

Source: `packages/atlas-finishing/MANUAL_FINISHING.md`.

The two-face design is 2.73 × 0.83 inches, with a monochrome option and a versioned report QR. The visible ATLAS reference is the existing report number. It does not allocate a new physical certificate. A deterministic vector PDF renderer now binds exact media placement, palette, renderer and font versions in its profile hash. Repeat renders produce identical bytes. Native automatic printing still needs the actual printer, exact stock/feed configuration and physical scale/color/QR acceptance. A browser print dialog is not automatic background printing or evidence of paper output.

Existing selected NFC hardware remains the MacBook, ACS ACR1552U and F8215 tags. New `@atlas/finishing/mac-nfc` and `mac-nfc-journal` exports implement an exact approved-URL station core: header-last NDEF writing, full readback, qualified-lock hooks, signed-result/verified-acknowledgement hooks, observed-removal states and one durable active intent per station. Tests inject the hardware and authority boundaries. Unknown outcomes never release the station or trigger a second write.

The follow-up source includes a separate Swift/C native companion, protected-key provisioning source, exclusive PC/SC transport and native full-sync, signed hosted enrollment/arm/receipt service, durable local bridge and browser station setup. The launcher binds only `127.0.0.1:47664`; one-use pairing links expire after two minutes, and the browser credential stays in memory. The browser relays signed messages without sharing its staff cookie with the native process. A selected ready station replaces the browser print popup; native uncertainty never silently invokes a second print path.

**Hardware activation remains pending.** The native production qualification registry is deliberately empty. No F8215 permanent-lock address or mask is inferred from NTAG documentation or supplied by a browser/configuration request. Same-lot tag identification, lock qualification and overwrite rejection after re-presentation must produce a reviewed compiled profile before production RF effects are available. Protected key creation, host key provisioning, operator enrollment/activation, code signing/distribution and actual printer qualification have not been performed on Mark's station. A previous diagnostic URL write is not proof of this production protocol. No local printer or reader was invoked during this build.

Hosted station composition is off unless `ATLAS_MANUAL_STATION_ENABLED=true`, after station SQL/grants. It requires `ATLAS_MANUAL_STATION_KEY_ID`, `ATLAS_MANUAL_STATION_PRIVATE_KEY_PEM` (P-256) and `ATLAS_MANUAL_STATION_TRUSTED_STATIONS_JSON`. The protected trust list binds the enrolled key fingerprint, protected-key evidence, activation receipt and qualified tag profile to one owning staff operator. Enrollment alone cannot activate a station. Shared-operator station transfer is outside this initial owner model.

The hosted trust entry's strict `profile` shape is `{id,qualified:true,qualificationHash,firstUserPage,lastUserPage}`; `qualificationHash` equals the entry's `qualificationReceiptHash`. The host derives `profileHash`. The native configuration instead includes that derived `profileHash` and omits the `qualified` boolean. These distinct shapes must not be copied verbatim between configurations. `allowedStaffIds` currently contains exactly one owning staff UUID.

Arms last at most 15 minutes and reserve one station/card/approval intent durably. Expiry does not release an unknown operation. Only previously signed receipts and exact committed host acknowledgements may be replayed after expiry; no new RF observation, write, lock or station signature is permitted. Missing evidence requires explicit reconciliation. Details and acceptance commands are in `packages/atlas-finishing/MAC_NFC_STATION.md` and `packages/atlas-finishing-station/README.md`.

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
- Foundation checkpoint before the concrete Mac bridge: core 250/250, staff 561/561 and manual workspace 116/116 passed, all with zero failures or skips. This included actual local native CPU parity, photo/public binding, market uncertainty and eight injected Mac station-core tests.
- Follow-up native/hosted integration: actual Node-to-Swift signed-message interoperation, native protocol fixtures, simulated exclusive PC/SC transport and real temporary-file full-sync/deadline checks passed 72 scenarios. No reader, tag, printer or Keychain operation was used. A fresh owned PostgreSQL fixture passed eight station lifecycle/access/immutable-history groups and verified its cleanup. Later integrated suite/build counts are recorded in the final session-log entry.
- Frozen final source: core 281/281 and staff 566/566 pass without failures or skips. Staff production build/boundary passes 30 browser chunks, 14 server traces and 2702 traced files; public passes 13/10/704 with no staff or write routes. The station's eight browser checks pass desktop/mobile/reduced-motion and no external effects. Independent hosted/native/bridge review found no remaining actionable interoperability issue.
- Physical PDF proof passed repeat-byte/hash checks, exact page geometry and 300-dpi optical decoding of the exact report URL at both 0 and 180 degrees. This does not qualify real ink, adhesive, stock, feed or printer output. The checked standard PDF font currently rejects unsupported scripts; those identities need a separately qualified multilingual font/layout extension.

## Review package

The local interactive hub is saved outside Git at `/Users/markthomas/.codex/visualizations/2026/09/22/01a0c70b-0130-7d70-8d8c-610000b78a06/atlas-workflow-review`. Its `README.md` and `server-receipt.json` describe startup and the current loopback URL. It includes batch review, public report, label design/actual-size vector PDF, dealer-directory simulation, market selection and a sixth finishing-station setup tab. All commercial data is explicitly illustrative. The retained card photograph is inspection media for layout, not a finished-slab acceptance image. The hub has no live mutation, provider or device capability; both its original eight desktop/mobile smoke checks and eight new station checks passed without external requests.

Physical throughput, live Maps, real sold-comps entitlement, actual printer output and NFC production write/lock are not established by local fixture tests.
