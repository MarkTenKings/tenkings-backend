# Device-independent ATLAS intake

Implementation candidate, September 25, 2026. Deployment and measured production
capacity require the release coordinator's separate evidence.

The device captures and sends the full-resolution Front and Back originals.
Once both show **verified**, the server owns preparation and grading; closing
the browser or signing out does not cancel that server work. A photo still
**saved for upload** exists only on that device until its upload is verified.
Keep that device's saved site data until pending uploads finish or an explicit
workspace deletion has been acknowledged.

| Shown state | Meaning and next action |
| --- | --- |
| Saved for upload / Waiting for original upload | The server has not verified that side. Keep or reopen the capturing device, reconnect and resume its saved upload. Another device cannot send bytes it does not have. |
| Uploading originals / Verifying original | A transfer or exact-byte server check is in progress. A timeout or HTTP error is reconciled against the same upload before another conditional PUT. |
| Front/Back verified · Preparation queued / Preparing | The original is retained on the server. Preparation continues without the originating browser. |
| Exact-side processing delayed; retrying automatically | A storage, network or database outage delayed that stage. The server retains the original and keeps retrying with bounded delays, including after a restart. No re-upload is required for a verified original. |
| Exact-side preparation attention | Open that card. The safe error code identifies the affected side and stage. Unsupported format/size needs a suitable new photo; retained originals are not deleted. |
| ATLAS preparing / grading / preparing report | The durable pair has entered server processing. Each card advances independently. |
| Check edges / card details | Correct the actual photo/identity evidence. Repeating an unchanged review gate is not a recovery action. |
| Ready for human review | A trained human must review and approve the exact final report. Machine processing never certifies its own report. |

**Resume saved uploads** works at the saved side/upload level, reusing its card
creation ID, upload plan and original checksum. A lost create, PUT or verification
reply never calls for making a replacement card. Sign in again if current staff
access is required, then resume. Device-local capture remains available while
network admission is paused. The server can discover uploaded originals even
when the browser never received the verification response.

**Delete** and **Delete all** use the server receipt and tombstones. Uploads pause
while that outcome is uncertain. Local originals are removed only after matching
server acknowledgement; stale device or producer replay cannot recreate the
retired card. Original server evidence and prior accounting remain retained.

Upload diagnostics include fixed phase/code, time, safe HTTP status and an opaque
request reference when available. A storage PUT HTTP status is labeled separately
from an authenticated API status. Exported diagnostics exclude image bytes,
filenames, signed URLs, cookies, credentials and raw exception messages.

## Future tethered-camera producers

The current library route accepts explicitly reviewed Front/Back file pairs on
the Mac. The producer-neutral programmatic boundary is
`createBatchImporter(...).appendProducerPairs({producerId,pairs})` in
`frontend/atlas-app/lib/batch-import.mjs`:

```js
await importer.appendProducerPairs({
  producerId: 'mac-camera-station-1',
  pairs: [{
    pairId: retainedPairUuid,
    files: { FRONT: originalFrontFile, BACK: originalBackFile },
    label: 'Card',
  }],
});
```

The producer must persist its own station ID and pair UUID before transmission,
and explicitly associate both sides with the same physical card. Retrying the
same producer/pair derives the same card-create and admission IDs. Different
bytes under an existing pair are refused. Do not rename files to encode authority
or generate a new pair UUID merely because a response was interrupted.

The boundary preserves native bytes and accepts up to 100 explicit pairs per
call, with bounded parallel transfers. That request bound is not concurrent
grading capacity. The selected decoder's current bounds are 64 MiB per original
and 52 million pixels; supported JPEG, PNG, WebP and qualified HEIC/HEIF are
distinct from camera RAW, which is not currently decoded. A camera SDK, tether
control and physical capture acceptance have not been selected or implemented
by this contract. No throughput figure here substitutes for measured upload,
native preparation, provider and final-review evidence.
