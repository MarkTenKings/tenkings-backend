# September 16 recognition package handoff

Status: **offline package candidate, opt-in, uncommitted**. No Inventory or Atlas
application adapter, root package/lock file, database, provider, production
setting or release was changed by this delegated package preparation. The
coordinator owns the session-log entry, final commit and delivery to Atlas.

## Source and delivery identity

- Authoritative edited checkout: `/Users/markthomas/tenkings/codex-staff-inventory-release-20260910`.
- Inventory base and recognition-fix source: `60572cec895ad63d4ab826cd366f6475b04e725a`.
- Read-only Atlas baseline: `/Users/markthomas/.codex/worktrees/2c75/ten-kings-mystery-packs-clean`, `f16bbb7e49ebf46c09e32d30a9a441a947e75df3`.
- Copied exactly the ten **tracked** files under `packages/card-identification-core` from that Atlas commit, checking each working source byte against its git blob before copying. No Atlas file was edited. Its original extraction source remains `a319904273d4b4e4e81d721b699d3a2990975eda`.
- `packages/card-identification-core/source-manifest.json` is unchanged V1 history. `source-manifest-v2.json` pins the current Inventory sources. In particular, `frontend/nextjs-app/lib/server/staffInventoryIdentification.ts` is SHA256 `e9015c3fccaaf682b46eccd6a10b66a6786593f7574f6bff908ed5fa049727ba`, git blob `3a2b5cf2232bb0ba6ee079e6c039533bbfce4133`.
- `packages/card-identification-core/handoff-manifest.json` contains every Atlas baseline file hash/git blob and all 19 resulting package file hashes/sizes. The manifest excludes itself to avoid a recursive hash. Its SHA256 is `aefea0aa160b37bf645219b31ce21fd17b99201ee0c6db98c504bc4fd9973f58`.
- Result ledger SHA256: `d067ee4b62a3fd1b4c84f79eeda4082b3c1089bd5372be67f87303995a2e8ee4`. This hashes the UTF-8 bytes of `JSON.stringify(manifest.result_files)` in listed order. It identifies the reviewed package bytes; it is not a commit or authenticity signature.
- **Result commit: pending coordinator commit.** No commit was made by this package subtask. Record the actual final Inventory commit in the delivery message, alongside this ledger; do not invent a result SHA or merge either app's complete release lineage. If any listed package file changes, regenerate the result ledger and rerun affected checks before delivery.

This implements the narrow recognition-first delivery recorded in the
September 16 owner amendment to the canonical blueprint and the reviewed
`2026-09-15-variant-and-sold-comps-improvement.md` plan. Catalog/research work
remains separate.

## Versioned delta

Package version is `0.2.0`. The root entry point continues to expose V1. All V1
runtime files, declarations, source manifest, generator and golden/test files
remain **byte-identical** to Atlas's baseline. Only the package export map and
README change among its existing files. The new `./v2` entry point exports
`identifyCardV2` and its explicit V2 parsers/hash helper.

V2 reuses V1's bounded orchestration, verified JPEG reads, output schema,
warnings, deadlines and cancellation. It adds only:

1. **Google partial response selection.** The injected OCR call receives
   `{body,responseFields}`. The JSON body is unchanged; the adapter must send
   `responseFields` as the URL's `fields` query. The exact mask is
   `responses(fullTextAnnotation/text,textAnnotations/description,error)`.
   Its request hash binds the complete envelope, and result provenance retains
   the mask and both OCR request hashes. This is the real September 15 fix for
   unused polygons exceeding the retained 256 KiB body limit.
2. **Pokémon-only instructions and lower-front crop.** A bounded OCR hint on
   either side selects the exact Inventory instructions. The model still must
   confirm Pokémon from the photographs. The existing single Astra request
   receives the same two original interpretation JPEGs plus a PNG made inside
   the core from the verified Front bytes. No extra provider call or photo is
   introduced. The sports model request, including serialized schema, ordering,
   two image bodies and hash, is identical to V1 and current Inventory.
3. **V2 provenance.** `engine_version=card-identification-v2` and the Inventory
   source commit accompany the existing fields. The input hash is SHA256 of
   `JSON.stringify({engine_version:'card-identification-v2',input_sha256:V1InputHash})`.
   The model hash covers its final exact serialized request. The result parser
   rejects V1 envelopes; V1 rejects V2. There is no reinterpretation of saved
   requests/results/hashes.

The crop uses encoded JPEG pixel coordinates with no auto-orientation or
resizing: `left=0`, `top=floor(sourceHeight/2)`, full width, remaining height.
The exact transform matches Inventory. A checked single-page PNG under 3 MiB
is recorded with parent Front SHA256, source dimensions, exact region, MIME,
byte count and output SHA256. The overall result already binds the complete
parent Front descriptor, subject and revision. This crop is dependent evidence
from that photo, never an independent image or grading original. Caller-supplied
PNG inputs, third photos, crop references and non-null knowledge are rejected.
The crop runs within the retained 25-second model/40-second overall budgets.

## Offline validation actually completed

