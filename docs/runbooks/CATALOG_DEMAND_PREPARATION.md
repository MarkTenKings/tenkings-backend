# Shared catalog demand preparation

This additive host path prepares evidence for a first-seen set and accepts optional private reference-photo proposals. It does not update existing SetDraft/SetCard/SetApproval rows or publish catalogs. Ten Kings ingestion, grading and business controls remain unchanged. Source acquisition can return no card-specific choices; a program's parallel list is retained as context, not expanded into assumed card applicability.

## Enablement and authority

The existing Atlas catalog token is checked against `CATALOG_ATLAS_SERVICE_TOKEN_SHA256`. Preserve existing scopes and explicitly add `demand` and `reference-proposals` to `CATALOG_ATLAS_SERVICE_SCOPES` when enabling these operations. Both still require `SET_CATALOG_EVIDENCE_ENABLED=true` and `CATALOG_ATLAS_SERVICE_ENABLED=true`. Their separate gates are `CATALOG_DEMAND_ENABLED=true` and `CATALOG_REFERENCE_PROPOSALS_ENABLED=true`. They default unavailable. No new token, staff cookie or operator key grants this service authority.

Authenticated service actor fields are fixed: `producer: atlas`, `actorKind: service`, `actorRef: atlas:card-catalog:v1`, `userId: null`. Human inspection uses current authenticated SetOps reviewer sessions; a service token cannot publish or authorize a photo's proposed permissions.

Apply the reviewed `20261009010000_catalog_demand_preparation` migration before enabling. It creates isolated `SetCatalogDemandJob`, `SetCatalogDemandResult`, `SetCatalogDemandSource` and `SetCatalogReferenceSubmission` tables, with immutable retained evidence and monotonic bounded attempts. Existing catalog proposal rows are reused for submitted observations. Production migration, credentials and flags require the release owner's exact reviewed deployment procedure; no deployment is performed by this runbook.

## Source preparation

`POST /api/internal/card-catalog/v1/demand` accepts `{demand:{category,year,manufacturer,setName,language},card?:{name,cardNumber}}`. The shared key excludes physical-card identity/photos. It includes category, year, manufacturer, set, language and acquisition-policy revision. Category and language never cross automatically.

`createSetCatalogDemandService` provides an atomic deduplicated claim and immutable source/result cache. One attempt has an 18-second acquisition budget, at most five actual HTTP requests, at most two source files of 2 MiB each, and bounded PDF decompression. Topps uses actual checklist-index anchors; other discovery reuses the existing SetOps source finder. Only approved source hosts are fetched; redirects, challenge pages and unrelated product documents fail closed. Explicit printing columns or literal finish sections become candidate rows. Legacy inferred base/prefix values do not.

The new-key limit is 20 sets per rolling day. A demand has at most three attempts with a 30-second lease and one-minute failed-attempt delay. Terminal prepared/unavailable demand versions are retained; there is no implicit infinite retry or reviewed-publication refresh. A later acquisition policy creates a new key. Existing reviewed publications are queried separately before demand preparation. Network and incomplete source coverage remain explicit. This release acquires checklist metadata, not manufacturer finish photographs.

Consumer results use `catalog-demand-result/v1`: pending/ready/unavailable state, exact sources and byte hashes, up to 48 matching card rows, separately labeled program context, problems, capture time and full snapshot hash. Internal preparations retain up to 5,000 rows. Overflow is marked truncated; absent choices cannot establish a negative or base finish. No preparation invents a SetOps canonical identifier.

## Optional physical reference proposals

`POST /api/internal/card-catalog/v1/reference-proposals` receives an existing `catalog-observation-proposal/v1`, its exact `{physicalCardRef,observationId,inputRevision,evidenceSha256}` binding, the two front/back `{imageId,bytesBase64,permission}` entries, and `sourceArtifacts:[{sourceId:'physical-review',bytesBase64}]`. Permission contains an explicit `owned_original`, `licensed` or `permission` basis, a nonempty detail and the proposed consumers (`inventory` and/or `atlas`). This is a pending assertion, not a rights grant. Ordinary metadata proposals remain image-free.

