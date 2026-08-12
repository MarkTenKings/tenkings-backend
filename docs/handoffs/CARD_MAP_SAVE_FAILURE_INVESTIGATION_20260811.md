# Card Map Production Save-Failure Investigation — 2026-08-11

## Scope and safety

This lane performed read-only inspection of the deployed application, Vercel request metadata/logs, the Production schema/migration ledger, and exact Card Map/session records. It did not deploy, migrate, alter Card Map rows, change a session, or touch grading/model/image/threshold authority. The live browser tab was not refreshed, navigated, or asked to save again.

### Process violation and containment

One stateful tooling mistake occurred during Vercel access setup and violated this lane's read-only assignment: `vercel link --project tenkings-backend-nextjs --yes` created a new empty project because the real project name is `tenkings-backend-nextjs-app`.

The contemporaneous CLI evidence was:

- mistaken project ID: `prj_qDYUzzRaBx6cc11CvHbJ5Qtc2su4`;
- mistaken project name: `tenkings-backend-nextjs`;
- CLI-reported creation time: `11 August 2026 19:25:14`;
- root directory: `.`;
- framework: `Other`;
- default build/output/install settings only;
- project listing showed Latest Production URL `--` for the mistaken project;
- `vercel env ls production` returned `No Environment Variables found for ten-kings/tenkings-backend-nextjs`;
- removal confirmation: `Success! Project tenkings-backend-nextjs removed`.

The same project listing separately showed the real project as `tenkings-backend-nextjs-app` with Latest Production URL `https://collect.tenkings.co` and an existing update age of seven hours. Subsequent inspection of the real project returned the pre-existing READY deployment and Git SHA recorded below. No deploy, environment add/remove, domain change, project setting change, or database/storage mutation was issued against `tenkings-backend-nextjs-app`. All stateful external commands stopped after containment.

Repository/worktree identity was verified before investigation:

- repository: `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`
- clean investigation worktree: `/Users/markthomas/tenkings/.codex-worktrees/card-map-save-investigation-20260811`
- branch: `codex/card-map-save-investigation-20260811`
- base/HEAD/origin main at investigation start: `610192cc0a987aeb05849d58bcbd725e82933373`

## Executive finding

Mark's work is recovered. Production retained the complete Front and Back authored Card Map, including both printed boundaries, all eight stable anchor IDs/labels/points, all twelve zone IDs/labels/types, every polygon vertex in order, the exact source identity, image storage provenance, image SHA-256 values, and physical-card quad hashes. The four failed retries contain byte-for-byte identical Front/Back JSON.

The displayed save failure was not a rollback. Each of four `409` responses followed a committed immutable FAMILY revision. The current implementation computes the revision hash before insert, writes the revision, advances the current pointer, and binds the CAPTURED source session inside a transaction. It then performs hash validation only **after that transaction has committed**. The validation throws `Map revision hash verification failed.`, so the API returns `409` even though the database writes are already durable. Every retry therefore appended another invalid revision and advanced the pointer again.

The canonical mismatch is proven, but the exact original first differing field cannot be recovered from a SHA-256 digest alone because neither the original request bytes nor the in-memory pre-insert canonical string was logged. The preserved browser tab had no DevTools/network capture and was deliberately not asked to save again. The retained DB row is internally deterministic: raw-row and server-parser recomputations agree, and a controlled full-payload Prisma/PostgreSQL round trip is stable. Consequently, JSONB property ordering is ruled out; inventing a more specific field-level cause would not be evidence-based.

The implementation must use one server-owned canonical payload, hash exactly that payload, write it, freshly read it back and validate it **inside the same transaction**, and only then advance both current pointers/session binding and commit. The dual FAMILY+EXACT write must roll back in full on either hash/readback failure.

## Production deployment and request evidence

The active Production deployment inspected was:

