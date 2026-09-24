# ATLAS iPhone intake and submission follow-up — September 24, 2026

Status: private runtime, six release controls and public promotion are live. Signed private TLS checks passed 3/3, canonical read-only checks passed 31/31, and final post-promotion preservation passed at 20:16:55 UTC. This follow-up is ATLAS only.

## Owner changes

The service comparison uses the exact title “Two Speeds. Same Finish.”, one desktop line and two mobile lines. Super Fast / Fast appear above uncropped 16:9 films. Warm cream and mineral cards show equally prominent price/turnaround, Authorized Dealer identity, concise service journeys and larger details. Initial service selection hides the progress tracker. The station finder uses the owner-requested expanded heading, applies actual ZIP/city/nearby selection, distinguishes errors from empty results and ignores stale replies.

The owner confirmed CenterCourt Cards in Roseville as the dealer to list. Existing approved public contact data at 307 Lincoln St, Roseville, CA 95678 is shown separately from operational kiosks, with station setup pending. No pickup schedule, terminal/printer assignment, coordinates, authorization expiry or operational readiness was fabricated. Address verification: [official dealer website](https://www.centercourtcardsroseville.com/) and [Roseville Chamber listing](https://business.rosevillechamber.com/directory/Details/centercourt-cards-4884910).

Rapid capture keeps one continuous camera and local-first Front→Back→next-card admission. Front/Back instructions are larger and the label pulses for 300 ms; reduced-motion settings disable the pulse.

## Actual incident

The owner captured approximately 9–10 cards on an iPhone. The production read at 19:32:34 UTC identifies 9 intake records created at 19:10:32–19:13:32 UTC. Eight created successfully with HTTP 200, but no subsequent per-card intake GET or upload plan was observed. One uploaded two checksum-verified originals; preparation rejected both as `PHOTO_HDR_UNSUPPORTED`, with four 422 responses across the initial attempt and the owner's existing retry. All nine remained before batch enqueue: zero corresponding batch, identification, geometry or analysis rows. The private service was running without a restart or OOM. This evidence identifies failures before the grading queue, rather than stalled grading workers.

The retained pair uses 4032×3024 Apple JPEG SDR primary images with HDR gain maps, reordered auxiliary metadata plus L008 native/stored-format fields, EXIF orientation 6 and explicit EXIF sRGB with no ICC. The fix accepts only the qualified closed metadata shape and explicitly declared sRGB. It retains the complete original and gain-map bytes, applies the exact orientation to produce 3024×4032 pixels, and does not apply the gain map, resize, re-encode the original or guess an absent color space. Provenance identifies this path as `atlas-jpeg-apple-exif-srgb-base-v1`; existing ICC/P3 and HEIC restrictions remain.

All 117 targeted local tests passed. Both actual retained originals passed an isolated candidate-source check using the qualified Linux native dependencies: decoded and working RGB pixels exactly matched an independently decoded and integer-oriented primary JPEG. That check did not overwrite serving code or commit prepared sources. It made zero database/storage writes or model requests and returned no original pixels.

The eight pre-upload failures are not yet attributed to a specific iPhone exception. The observed boundary leaves local Blob reads, hashing, batch journal persistence or intake journal reads as possible stages. No iPhone journal was inspected, no device data was cleared, and no recovery or grading retry was performed during this investigation. The confirmed JPEG fix applies to the one uploaded pair; it does not prove that the other eight failures are fixed.

Staff intake now records bounded per-card phase/exception diagnostics and displays actionable errors. A diagnostic download excludes photographs, filenames, labels, hash values, raw exception messages and session credentials. Original files and exact create/card/enqueue IDs remain preserved in the journal for Resume. A real IndexedDB/client fixture exercises the complete create→hash→journal→plan→upload→prepare→enqueue bridge: eight pairs, sixteen upload plans/puts and eight queue admissions passed, while injected Blob-read and journal-read failures resumed with the same operation IDs. Desktop browser results do not establish the remaining iPhone cause. Prior synthetic capture-speed evidence is not successful real-phone grading acceptance.

## Native qualification and deployed identities

The new private image is `sha256:532cfa57c6f86404db62a378094fa4d7af9fada38877ff649fe8dbc4a6ec252a`, built from native source `47cb501adfd609ff3ba863851b65580f0868ab53` with source-manifest SHA `e4b1ea898f384a7b10f9d4c4a1badd4e3631fde9a3162433aaf6f853987b9f2e`. Final web source is `9c06c2b8648717a9b8efc3caeacf96435ef299a2`. The source difference is one existing VM test fixture and the session log; application bytes are identical. Native image labels retain the truthful `47cb501a…` source.

The exact image passed all 24 selected test files for photo core/runtime/storage, manual intake and affected connected guards. The main isolated run reported 303 passes, zero failures and one Python-dependent skip. That one native CPU case then passed separately using `/opt/atlas-python/bin/python`: 304 distinct tests passed in total. The supplemental receipt explicitly records a corrected receipt-only TAP-index assertion; its completed test was not rerun. Both runs had network disabled, no production credentials, a read-only root with temporary storage, zero database/storage/model effects and an unchanged serving predecessor.

| Component | Final source-bound deployment |
| --- | --- |
| Staff | `dpl_GHgM5PM4zjBeBs4RcktHMFmgw5oh` / `atlas-grading-staff-ecrgkwdn5-ten-kings.vercel.app` |
| Customer | `dpl_4QQTx1csp4foMUATLCb6pphFBras` / `atlas-grading-customer-g9d9gnm09-ten-kings.vercel.app` |
| Public router | `dpl_BSBEnKxqbALGZmpn3vfMziXiguS2` / `atlas-grading-public-1dnw1tsd5-ten-kings.vercel.app` |

The private replacement container is `49bd38bf10b3a9f81bb14c902272b846133300f5c300f51b86b941d82d46b71d`, started at 20:14:38 UTC. The guarded cutover receipt at 20:14:45 UTC reports running, no OOM/restart, unchanged Caddy and unrelated containers, and the stopped predecessor retained. Private environment SHA is `14fffcd2980b1a0a4bd8ad93c73e72b6c27e72f1e18ff4b8c01619e70e12d86e`; only the staff deployment/source and customer binding values changed. The existing replacement customer service key and all other secrets were preserved.

The cold constructor proof passed in the exact image with two fake database clients constructed/closed and zero database calls, provider calls or worker starts. The single atomic six-control CAS passed: Staff 28→29, STAFF SMS 26→27, PublicReader 6→7, Customer 8→9, CUSTOMER SMS 6→7 and the existing CustomerServiceControl binding update. No new service control was inserted. Staff config hash correctly changed from `38b217c5…` to `d6e7e2fa…` because its hash includes deployment and release source; customer/public policy hashes remained unchanged. The control readback preserved hidden SMS policy fingerprints, grading/intake/research history, customer physical rows, schema catalogs, roles and grants.

Three signed private reads passed over verified TLS 1.3: staff without a session returned 401 `SIGN_IN_REQUIRED`; an unknown public report returned an empty 404; the existing customer service key read the directory with HTTP 200 and zero operational locations. All responses carried no-store/nosniff. No real session, customer upload, model call, approval, payment or SMS action was used.

After public promotion, canonical read-only verification passed 31/31. It checked the actual account/submission/staff shells and current bundle markers, protected anonymous API denials, unknown report 404s, camera/media policy and exact hashes of all four media assets. The normal initial directory and Use My Location view show CenterCourt as a nonselectable setup-pending contact with zero operational kiosks. ZIP `95678` and city `Roseville` match its address text; the ZIP query is a string match, not a radius search. The synthetic no-match search omitted the contact. Geolocation cannot compute its distance without verified coordinates. These were raw anonymous GET checks; they did not run a live customer session or grade a card. [Canonical, private TLS and independent helper-review receipts](../../../../validation/atlas-iphone-followup-20260924/customer/manifest.json) retain the precise scope.

The final post-promotion readback at 20:16:55 UTC passed against the fresh pre-control baseline, which already included the owner's nine captures. It permitted only the six explicit control deltas and found no other history, customer physical-row, authorization policy, catalog, role or privilege drift. No production verification writes or provider effects were performed.

## Release boundary

The fresh isolated image contains the three changed runtime modules. The 16 qualified native artifacts, CPU geometry, package/lock bytes and all 52 staff migrations remain unchanged. No migration or role provisioning was replayed. The release preserves customer intake/identification while commerce, dealer operations and physical station remain disabled. Existing credentials and authorization policy remain intact; changed binding revisions expire existing sessions normally. Recovery of device-only photographs requires the original iPhone browser data; no server-only operation can upload those eight pairs. Successful grading of the owner's nine cards remains a separate acceptance step.

## Evidence custody

Protected incident evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-rapid-capture-20260924/incident-grading-20260924`. Follow-up evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-followup-20260924`. Host release root: `/opt/atlas/iphone-followup-47cb501adfd6`. Paths below are relative to the follow-up evidence root unless stated otherwise.

| Safe evidence | SHA-256 |
| --- | --- |
| `evidence/backend-incident.json` | `236c6deebe3e7822fcd6184874ac47c9da8942574899f67bde2648bcf560c907` |
| `evidence/native-qualification.json` | `8a6eec0f744078064d28f10cf728acb731818fe9ff3c767ac98c0cc0c153e429` |
| `native/qualification/result.json` | `ce16d8cb01483671257c00bdae5d39f9c3fb183e0eb42410def236d3a4fc45cd` |
| `native/qualification/native-cpu-result.json` | `7b740ff90e43307a615176864d00e8e551d88ab265797029b9b70fd0aa43fd82` |
| `evidence/runtime-observed.json` | `6138bb8c61b1272ec590d5b1703a1abffc9f575e7e702cdfd04d90f347c45702` |
| `readonly-customer/signed-private-9c06-1/result.json` | `912f3c81e90ccfb8cc0e1158bc2c6c0426f473d7b9b08cdb9ee9352e5fcec31e` |

The [sanitized backend evidence manifest](../../../../validation/atlas-iphone-followup-20260924/backend/manifest.json) lists the repository copies of the incident, native qualification and observed runtime summaries. [Runtime control evidence](../../../../validation/atlas-iphone-followup-20260924/runtime/controls-result.json) records the applied revisions. The incident summary excludes card/upload IDs and original pixel hashes. It points to protected original receipts without copying photographs, raw request logs, private environment files or credentials into the repository. All completed mutation intents are consumed; future recovery or release work requires fresh evidence and its own scoped action.
