# Source-fact use and image grants — reviewed implementation correction

2026-09-17. This note records the narrow correction accepted by the Inventory release lead after the read-only audit. It is not a legal attestation, a source/image grant, an actual evidence review or a publication receipt.

## Reason for correction

The owner-approved blueprint, lines 1725–1729, requires authorized human review of complete identity/applicability/source/image evidence and preserved hashes/provenance. The approved improvement plan authorizes manufacturer-backed factual catalog preparation. Neither specifies a manufacturer license for every factual checklist name/number.

The blanket manufacturer-license requirement was introduced by implementation commit `945812ca`: `prepare-pilot.mjs` required `licensed`/`permission` for every manufacturer PDF and withheld a review packet without it; `setCatalogEvidenceMedia.ts` used the same grant shape for sources and images. This combined factual provenance, internal app access and image reuse into one field. Source-file possession is not converted into an ownership claim by this correction.

The shared lookup returns reviewed card/program/printing facts with source URLs, hashes and opaque references. It does not send PDF bytes. The Atlas service media operation accepts a current publication plus `imageId` and returns only a verified reference image. Private source files remain accessible separately to authenticated human reviewers through the existing admin review route.

## Explicit formats and compatibility

| Input/record | Behavior |
| --- | --- |
| Existing unversioned review evidence with source `grant` records | Remains the legacy path and emits `setops-catalog-verification/v1`. |
| Stored `setops-catalog-verification/v1` | Same strict source/image grant shapes, consumer semantics and canonical hash. No fields are inserted, converted or rewritten. |
| New `setops-catalog-review-evidence/v2` | Each source has an exact `factUse`; images retain the existing image `grant` schema. |
| New stored `setops-catalog-verification/v2` | Binds those source uses, unchanged image grants and all verified artifact bytes into the existing full verification hash and human publication record. |

Each v2 source still names `sourceId`, `taxonomySourceId` and `classificationNote`. Its `factUse` contains:

- `purpose: catalog_facts`;
- `sourceSha256`, which must equal that exact manifest source hash;
- a bounded factual-scope `detail`;
- the explicit intended `inventory`/`atlas` consumer roster.

Unknown versions, missing/duplicate/extra sources, wrong checksums, unknown consumers, duplicate consumers, ownership/grant fields inside fact use, and mixed v1/v2 source shapes reject. Source fact use does not authorize image bytes, original-photo sharing, source-PDF distribution, public access or publication without a human reviewer.

The old source grants remain genuine recorded grant-shaped evidence, with their original semantics. The new format does not reinterpret them as fact use or backfill any current publication. The v1 regression fixture retains canonical SHA-256 `a988de570ef4929ba6cfe04c910a1f9acdaca1931ff3e2d6bda62c2ba9a2c537`.

Image grant fields and permitted bases (`owned_original`, `licensed`, `permission`) are unchanged. A fact-use roster cannot replace an image-grant roster. Consumer restrictions continue to apply to every proposed image; no response silently removes an ungranted image from a reviewed manifest.

## Human review, storage and access remain intact

The actual preview and publication functions still:

1. Require the existing enabled catalog boundary and a current authorized human reviewer/approver.
2. Read the exact private staged source/image bytes, verify hashes and bounded artifact sizes, and fully decode proposed images.
3. Validate every canonical program/card/parallel/scope/source ID and exact source classification/URL.
4. Require the latest clean draft version, current/history pins and explicit publication acknowledgement.
5. Bind both complete manifest and verification hashes to the server reviewer, approval, immutable publication and audit record.

The change does not introduce an endpoint, app capability, database migration or writer. There is no source-PDF operation in the Atlas service. A source reference/source ID sent to the image operation fails without reading source bytes. Existing observation review and private-image lineage rules continue to apply.

The review panel now names source-fact use separately from image reuse grants and explains that fact use does not assert ownership or authorize source-file distribution. Packet loading and preview do not publish; deliberate human acknowledgement remains required, including facts-only packets with no images.

## Pilot preparation

Two small concrete proposals are supplied:

- `sports-source-fact-use.proposed.json`: the pinned checklist and Round 2 odds sources; only the selected identities and Big Kahuna program vocabulary/denominators are proposed. Exact card/printing applicability remains unknown.
- `pokemon-source-fact-use.proposed.json`: the pinned checklist's factual identity/program scope. No image ownership or distribution is asserted.

Both name Inventory and Atlas as intended fact consumers, retain the exact existing source hashes, and declare `authority: unreviewed_proposal_not_legal_attestation`. They are preparation inputs, not evidence of completed human review.

The compiler accepts `sourceFactUse` or CLI `--source-fact-use FILE`. It requires the exact proposal version and complete source/hash roster. The mutually exclusive `grants` / `--grants` path remains for explicit legacy source-grant packets; it is no longer a prerequisite for the factual-use path. No missing canonical source/parallel/scope ID is bypassed or invented. The compiler does not approve evidence or submit the review packet.

Example after a genuine authenticated taxonomy export and exact selection are available:

```sh
node docs/plans/catalog-pilot-20260916/prepare-pilot.mjs \
  --pilot sports \
  --taxonomy AUTHENTICATED_TAXONOMY_EXPORT.json \
  --selection EXACT_CANONICAL_SELECTION.json \
  --source-fact-use docs/plans/catalog-pilot-20260916/sports-source-fact-use.proposed.json \
  --out NEW_PRIVATE_OUTPUT_DIRECTORY
```

The additive sports source/printing lifecycle remains separate: this correction neither runs the eight-create proposal nor solves its pending-ingestion visibility/approval coupling. The 171 unnumbered checklist rows are not a new prerequisite for the three-card pilot.

## Validation and scope

Credential-free Node 22 runs, with only in-memory delegates and local source files:

- **27 runtime/UI checks passed** across the new source-fact-use suite and existing media, current-eligibility, observation-review and review-panel suites.
- **13 pilot compiler checks passed**, including both factual-use proposals and wrong version/hash/roster/consumer/ownership/mixed-mode controls.
- Scoped ESLint passed on all changed code/tests.
- Syntactic and semantic diagnostics for the four changed TypeScript files: **zero**. This is not a full application typecheck or build.

The new tests exercise the real preview/publication/lookup functions, unchanged legacy v1 hash/parsing, exact source binding, actual consumer denials, image-grant substitution rejection, reviewer/taxonomy tampering, immutable verification tampering and Atlas source-PDF rejection. In-memory delegates do not establish database concurrency or production acceptance; those mechanisms were unchanged.

Logs remain outside Git under `/private/tmp/tk-sports-reconciliation-20260917.PGawem/`: `source-fact-use-runtime-tests.log`, `source-fact-use-compiler-tests.log`, `source-fact-use-runtime-lint.log`, `source-fact-use-compiler-lint.log`, and `source-fact-use-scoped-types.log`. The initial new-suite log is retained too.

No network, provider, database, upload, source import, real approval/publication, deployment, shared engine/research edit, migration, dependency change, flag change, install, full build or commit was performed by this lane. Feature-flag values used inside fixture processes are local test setup only.

## Independent review and rollback

Independent read-only review of the exact nine-file slice and actual publication/auth/Atlas-media callers passed with no actionable defects. Once a v2 verification is published, rollback must retain a v2-capable verification reader; older v1-only readers reject it. Disabling optional use does not downgrade immutable records.
