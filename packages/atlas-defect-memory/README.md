# Reviewed defect memory

ATLAS-only, application-managed retrieval of deliberately human-reviewed visual lessons. No model training, embeddings, SAM fingerprint, provider request, scoring change or final-report approval occurs here.

`CONFIRM_FINDINGS` is the durable publication intent. Its existing immutable action records the authenticated REVIEWER, exact committed draft and deliberate paired review. Publication prepares immutable crop and exact-trace artifacts outside database transactions, then reauthenticates the original confirmer, rechecks current card edit authority, source, geometry, findings, assistance and identity, and appends one versioned manifest. Certification authority is not required for this deliberate learning action. Final `APPROVE_REPORT` retains its separate existing authority.

Failed crop/storage/publication leaves the confirmed review intact and discoverably pending. Retrying the same action returns the existing publication. A later confirmation supersedes all earlier lessons from that card, including a confirmation of zero findings. No action, publication, crop or old lesson is deleted. Current unconfirmed edits make an old confirmation ineligible for new publication; existing published visual history remains valid until a newer confirmation supersedes it.

## Host integration

```js
const repository = createDefectMemoryRepository({ boundary, validateSource });
const memory = createDefectMemory({ repository, hydrate, createExemplar, proposalTrace });
await memory.publish(staff, cardId, committedConfirmActionId);
await memory.status(staff, cardId); // NO_CONFIRMED_FINDINGS / PENDING / PUBLISHED / SUPERSEDED
await memory.retrieve(staff, { cardId, side: 'FRONT', limit: 12 });
```

The host calls publication after confirmed review commits and catches publication failure independently. An authenticated retry/status endpoint uses the same methods. `hydrate(card)` must verify the exact immutable artifact references from the supplied card snapshot; it must never substitute the current editing draft. `validateSource({tx,principal,cardId,draft})` rechecks the real native intake source in the same ordinary staff transaction.

`createExemplar({card,side,finding,trace,frame,cropTransform,source,staff})` receives the checked canonical 1270×1778 trace and its exact padded pixel bounding box. It must load the verified prepared rectified image, decode and crop without resampling, verify actual PNG bytes, and create immutable `REVIEWED_CROP` and `REVIEWED_TRACE` JSON artifacts. It returns `{crop:{ref,sourceHash,width,height,mime:'image/png',sha256},trace:{ref,sourceHash,sha256},cropTransform}`. The host owns actual crop-byte qualification. These prepared-view exemplars do not establish original-resolution optical detail.

Optional `proposalTrace({proposal,side,frame,review})` returns the existing checked trace RLE for a deliberately rejected Astra outline. Confirmed assistance records bind analysis/proposal identity, reviewer, decision, exact frame and proposal hash. Accepted machine proposals are not mislabeled human-added misses; human type/trace corrections, explicit rejection and independently added findings retain their different meanings. Unreviewed proposals and engine-only suppression never become lessons.

## Retrieval and access

Each request authorizes and hydrates its current target card, derives its design context and original hashes, then queries the database anew. One SQL snapshot includes publication generation, latest confirmation state (including pending supersession), and relevant manifests. `revision` is `m1:<generation>:<confirmation-state-sha256>`; it changes for a newer pending confirmation before publication increments the generation. `sha256` binds the exact returned revision, status, selected lesson IDs and complete lesson descriptors. `validateRetrieval()` and `retrievalDigest()` are shared with the analysis adapter. Record both revision and hash with each analysis.

The initial deterministic policy matches category, year, manufacturer, set, parallel, insert and Pokémon layout. Exact card number ranks first. Printed-design negative examples require a known matching card number; unrelated designs and identical original-photo hashes are excluded. The target card cannot teach its own new analysis. Up to 256 recent matching publications are considered; the request selects at most32 lessons. `PUBLICATION_PENDING` is distinct from `EMPTY_REVIEWED_BANK`. The host blocks a new defect request while relevant publication is pending.

Only registered reviewed exemplar references are supplied to the private server's analysis hydration. There is no bank endpoint that accepts arbitrary old card IDs or storage keys and exposes their assets. Reviewed crops are reusable staff knowledge; full old card/source assets retain ordinary card authorization.

## Database and verification

The additive SQL uses one append-only table in `atlas_manual`, source/action foreign keys, a confirmation provenance guard, and a short publication-only advisory lock for committed generations. Ordinary reads and card edits do not take that publication lock. `defectMemoryGrantSQL(role)` grants only SELECT/INSERT on publications and EXECUTE on the normalized design helper; the connected role retains its existing manual/intake privileges. `authorizeManualCard()` exposes the same current card ACL check for the host's transaction composition.

The proposal and ordered staff migration `20260912200000_defect_memory` must stay byte-identical. Tests use synthetic owned artifacts and a disposable local database only. Unit tests do not prove real detection quality, crop optical fidelity, hosted operation or production migration acceptance.
