# David Njoku Workspace test and photograph recovery

## Observed result

The owner's new Workspace test entered the existing human review successfully. David Njoku's saved action history contains `BEGIN_FINAL_REVIEW`, followed by the owner's geometry edit and confirmation. The original batch report contains zero findings, zero proposals and zero unmeasurable proposals; the current saved defects and final review also contain none. The `03` beside Findings in the screenshot is the step number. No three findings were lost for this card. These records do not establish that the physical card is flawless or approved.

The photograph failure is real and was reproduced during read-only inspection. The saved Front and Back images initially loaded. After remaining on Back for several minutes and returning to Front, the marked pane showed “Photograph unavailable,” the clean pane kept saying “Verifying photograph,” and the existing alert said the saved photograph could not be verified. There were no captured browser console warnings/errors. The explicit **Retry photograph** failed again. The existing **Review options → Reload images** read restored both Front panes and ordinary controls. No geometry, finding, approval, analysis or grading command was invoked by the agent.

The initial owner screenshot also has a generic saved-request error, which was not reproduced during this later failure. The generic message does not prove a pending grading mutation. The exact failing network status/code was not captured; neither deployment logs nor native logs returned matching records for the original 05:17–05:24 UTC window. Do not claim a confirmed network cause or production fix.

## Retained production evidence

Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-workspace-njoku-20261021`. Summary `investigation-evidence.json` SHA256 `478dbefd91fbd9b908d085a7564cd40a72ecaa211945d5da68c9651bff4c654b` pins all 27 retained files, including read scripts, raw snapshots, exact object reads and browser evidence. Directories are private; production records are not committed here.

Card `2fde7d4b-7ca2-4572-a11d-7473d4407c80` is David Njoku, 2025 Panini Select #455 Pink Sparkle Prizm. It remains revision4/hash `0259242a8b79a41411157a0f985e68b79f3ee594e2f44c493e54f1bb7239867a`, with no approval. Exact actions:

| UTC time, October22 | Action | Result revision |
| --- | --- | --- |
| 05:18:41.241 | BEGIN_FINAL_REVIEW | 2 |
| 05:21:15.995 | GEOMETRY_EDIT, Back printed border | 3 |
| 05:21:17.494 | CONFIRM_GEOMETRY | 4 |

Three bounded repeatable-read **READ ONLY** snapshots at05:44:06.362,05:51:52.700 and05:54:28.513 UTC preserve the entire card, batch, action and approval rows exactly. Only observation metadata differs. SHA256 values are respectively `18d1821fdc6cfb7a8ec8d81783f2693f98a3fa046c09811114afb5d7508b93aa`, `850f20e5955bdb007249e5e19ec20015b9ed940593abcf1602e768a4a88a59d6` and `f3880e7052ccec7738f5caceb0cc2dbad3b39d2b040c7f632d5443b5a8ddba68`. Transactions rolled back and clients closed. The second snapshot follows initial inspection; the third follows the failed retry and successful photo-link reload.

Four immutable object GETs verified expected key, metadata, byte count and hash: original batch report `0feb10a4…`, current defects `69b83973…`, geometry `ae2fb996…`, final review `7229079e…`. The evidence summary pins full hashes and receipt. The one saved analysis RESPONSE is READY and has no recorded refusal; no new analysis was requested. Current approved derivatives observed in the browser are1350×1858, not raw masters.

`browser-01/front-final.png` and `.txt` record the later **failure**, despite their original filename. `after-reload-images.png` and `.txt` record recovery through the existing read control. Earlier `front` and `back` files record initial successful reads. Root inspected the recovered screenshot. The user's Review Queue tab and completed Nick Kurtz review were not changed.

## Narrow follow-up

Two source defects are confirmed independently of the network cause: the clean pane ignores terminal load failure, and image-refresh GET errors use generic saved-command wording. The existing explicit Retry photograph retries its current descriptor, while Reload images obtains a refreshed one. A narrowly scoped local follow-up will make failure displays agree, use photo-read wording and renew descriptors through that existing read before an explicit retry. Source/hash/auth checks, pending-command safeguards and approval readiness must remain intact. No automatic retry loop, grading rule, workflow step, inference or historical data change is authorized by this diagnosis.

Source inspection also finds a possible expiry window: five-minute signed grants may be returned from a four-minute cache, the browser refresh timer starts at mount, and unused verified photos can leave the shared pool after one minute. This is a hypothesis for the observed failure until qualified; the recovery observation does not identify the original network error. No backend TTL change has been made.

## Owner acceptance recorded

The owner reports the normal Review Queue still works, and **Graded Cards plus optional3D work on the physical phone**. The raw image appears first and the slab about one second later. This is positive owner/device acceptance, not an instrumented latency measurement or evidence of calibrated slab geometry, full-resolution masters or all-device performance. The Workspace photograph failure remains a separate open issue. Marketplace navigation still depends on the actual R2 public listing experience.