The source artifact is a canonical JSON `atlas-variant-reference-capture/v1` descriptor of at most 16 KiB. Its actual byte hash binds the physical source record. It retains the original aggregate source hash, current identity/action/revision, capture policies and front/back `photoDerivation` original/frame/comparison/reference hashes. Both derived photo sources retain this parent and checksum storage references. This preserves the original observation without asking the publisher to fetch nonexistent bytes for an aggregate identity hash.

The exact full image roster, physical-source ancestry, SHA-256, JPEG MIME and decoded dimensions are checked. Total raw images are capped at 3 MiB; each is at most 1.5 MiB and 1600 pixels per dimension. Private storage must support conditional `If-None-Match: *` checksum writes. Existing checksum objects are reused; the capture descriptor and every newly written or concurrently created image are read back and hash-checked before an immutable pending receipt is recorded. A replay with changed bytes, lineage or permission is rejected. No arbitrary source URLs or user-facing storage capabilities are accepted.

`prepareReferenceProposal` in `setCatalogReferenceProposals.ts` derives the receipt hash. It hashes canonical `{...serviceActor,binding:observation}`, then canonical `{schemaVersion:'catalog-reference-proposal/v1',disposition:'requires_authorized_review',proposalSha256,authoritySha256,sourceArtifacts:[{sourceId,sha256}],images:[{imageId,sha256,proposedPermission}]}`. Source artifacts follow the physical-root roster (exactly one); images follow proposal order. Permission details are trimmed and consumer array order is preserved. The returned `submissionSha256` binds these exact fields.

## Human review

The existing SetOps catalog evidence view includes **Prepared set references**. Reviewers manually load preparations, inspect the pinned version and download exact source bytes or unreviewed JSON. Exports do not stage or replace a draft. Map verified evidence into an isolated full catalog manifest, retain original source lineage, and use the existing authorized review/publication flow. The proposal inbox separately exposes pending image permissions and authenticated, checksum-verified private image downloads. A human must establish actual depicted printing, applicability, diagnostics and permissions before any reference is published. Neither path claims all variants or all photos are available.

To publish a submitted reference through the existing controls:

1. Load the intended complete catalog review packet. Its canonical card identities, printing scopes and supported applicability must already have authoritative evidence. The attachment step creates none of those facts.
2. In **Observation inbox**, select the exact photo proposal and **Inspect proposed photo permissions**. Download and inspect its reference bytes as needed.
3. Under **Prepare this photo for full review**, choose the front/back image, the existing depicted card and a supported depicted printing. Select its representative finish scope and only diagnostics actually visible in the image. Review the proposed permission and enter an explicit review note, then acknowledge the mapping and permission.
4. **Add photo to review packet** calls a current-human-authorized preparation endpoint. It copies the complete source ancestry and explicit grant into the loaded packet; it does not write a draft, grant or publication. Repeat for another image if appropriate.
5. **Validate and prepare full review** verifies all original source/capture/image bytes and displays the mapped images, full identities, applicability, unknowns and grants. The existing approver acknowledgement and **Publish reviewed catalog evidence** action remain required. Failed image loading prevents publication. Published exact versus representative lookup retains the deliberately reviewed mapping for each authorized app.

## Qualification

Lightweight tests run from `frontend/nextjs-app` with Node 22 and `--import tsx --test` for `setCatalogDemandSources.test.ts`, `setCatalogDemandParser.test.ts`, `setCatalogDemandReview.test.tsx`, `setCatalogReferenceProposals.test.ts`, `setCatalogReferenceAttachment.test.tsx`, `cardCatalogService.test.ts`, `setCatalogProposalInbox.test.tsx` and `setCatalogEvidenceReview.test.tsx`. Package tests run with `node --test packages/card-catalog-evidence/tests/*.test.mjs`.

The actual PostgreSQL harness is `packages/database/scripts/testSetCatalogDemandDisposable.mjs --ack-disposable-local-postgres`, with `INVENTORY_TEST_TOOLS_DIR` pointing to the existing reviewed embedded-PostgreSQL tool directory. It refuses ambient application database URLs, requires at least 512 MiB free, owns one temporary loopback database, applies the full migration chain and verifies the second deployment is a no-op. It exercises concurrent claims, expired leases, attempt/quota bounds, unknown commit replay, immutable source/reference rows, approved-set preservation and the complete submitted-photo → attachment → human publication → both-app exact/representative image-read path, then removes only its owned cluster. Do not claim PostgreSQL qualification until this harness passes. It remains held while workspace disk capacity is insufficient.
