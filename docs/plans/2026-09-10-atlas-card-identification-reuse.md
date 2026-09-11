# Reuse the photo identification flow in ATLAS

September 10, 2026. Read-only investigation requested after the inventory Front/Back → OCR → Astra flow succeeded. The owner is deciding whether the ATLAS destination is staff intake, customer submission, or both. This note proposes integration; it does not implement or activate ATLAS changes.

## Source inspected

- Inventory: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`, source `aeae3e87f266d0e521d333abcf5eb30c971e24e7`. Inventory intake fixes may continue in this checkout.
- Current ATLAS: `/Users/markthomas/.codex/worktrees/d221/ten-kings-mystery-packs-clean`, clean source `bec177c8f4f3001abc07f52c650f86069d609830`. Its release implementation is `dff540c4782856e393f5db8470a647a7c35c6b6f`; the later commit records release evidence.
- `docs/atlas/WEBSITE_RELEASE.md:3` in that ATLAS checkout records the deployed recovery/workspace release and explicitly leaves authenticated card recovery and final human-review acceptance pending. This investigation did not independently inspect production.

The collect/inventory checkout intentionally preserves its older application lineage. Do not merge current ATLAS/main into it to obtain these files. Implement a future ATLAS change in the current ATLAS source lineage after coordinating with its lead.

## How the successful inventory flow works

1. `frontend/nextjs-app/components/admin/StaffInventoryCardCapture.tsx:159` obtains one rear-camera stream. The interface takes Front and Back in sequence, retaining the stream for the next card while mounted. A file-library alternative supports HEIC/HEIF. Capture and browser preparation produce a descriptive JPEG bounded to a 1,400-pixel long edge; this is an inventory convenience image.
2. `components/admin/StaffInventoryWorkspace.tsx:275` prepares and uploads the two sides concurrently. `pages/api/v2/admin/inventory/photo.ts:14` independently decodes, rotates, bounds and strips metadata, then stores a private JPEG under an exact UUID/SHA-256 key. The uploaded bytes are verified before the key is accepted.
3. `pages/api/v2/admin/inventory/identify.ts:21` authenticates the existing human inventory-admin session first. It accepts only two exact managed photo keys, not URLs. The request body is limited to 2 KB, query parameters are rejected, and responses are private/no-store.
4. `lib/server/staffInventoryIdentification.ts:75` checks storage metadata and reads each exact object with a byte limit. It hashes the bytes actually read, checks the key's checksum and verifies the JPEG bounds. Different sides must have different hashes. The providers receive image bytes, not private storage keys or signed URLs.
5. `lib/server/staffInventoryIdentification.ts:155` sends both sides concurrently to Google Vision `DOCUMENT_TEXT_DETECTION`, using the existing server `GOOGLE_VISION_API_KEY`. OCR is limited to 6,000 characters per side and retained only as supporting input for this request.
6. `lib/server/staffInventoryIdentification.ts:222` makes one Responses request with both photographs plus the bounded OCR text, using the existing server `OPENAI_API_KEY`. Its explicit settings are:

   ```json
   {
     "model": "gpt-6-astra",
     "reasoning": { "effort": "low" },
     "store": false,
     "max_output_tokens": 2400,
     "text": {
       "verbosity": "low",
       "format": {
         "type": "json_schema",
         "name": "staff_inventory_card_details",
         "strict": true
       }
     }
   }
   ```

   Each side is an `input_image` with `detail: "high"`. The actual request includes the complete closed JSON schema. There are no model tools, automatic retries or substitute models.
7. The result contains exactly eight suggestions: name, category, manufacturer, card number, year, set, variant and card type. Each is `{value, confidence, evidence}`. A missing or uncertain value can remain null. The prompt says photographs are primary evidence, OCR is supporting evidence, and both are untrusted data. Embedded instructions are ignored. It preserves leading zeros and card-number denominators; does not convert copyright into a guessed release year; permits a variant only when its name is explicitly printed; and forbids cost, price, location, ownership and grading output. Full prompt: `lib/server/staffInventoryIdentification.ts:226`.
8. The server validates exact model/completion, every field, lengths, category and nullable confidence/evidence consistency. It rejects malformed, refused, incomplete or unsafe output. `lib/staffInventoryIdentification.ts:46` independently validates the complete browser response and binds its provenance to the current exact photo pair. `components/admin/StaffInventoryWorkspace.tsx:252` fills only high/medium suggestions into fields the human has not edited. A new photo pair clears prior machine-owned values; late or cancelled responses cannot overwrite a newer draft.

String bounds are name/manufacturer/set/variant/type 160 characters, category/card number 80, year 20 and evidence 240. Provenance returns exact photo hashes, model, effort, elapsed time and per-side OCR status. Raw provider responses and full OCR text are not returned to the browser.

The limits are six seconds for storage, eight seconds for each concurrent OCR request, 25 seconds for Astra and 40 seconds overall; provider bodies are bounded to 256 KiB. Cancellation aborts active work. An OCR failure can still yield photo-based suggestions with a visible warning. Model failure returns a sanitized error and leaves the draft usable. The identification endpoint does not write inventory, financial, catalog or grading records.

Observed proof: focused identification and staff API regressions passed 27/27; scoped lint passed. A controlled real-provider test with generated Front/Back images, in-memory fixture storage and no production writes completed in 7,207 ms. Both Google sides read successfully and exact Astra/low returned all eight printed synthetic fields, including `007`. This is one synthetic request, not a natural-card accuracy or phone latency guarantee. Retained sanitized evidence: `/private/tmp/staff-identification-provider-smoke.log`; reproducible manual test: `frontend/nextjs-app/tests/staffInventoryIdentification.provider-smoke.ts`.

## Existing ATLAS insertion points

All paths below refer to the current ATLAS checkout, not the inventory checkout.

**Staff:** `/admin/add-cards` uses `frontend/atlas-app/components/PhotoIntake.jsx`. It already stores staff-scoped recoverable drafts, uploads Front/Back directly to private storage, verifies exact bytes, requires an explicit same-physical-card confirmation and queues with retained operation IDs. `PhotoIntake.jsx:12` begins with `identity: {}`; details are optional and can wait for grading (`:150`). Uploading or queuing does not dispatch paid work. Existing HTTP authentication, same-origin and CSRF enforcement are in `frontend/atlas-app/lib/server/http.mjs:55`.

`frontend/atlas-app/lib/server/access/workspace-intake.mjs:198` resolves photo ownership under the current staff session, reads only the saved exact object, then rechecks capture/card revision and claim fence. `workspace-intake-storage.mjs:12` provides bounded stream/SHA verification. These are the photo-authority ports to adapt; the ATLAS browser must not call the collect inventory endpoint or choose raw storage keys.

**Customer:** `/account/submit` uses `frontend/atlas-customer/components/AccountWorkspace.jsx:155`. Current rows contain a typed title and SPORTS/POKEMON category; there is no customer photo picker or upload endpoint. `frontend/atlas-customer/lib/server/policy.mjs:57` accepts exactly those two fields per card. A customer destination therefore needs its own session/CSRF-protected upload ownership and request-recovery path, not a link to staff evidence. Customer suggestions would remain submitted descriptions until ATLAS confirms physical intake.

**Grading:** `packages/atlas-operator/src/capture-protocol.mjs:12` already exposes `read_original_photos`, `inspect_region` and `propose_capture_identity`. Proposals are bound to run, evidence hash, manifest and revision, and reference actually delivered image assets. They carry MACHINE provenance and cannot certify or publish a grade. The established grading operator uses exact Astra with a reviewed policy; the current release record specifies **max** effort and 8,000 output tokens (`docs/atlas/WEBSITE_RELEASE.md:13`). Inventory's low-effort helper must not silently change that operator configuration.

## Narrow reuse proposal

Reuse the bounded provider-call orchestration, eight-field schema, conservative printed-evidence prompt, sanitized errors and browser stale-result/edit protection. Separate those from inventory-specific auth and JPEG-key assumptions. Resolve ATLAS images through its own authorized capture records and dedicated provider/budget configuration.

Preserve ATLAS grading sources. `frontend/atlas-app/lib/workspace-client.mjs:82` leaves JPEG/PNG/WebP original bytes unchanged and retains HEIC import provenance. `heic-import.worker.mjs:26` converts supported HEIC into a full-size, color-preserving lossless PNG without resizing. The existing `packages/atlas-service-bridge/src/operator-images.mjs:35` can derive bounded model images while recording source hash and transform. A smaller identification delivery must remain a derived image, never replace grading originals with the inventory JPEG.

Two staff placements are possible once the owner selects the intended experience:

- An optional fast identity preview after verified upload, shown in the intake draft. This needs a distinct bounded spending/admission path and a category proposal/adoption step. It must remain nonblocking for photo queueing and preserve an explicit human category when supplied.
- OCR support inside the already-authorized Start Astra capture-review run, with suggestions recorded through the existing proposal mechanism. This preserves grading's configured max effort and immutable policy/receipt machinery. Do not add an unaccounted extra request or let queueing itself dispatch model work.

The category transition needs explicit implementation in either case. Current intake allows `{}`, but `captureManifestSchema` requires category SPORTS or POKEMON (`capture-protocol.mjs:44`). `enqueueCaptureOperatorRunInTransaction` passes saved identity unchanged (`packages/atlas-operator/src/ledger.mjs:107`). The existing proposal field list cannot propose category (`capture-protocol.mjs:17`) and its prompt treats supplied category as authoritative (`:34`). Unknown category therefore cannot simply be solved by adding OCR text to that prompt. Preserve human decisions; represent machine category suggestions explicitly before using them to choose category-specific identity rules.

Field mapping is deliberate, not a direct object spread:

| Inventory suggestion | ATLAS candidate | Constraint |
| --- | --- | --- |
| Sports cards / Pokémon | SPORTS / POKEMON | Other trading cards has no existing ATLAS category; keep unresolved. |
| name | playerName / cardName | Depends on accepted category. |
| card_number | cardNumber | ATLAS draft limit is 40; reject excessive length rather than truncate. |
| year / set_name | year / productSet | Preserve unknowns and existing category-aware validation. |
| manufacturer | manufacturer | Existing Pokémon capture proposal does not allow this field. |
| variant | parallel or insert | Do not infer which meaning from a generic variant string. |
| card_type | No direct equivalent | Do not turn it automatically into Pokémon layoutType or grading authority. |

Any paid ATLAS addition must use its dedicated project and current admission/accounting path. `packages/atlas-operator/src/ledger.mjs:445` reserves before dispatch and retains uncertain liabilities; `responses.mjs:122` freezes request settings and validates returned model/tier. Preserve exact operation recovery, cancellation, role boundaries, expiry and remaining budget. A pure inventory-style route with no durable paid-request accounting is not a drop-in ATLAS operator.

Acceptance should cover unknown category, an explicitly conflicting human category, Sports/Pokémon field compatibility, original/derived image hashes, unsupported categories, retakes and late replies, manual edits during recognition, failure without lost photos, cross-customer/staff access denial, same-operation recovery, and preserved grading/report approval authority. Use synthetic fixtures first. No provider call, ATLAS source edit, schema change, production write, merge, commit or deployment occurred during this investigation.