- Vercel project: `tenkings-backend-nextjs-app`
- deployment ID: `dpl_97kcrAYUeA6QyYhutWXMYNhM753D`
- immutable deployment URL: `tenkings-backend-nextjs-faqq71cd3-ten-kings.vercel.app`
- state: `READY`
- Git SHA: `610192cc0a987aeb05849d58bcbd725e82933373`
- deployment created: 2026-08-11 12:19:00 PDT
- canonical and immutable `/card-maps` responses: HTTP `200`, matching ETag and Last-Modified

Vercel runtime metadata shows four failed saves against that deployed code:

| PDT time | UTC time | request | response |
| --- | --- | --- | --- |
| 18:46:29 | 2026-08-12 01:46:29 | `POST /api/admin/ai-grader-v2/maps/save` | `409` |
| 18:47:07 | 2026-08-12 01:47:07 | `POST /api/admin/ai-grader-v2/maps/save` | `409` |
| 18:47:25 | 2026-08-12 01:47:25 | `POST /api/admin/ai-grader-v2/maps/save` | `409` |
| 18:47:28 | 2026-08-12 01:47:28 | `POST /api/admin/ai-grader-v2/maps/save` | `409` |

Vercel captured no application message or request/response body for these events. The operator-visible text in all three screenshots is exactly the server exception string from `loadedPayload`: `Map revision hash verification failed.` Screenshots also prove the editor remained `READY` with Front boundary `4/4`, anchors `4/4`, zones `10`, and Back boundary `4/4`, anchors `4/4`, zones `2`.

## Production migration/schema evidence

The schema needed by the currently deployed single-map implementation is present:

| migration | finished UTC | rolled back | checksum |
| --- | --- | --- | --- |
| `20260810190000_speedster_train_mode_maps` | 2026-08-11 07:45:32.914 | no | `7e1412dda9633770e8042366a36d1f7a8472449cd75f199a9b6f2d89bf0b1d9` |
| `20260810210000_speedster_instrumentation_events` | 2026-08-11 07:45:33.008 | no | `f09fa1d26adb56cf2d86bd9046605e56b6ad7be8558d5621da3c5f6a1800d20e` |

Production is PostgreSQL 17.10. The Card Map identity/map JSON columns are JSONB. Read-only catalog inspection found no user-defined trigger on `AiGraderV2CardTypeMap`, `AiGraderV2CardTypeMapRevision`, or `AiGraderV2Session`; no database trigger is rewriting the payload.

The existing schema can represent two separate map records/revision chains in one Prisma serializable transaction. This investigation found no schema reason requiring a migration for atomic FAMILY+EXACT creation.

## Exact Production records before any repair

Source session:

- session ID: `cmsp75v7b0003il5v6qhkc89q`
- authoritative owner/admin ID: `fe0ff4d9-50ae-40ec-87e8-d92a845e5ab8`
- category: `POKEMON`
- workflow state: `CAPTURED` (not `COMPLETED`)
- created: `2026-08-11T21:53:20.952Z`
- updated by the last failed save: `2026-08-12T01:47:28.987Z`
- bound map revision: `cmspfiypr000fd4lgyjjinooo` (invalid FAMILY v4)
- map policy: `speedster-map-filter-containment-v1`
- identity exactly as retained: `2023 POKEMON`, `MEW EN`, `REVERSE HOLO`, `SQUIRTLE`, `007/165`
- public report slug: null
- reviewed defects: empty
- grade report: empty object
- slab images: null
- NFC/comps/inventory completion flags: false
- Human Grade Label rows for source session: `0`
- permanent `CollectibleCardV2` rows for source session: `0`
- map-filter decision rows for source session: `0`
- instrumentation rows for source session: `1`

Authority baselines at inspection time:

- all Production Card Map records: `1`
- all Production Card Map revisions: `4`
- all COMPLETED V2 sessions: `51`
- all Human Grade Labels: `1202`
- all permanent `CollectibleCardV2` records: `43`

No completed grade, report, label, slab image, permanent card, identity authority, Detector/Memory evidence, or Smart Mark was involved in or mutated by these failed saves. A release verifier should snapshot these same authority counts/identifiers before and after recovery rather than assume they remained unchanged.

## FAMILY and EXACT identities

The retained FAMILY key is:

