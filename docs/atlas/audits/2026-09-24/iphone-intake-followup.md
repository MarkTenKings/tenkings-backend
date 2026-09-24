# ATLAS iPhone intake and submission follow-up — September 24, 2026

Status: implementation qualified locally; deployment pending. This follow-up is ATLAS only.

## Owner changes

The service comparison uses the exact title “Two Speeds. Same Finish.”, one desktop line and two mobile lines. Super Fast / Fast appear above uncropped 16:9 films. Warm cream and mineral cards show equally prominent price/turnaround, Authorized Dealer identity, concise service journeys and larger details. Initial service selection hides the progress tracker. The station finder uses the owner-requested expanded heading, applies actual ZIP/city/nearby selection, distinguishes errors from empty results and ignores stale replies.

The owner confirmed CenterCourt Cards in Roseville as the dealer to list. Existing approved public contact data at 307 Lincoln St, Roseville, CA 95678 is shown separately from operational kiosks, with station setup pending. No pickup schedule, terminal/printer assignment, coordinates, authorization expiry or operational readiness was fabricated. Address verification: [official dealer website](https://www.centercourtcardsroseville.com/) and [Roseville Chamber listing](https://business.rosevillechamber.com/directory/Details/centercourt-cards-4884910).

Rapid capture keeps one continuous camera and local-first Front→Back→next-card admission. Front/Back instructions are larger and the label pulses for 300 ms; reduced-motion settings disable the pulse.

## Actual incident

The owner captured approximately 9–10 cards on an iPhone. Read-only production evidence identifies 9 intake records at 19:10:32–19:13:32 UTC. Eight created successfully but made no subsequent card-read/upload-plan request. One uploaded two checksum-verified originals but preparation rejected both as PHOTO_HDR_UNSUPPORTED. None reached batch enqueue or grading. Prior synthetic capture-speed evidence is not successful real-phone grading acceptance.

The retained pair uses Apple JPEG SDR primary images with HDR gain maps, reordered auxiliary metadata plus L008 fields, EXIF orientation 6 and explicit EXIF sRGB with no ICC. The fix accepts only the qualified closed metadata shape and explicitly declared sRGB; original primary/gain-map bytes remain preserved. Decoder provenance distinguishes this path from the retained P3 treatment. 117 targeted tests pass. Both actual originals passed candidate preparation with exact full-resolution orientation-correct RGB equality to independently decoded primary images; no database, storage or model writes were performed.

The eight pre-upload failures are not yet attributed to a specific iPhone exception. Staff intake now records bounded per-card phase/exception diagnostics and displays actionable errors. A diagnostic download excludes photographs, filenames, labels, hash values and session credentials. Exact create/card/enqueue IDs and original files remain available for Resume. A faithful real IndexedDB/client fixture exercises the complete create→hash→journal→plan→upload→prepare→enqueue bridge, including injected failures and recovery. Desktop browser results do not establish the remaining iPhone cause.

## Release boundary

A fresh isolated image is required for the three changed runtime modules. Native codec binaries, CPU geometry, package/lock bytes and all 52 staff migrations remain unchanged. The release preserves customer intake/identification while commerce, dealer operations and physical station remain disabled. Existing credentials and authorization policy remain intact. Recovery of device-only photographs requires the original iPhone browser data; no server-only operation can upload those eight pairs.