Node **22.23.2**, Sharp **0.33.5**, Zod **4.1.11**. The existing installed
dependencies were reused through ignored package-local links; no dependency
installation or root lock change occurred.

```sh
node --test packages/card-identification-core/test/*.test.mjs
node frontend/nextjs-app/node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node --typeRoots frontend/nextjs-app/node_modules/@types packages/card-identification-core/test/consumer-types.mts
node packages/card-identification-core/scripts/generate-source-fixtures-v2.mjs
node packages/card-identification-core/scripts/verify-handoff.mjs
```

- **26/26 tests pass**, zero failures/skips: the unchanged 13-case V1 suite and
  13 V2 cases. Goldens compare the full serialized sports/Pokémon/back-only
  Pokémon requests against the actual immutable Inventory builder. The sports
  request also matches the older V1 golden exactly.
- The TypeScript consumer fixture passes for both package entry points and
  rejects assigning a V2 result to the historical V1 result type.
- Golden regeneration executes only extracted, hash-checked request/parser
  definitions with synthetic photos and no app initialization. Regeneration is
  byte-identical: `test/fixtures/source-parity-v2.json` SHA256
  `edbc62344afc41c8e23b015199af90064bf6c45d9c6aba7f011cdbcf814d3888`.
- Tests cover OCR fields/body/hash binding, simulated polygon overflow, retained
  provider limits, exact even/odd-height PNG lineage, newline and Back-only
  Pokémon hints, untouched input bytes, adapter-buffer mutation, unknown finish,
  stale pair/version/parent/region rejection, forbidden third photos/PNG inputs/
  knowledge, cancellation and one-attempt timeout behavior.
- The verifier checks the complete resulting package member list/hashes and
  unchanged V1 members. Package whitespace validation passes.

These results establish source-request/parser compatibility and local boundary
behavior. They do **not** prove fresh provider accuracy, current hosted Atlas
state, both real adapters, staff-edit concurrency, production throughput or
phone latency. No live provider request, synthetic inventory write, migration,
deployment, restart or original-photo access occurred.

## Adapter adoption: required work owned by each lead

Keep the root Inventory intake implementation and Atlas's current consumer on
their existing paths until the explicit adapter acceptance below passes. The
package does not switch either app automatically. Exchange only the reviewed
package/documentation delta after confirming the receiver's package baseline
hashes; inspect intervening package changes rather than overwriting them.

### Atlas adapter

At the inspected Atlas base,
`packages/atlas-connected-manual/src/identification.mjs` imports V1 and its OCR
transport posts the whole argument to a fixed Google URL. It **cannot consume
V2 unchanged**. The Atlas lead must:

1. Select V2 deliberately for new attempts. Send the OCR envelope's `body` as
   JSON and its `responseFields` as `fields` in the Google URL. Preserve the
   existing Google key header, bounded response reader, redirect policy,
   cancellation and actual HTTP status handling. Record the entire V2 envelope
   and its hash through the existing request/response and paid-work receipts.
2. Keep historical V1 result loading and already-dispatched attempts under
   their original version. Dispatch each stored result to its explicit matching
   validator; unknown versions fail, with no fallback or retry under another
   version. Preserve completed-attempt idempotency and stale-pair fencing.
3. Retain the existing verified original/working-frame → JPEG interpretation
   artifact binding. The new detail binds that JPEG's Front hash, not an
   unrelated photograph. Persist exact request/image bytes if later replay of
   model/crop hashes is required. Never replace Atlas's full-resolution grading
   originals with the interpretation JPEG or its crop.
4. Exercise `details.mjs`'s actual `touched`-field and source-revision adoption
   logic with in-flight staff edits, explicit clears, category/profile edits,
   retakes and restored V1 attempts. Keep category-specific grading validation:
   Pokémon publisher suggestions are descriptive fields and must not be copied
   into the Pokémon grading identity's prohibited manufacturer field. The core
   still preserves its 80-character card number; grading-boundary limits remain
   Atlas's responsibility. Finish suggestions are not approved catalog or
   grading-reference identity.
5. Verify local/package/native Sharp availability in the actual server artifact,
   then run sports and Pokémon adapter cases through its ordinary storage,
   authorization, accounting and UI boundaries. Atlas retains release timing
   and real-card grading acceptance ownership.

### Inventory adapter

The current app already contains the proven fixes in its own server function.
Do not replace that intake as a side effect of this package handoff. A later
deliberate shared-core adapter must preserve managed-storage checks, exact
Front/Back keys and SHA256 values, bounded provider transport, the current
client result shape or an explicitly versioned mapper, staff edit protection,
Photos → Cost → Sales channel → Add inventory → Next card, and atomic research
enqueue. Saved event/result bytes keep their original interpretation. Verify
both adapters before activating any root-intake substitution.

Both applications must independently verify no added provider call or mandatory
step and paired sports/Pokémon behavior under their real adapter. The broader
catalog/research load acceptance and two-way reviewed knowledge pilot belong to
the later delivery; this package accepts no new knowledge input and cannot
establish those outcomes.