```json
{
  "scope": "FAMILY",
  "category": "POKEMON",
  "year": "2023 pokemon",
  "productSet": "mew en",
  "parallel": "reverse holo"
}
```

- FAMILY key hash: `b01bbc052716b673ccfba3c66840425af7edb8d5dd8728d1ed03c8ddd9716759`
- FAMILY map ID: `cmspfhq1g0004d4lgjejxgxgn`
- FAMILY current revision: `cmspfiypr000fd4lgyjjinooo`
- FAMILY map created: `2026-08-12T01:46:31.061Z`

The required exact source key is:

```json
{
  "category": "POKEMON",
  "year": "2023 pokemon",
  "productSet": "mew en",
  "parallel": "reverse holo",
  "cardName": "squirtle",
  "cardNumber": "007/165"
}
```

- required EXACT key hash: `4b86a419d8bd900ce490f198dc6f90bdf6995699fbad443679f91c5317942e2b`
- Production map rows matching that exact hash: `0`

Thus the old UI's `NO FAMILY MAP` / `No FAMILY CARD MAP exists yet.` state was false after the first `409`: a FAMILY map and current revision already existed, but the rejected response prevented the client from loading the committed result. The old implementation did not create the required EXACT half.

## Hash evidence and revision chain

Raw persisted values and values reconstructed through the current server parsers produce the same recomputed hash for every revision. All differ from the stored pre-insert hash:

| v | revision ID | created UTC | supersedes | stored hash | persisted-content recomputation |
| --- | --- | --- | --- | --- | --- |
| 1 | `cmspfhq9j0006d4lgwi2a7ddt` | 01:46:31.351 | null | `db4417b8cc34cb0cd9bd02b2f4ee19199729b393672ab9fef30c508ed973c90e` | `38ebadfb6740b999d4d8a90c5ac242c0da08eef5a3468464c8b3cff2e1c004b0` |
| 2 | `cmspfii7q0009d4lgd4y3fuwa` | 01:47:07.574 | v1 | `c689ad359e12c6924ffa4762f3bfcec0a107e65bfa60a04ea479e79e8e8b6bd4` | `c7e2a165104e3b81ae3e075c4e07097b6e84afcd905c0d299c10d8936c154255` |
| 3 | `cmspfiw2k000cd4lg3doafody` | 01:47:25.532 | v2 | `67d2e3d6b3c72f909d7e9279c8220f2f787bad8699eb4f3a61511b7432d579d2` | `be4f65e4575119c32d6f1db048c1acc7fbf9d2ef8c563e5cfa0ab20ca781d578` |
| 4 | `cmspfiypr000fd4lgyjjinooo` | 01:47:28.959 | v3 | `ab8fa8e48bfdc37ea0d5ff23cdd84de7e2b90c43cd462eac58c18fb161da22b5` | `225231037d859e5be0b8998dc6e698909de1f850a4dc77697191a0eba163074d` |

The v1-v4 `frontMap` JSON values are identical to one another. The v1-v4 `backMap` JSON values are also identical. Only revision-chain content (version, revision ID/supersedes and resulting hash) changes.

Controlled regression isolation copied the complete persisted v4 hash payload into a disposable PostgreSQL database through the same Prisma 5.22 client. The canonical hash before insert was `225231037d859e5be0b8998dc6e698909de1f850a4dc77697191a0eba163074d`; a freshly selected round-trip row recomputed to the identical value, and the JSON structures compared equal. The disposable database was stopped and removed. This rules out ordinary JSONB property reordering and proves the persisted payload is currently self-deterministic.

A final bounded local preimage matrix tested 34 unique plausible canonical variants for each of v1-v4 (136 unique revision/digest comparisons). No candidate matched any stored hash. The ruled-out candidate classes were:

- the full EXACT key/hash/normalized identity in place of FAMILY;
- explicit `scope: "EXACT"` on that exact key;
- FAMILY scope omitted or null in the match key, normalized identity, or both;
- normalized lowercase identity used as display identity, display identity used as normalized identity, and FAMILY key used as display identity;
- year `2023` instead of retained `2023 POKEMON` / `2023 pokemon`;
- Front-only, Back-only, and both-side `rectified.webp` provenance keys instead of `inspection.webp`;
- uppercased evidence hashes and omitted inspection/anchor reference evidence;
- null, omitted, swapped Front/Back physical-quad hashes;
- null, current, prior, and prior-prior supersedes revision IDs;
- all geometry rounded to 6, 8, 10, 12, 14, or 15 decimals, or converted to Float32;
- all boundary/polygon point orders reversed or cyclically rotated by one vertex.

This matrix is negative evidence: it narrows the historical mismatch, but it cannot reveal an unlogged SHA-256 preimage.

What cannot be proven after the fact is the first original value/path difference between the pre-insert canonical bytes that produced the stored hash and the bytes retained in PostgreSQL. Those pre-insert bytes were not logged, and SHA-256 is not reversible. A regression fixture can faithfully reproduce the **observed Production failure** by inserting the retained v4 immutable payload with its stored hash and asserting that validation fails before the fix and rolls back inside the transaction after the fix. It must not claim that an invented candidate field is the historical pre-insert difference.

## Code-level failure sequence

At deployed commit `610192cc`, `saveSpeedsterCardTypeMapRevision` performs this sequence:

1. Parse Front/Back geometry and hash source inspection objects.
2. Open a serializable database transaction.
3. Create/find one selected-scope map (`FAMILY` in Mark's request).
4. Build an in-memory hash payload.
5. Insert one revision with `revisionHash: speedsterMapRevisionHash(payload)`.
6. Advance `AiGraderV2CardTypeMap.currentRevisionId`.
7. Bind the CAPTURED source session to that revision and identity registration.
8. Commit the transaction.
9. Only after commit, call `validateSpeedsterLoadedMapRevision(created)`.
10. Throw `Map revision hash verification failed.` and return `409`.

The tests used a mock transaction whose revision `create` echoes the same input object. That mock cannot reproduce a server-to-real-database serialization/normalization difference and, more importantly, cannot prove validation failure rolls back because validation is outside the transaction.

Required repair behavior:

- parse/normalize one server-owned immutable FAMILY payload and one server-owned immutable EXACT payload;
- compute independent hashes over exactly the immutable fields that will be persisted;
- insert both revisions in the same transaction;
- freshly select both revisions inside that transaction and validate their canonical hashes and distinct keys;
- update both current pointers and bind the source session only after both validations pass;
- any insert/readback/hash/pointer/binding failure throws inside the transaction, rolling back maps, revisions, pointers, and binding together;
- return both validated revision identities;
- retain existing bad v1-v4 immutable evidence; do not rewrite or delete it;
- recover by appending a valid FAMILY v5 from the retained draft and a valid EXACT v1 atomically;
- bind the CAPTURED source session to the valid EXACT revision (exact wins for the source card); the FAMILY v5 serves matching siblings;
- malformed exact evidence must not silently fall through to family; fail safely to the approved normal-human-review path.

The existing invalid v4 session binding can be healed append-only by the new dual save: a valid FAMILY v5 supersedes v4, a valid EXACT v1 is created, both pointers activate only after verification, and the CAPTURED source session is repinned to valid EXACT v1 with exact-image identity registration. This requires no destructive rewrite. Until that succeeds, runtime validation must continue to reject the invalid binding rather than guess.

## Timing baseline

The only Production instrumentation row for the source session predates map authoring:

- event ID: `14f4129e-e4c7-48aa-a94f-b210b93559d4`
- event type: `CARD_MAP_NOT_APPLIED`
- created: `2026-08-11T21:56:00.399Z`
- applied scope: `NONE`
- outcome: `NORMAL_HUMAN_REVIEW`
- duration: null

There is no trustworthy pre-fix geometry-step duration for this source session. The release must not invent a before value; it should record this missing baseline and capture post-fix geometry instrumentation with map kind (`EXACT` or `FAMILY`) and before/after duration fields on real exact-source and sibling lookups.

## Sanitized recovered draft

This is sufficient to reconstruct/import Mark's draft without redrawing. Storage keys are stable object identifiers, not signed URLs; no credentials or signatures are included.

The SHA-256 of the compact, recursively key-sorted JSON below is `0abed4fb2dda043f3e895debc9de64d8abd8543b0473262eb753d95a281d0259`. Use this to verify any copied recovery artifact before import.

```json
{
  "format": "ten-kings-speedster-card-map-draft-recovery-v1",
  "recoveredFromRevisionId": "cmspfiypr000fd4lgyjjinooo",
  "sourceSessionId": "cmsp75v7b0003il5v6qhkc89q",
  "sourceIdentity": {
    "category": "POKEMON",
    "year": "2023 POKEMON",
    "productSet": "MEW EN",
    "parallel": "REVERSE HOLO",
    "cardName": "SQUIRTLE",
    "cardNumber": "007/165"
  },
  "front": {
    "referenceInspection": {
      "storageKey": "ai-grader-v2/fe0ff4d9-50ae-40ec-87e8-d92a845e5ab8/cmsp75v7b0003il5v6qhkc89q/prepared/front/inspection.webp",
      "sha256": "3024466a5fbc35a894f95428c13b8dd4302b8224e9ccd4aaa1cc1f44e50eeff9"
    },
    "sourcePhysicalQuadSha256": "e6e2cebd41e6430074bab86378a490ecaa1b9a23a95773e77c6d6be6cd26ccd9",
    "designBoundary": {
      "kind": "QUAD",
      "points": [
        { "x": 0.04132705772016933, "y": 0.0267807156983176 },
        { "x": 0.9607888828757549, "y": 0.03352952712366526 },
        { "x": 0.9604890042329328, "y": 0.9608810429235087 },
        { "x": 0.03672166346479828, "y": 0.9726440858281742 }
      ]
    },
    "anchors": [
      { "id": "front-anchor-1", "label": "Anchor 1", "point": { "x": 0.1096896701388889, "y": 0.113343253968254 } },
      { "id": "front-anchor-2", "label": "Anchor 2", "point": { "x": 0.8969184027777778, "y": 0.1184818328373016 } },
      { "id": "front-anchor-3", "label": "Anchor 3", "point": { "x": 0.0827365451388889, "y": 0.9244326636904762 } },
      { "id": "front-anchor-4", "label": "Anchor 4", "point": { "x": 0.9158311631944445, "y": 0.9173874627976191 } }
    ],
    "zones": [
      {
        "id": "front-zone-1",
        "label": "Card Name",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.1876632137883008, "y": 0.0378251325381047 },
          { "x": 0.4422005571030641, "y": 0.03722456925115971 },
          { "x": 0.4562043001392758, "y": 0.08430407140490391 },
          { "x": 0.1891430188022284, "y": 0.08306929257786613 }
        ]
      },
      {
        "id": "front-zone-2",
        "label": "HP, Type",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.7324292422890553, "y": 0.07279370651093439 },
          { "x": 0.8080839934172453, "y": 0.04113345675998264 },
          { "x": 0.9512063312441968, "y": 0.03881326300012426 },
          { "x": 0.9492380182944522, "y": 0.09317030758159377 },
          { "x": 0.7805124776941156, "y": 0.08299276605989066 }
        ]
      },
      {
        "id": "front-zone-3",
        "label": "description",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.2085473247446611, "y": 0.4811029655400928 },
          { "x": 0.7819209900185701, "y": 0.4803600273359841 },
          { "x": 0.7802054317548747, "y": 0.4972172175281643 },
          { "x": 0.212627669452182, "y": 0.4958374751491054 }
        ]
      },
      {
        "id": "front-zone-4",
        "label": "play rules text",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.5630213773792944, "y": 0.6204197341989728 },
          { "x": 0.9287640953241063, "y": 0.6251567741985586 },
          { "x": 0.9327638532236536, "y": 0.6810923197792412 },
          { "x": 0.06311284510648793, "y": 0.6805559869946984 },
          { "x": 0.06635144870371983, "y": 0.6207241414792495 },
          { "x": 0.3109314474886838, "y": 0.6129696430790258 },
          { "x": 0.31217266568013, "y": 0.5779446854032058 },
          { "x": 0.5459797043654248, "y": 0.5813738176410288 }
        ]
      },
      {
        "id": "front-zone-5",
        "label": "text",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.3160562470984216, "y": 0.7302624681597912 },
          { "x": 0.3111405651549443, "y": 0.766265525337558 },
          { "x": 0.5418426513671875, "y": 0.7696775406125992 },
          { "x": 0.550716871227948, "y": 0.7279877052787442 }
        ]
      },
      {
        "id": "front-zone-6",
        "label": "Print zone",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.8591959635416667, "y": 0.7258402506510416 },
          { "x": 0.9315285011574074, "y": 0.7239945023148148 },
          { "x": 0.9314898789316388, "y": 0.7627703020160288 },
          { "x": 0.8608259025722493, "y": 0.762595811847664 }
        ]
      },
      {
        "id": "front-zone-7",
        "label": "Print zone",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.2854971854688951, "y": 0.976616861332008 },
          { "x": 0.7226526230269267, "y": 0.9743208231082257 },
          { "x": 0.7380890204271123, "y": 0.9903341183368539 },
          { "x": 0.2701587163416899, "y": 0.9930546926772698 }
        ]
      },
      {
        "id": "front-zone-8",
        "label": "Print zone",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.3992066449773677, "y": 0.9093341966430584 },
          { "x": 0.9468420625507776, "y": 0.909714725967114 },
          { "x": 0.9515903049045139, "y": 0.954385101479828 },
          { "x": 0.498613532871257, "y": 0.9618776598223161 },
          { "x": 0.4920741570914577, "y": 0.9373299590477966 },
          { "x": 0.4043206770107939, "y": 0.9395742245744284 }
        ]
      },
      {
        "id": "front-zone-9",
        "label": "Print zone",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.05112354558379759, "y": 0.862439781881627 },
          { "x": 0.7909842290143339, "y": 0.8635114767126408 },
          { "x": 0.7784550772182567, "y": 0.8880708263440192 },
          { "x": 0.04761988959493964, "y": 0.8891540891370527 }
        ]
      },
      {
        "id": "front-zone-10",
        "label": "Print zone",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.0581258704735376, "y": 0.9131745982438702 },
          { "x": 0.2039592038068709, "y": 0.9148882745195493 },
          { "x": 0.191797963091922, "y": 0.9438732190192181 },
          { "x": 0.3134648315089659, "y": 0.9440570120941021 },
          { "x": 0.3225974930362117, "y": 0.9715405483764082 },
          { "x": 0.05223566620241411, "y": 0.9672822440357853 }
        ]
      }
    ]
  },
  "back": {
    "referenceInspection": {
      "storageKey": "ai-grader-v2/fe0ff4d9-50ae-40ec-87e8-d92a845e5ab8/cmsp75v7b0003il5v6qhkc89q/prepared/back/inspection.webp",
      "sha256": "b9dc2282bc884d5993ef9f4d6ee690e47cf1b191e4adf4c2b2171f6cd1e3593c"
    },
    "sourcePhysicalQuadSha256": "6ed1b48732641f49a8253fcb73a751de124eb430a0a727284ea2187d82a85104",
    "designBoundary": {
      "kind": "QUAD",
      "points": [
        { "x": 0.05118110236220472, "y": 0.04049493813273341 },
        { "x": 0.9440944881889763, "y": 0.04049493813273341 },
        { "x": 0.9440944881889763, "y": 0.9533183352080989 },
        { "x": 0.05118110236220472, "y": 0.9533183352080989 }
      ]
    },
    "anchors": [
      { "id": "back-anchor-1", "label": "Anchor 1", "point": { "x": 0.09769965277777778, "y": 0.07094804067460317 } },
      { "id": "back-anchor-2", "label": "Anchor 2", "point": { "x": 0.8975043402777778, "y": 0.0686616443452381 } },
      { "id": "back-anchor-3", "label": "Anchor 3", "point": { "x": 0.890625, "y": 0.9038008432539683 } },
      { "id": "back-anchor-4", "label": "Anchor 4", "point": { "x": 0.1107313368055556, "y": 0.9149848090277778 } }
    ],
    "zones": [
      {
        "id": "back-zone-1",
        "label": "Pokemon text",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.08353281685236769, "y": 0.1263978628230616 },
          { "x": 0.473243819637883, "y": 0.1040786530815109 },
          { "x": 0.4982699338440111, "y": 0.07372949801192843 },
          { "x": 0.5934344533426184, "y": 0.07810170228628231 },
          { "x": 0.9389798050139275, "y": 0.142069458250497 },
          { "x": 0.8606045438718662, "y": 0.2961450049701789 },
          { "x": 0.5692244080779945, "y": 0.2394461356858847 },
          { "x": 0.5157446901114207, "y": 0.2786173583499006 },
          { "x": 0.4729935584958218, "y": 0.2457986456262425 },
          { "x": 0.3876871518105849, "y": 0.2742606858846918 },
          { "x": 0.1661516364902507, "y": 0.2910971669980119 }
        ]
      },
      {
        "id": "back-zone-2",
        "label": "Pokemon",
        "semanticType": "PRINT_TEXT",
        "polygon": [
          { "x": 0.6633334784122563, "y": 0.73137736083499 },
          { "x": 0.8340877437325905, "y": 0.6927885810139165 },
          { "x": 0.8789280118384402, "y": 0.7761012052683897 },
          { "x": 0.9222884749303621, "y": 0.8859809890656064 },
          { "x": 0.624216573816156, "y": 0.8945623136182903 },
          { "x": 0.451373172005571, "y": 0.9339742793240556 },
          { "x": 0.381452385097493, "y": 0.8873477882703777 },
          { "x": 0.07320682451253482, "y": 0.8614950919483101 },
          { "x": 0.1344446378830084, "y": 0.7032414885685885 },
          { "x": 0.372856458913649, "y": 0.7401528330019881 },
          { "x": 0.4481741817548747, "y": 0.7350739314115308 }
        ]
      }
    ]
  }
}
```

## Exact commands/evidence classes used

Read-only or disposable checks included:

- `git fetch --all --prune`, `git log --all --decorate --graph`, `git worktree list`, `git show`, and clean-status checks;
- Vercel deployment inspection and bounded runtime-log query for the four save timestamps;
- Prisma `findUnique`, `findMany`, and `count` selects against the exact map/session/key hashes;
- read-only `_prisma_migrations`, `information_schema.columns`, and `pg_trigger` catalog queries;
- current `speedsterMapRevisionHash` recomputation over raw and parser-normalized retained records;
- disposable local PostgreSQL/Prisma v4 payload round trip, followed by container removal;
- original Production screenshot inspection.

No signed URL, database URL, token, API key, storage credential, or private key is included in this report.

## Release verification obligations

Before claiming recovery complete, the lead must independently prove in Preview and then Production:

1. retained draft imports without changing any point, label, type, ID, side, source identity, image provenance, or physical-quad hash;
2. one save appends FAMILY v5 and creates EXACT v1 in one transaction;
3. both freshly read revisions independently verify before commit;
4. a fault in either write or validation leaves both current pointers, revision counts, and session binding unchanged;
5. source Squirtle resolves EXACT and a matching different-name/card-number sibling resolves FAMILY;
6. exact and family maps do not merge;
7. the invalid v1-v4 records remain immutable historical evidence;
8. source session is repinned to valid EXACT v1 and remains CAPTURED unless the separately authorized workflow advances it;
9. the 51 completed sessions, 1202 labels, 43 permanent cards, images, identities, grades, reports, Detector/Memory evidence, and Smart Marks remain unchanged;
10. geometry instrumentation records applied map kind and real durations; the missing historical duration is reported as unavailable rather than fabricated.
