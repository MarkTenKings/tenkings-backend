# Reviewed Sports identity and proposal qualification

October 20, 2026. This audit covers the next-R1 identity increment in the foundation worktree on top of reconciled source `c4b7cc85f01754eb5776042147e6c0fdf50f845a`. It is separate from the frozen archive-only release-02 artifact. The archive release excludes these identity changes and the separate provenance migration 009. This record establishes local source and synthetic qualification, not production activation or optical recognition accuracy.

## Implemented identity boundary

Sports identity now accepts an optional `sportsAttributes` block with version `atlas-sports-attributes-v1`. Omission remains omission for historical identities; there is no default injection into old JSON, approval hashes or label inputs. Pokémon identity and shared Ten Kings identification defaults are unchanged. The new pure schema lives in `packages/atlas-grading-core/src/sports-attributes.ts`, re-exported by the existing identity entry point. The extraction manifest records the intentional identity-contract change.

The facts distinguish:

- Exact printed copy serial, such as `007/099`, from numeric numerator 7 and denominator 99 and from checklist card number `007`. Leading zeros and printed internal spacing are preserved. Numerator and denominator must be positive, bounded integers, and numerator cannot exceed denominator.
- Autograph presence from type: unknown, on-card, sticker, cut or facsimile. Presence does not establish authentication. Unknown/not detected is not absence.
- Each relic window's position, material, exact readable manufacturer statement and use/wear classification: unknown, game-used, player-worn, event-worn, not associated, or unspecified. A use/wear classification requires the actual manufacturer statement; the schema does not infer it from a material.

Private facts carry per-side observations with `side`, `imageSha256` and observation text. Present facts require supporting Front or Back evidence. Reviewed absence requires both sides. Every relic window has its own evidence, and window positions are distinct. Unknown facts stay unknown without manufactured evidence.

The existing authenticated `IDENTITY_EDIT` action supplies human authority; the client block contains no actor or self-declared authority field. The workflow rejects a machine principal attempting to save reviewed attributes and verifies every observation against the current geometry's original photograph hash. A stale hash fails without commit. The ordinary identity revision changes; geometry, findings and measurement receipts remain saved. Source replacement clears attributes only from the new draft and increments its identity revision. Prior action, approval and report snapshots remain intact.

The existing editor exposes the optional fields inside the normal Card details workflow. It supports evidence from either side, exact serial entry, separate relic windows and explicit correction. The existing save/CAS/recovery path is retained. Legacy/minimal workspace snapshots without a draft/source render normally and do not expose a proposal whose current source binding cannot be established.

## Machine proposal and human review

New ATLAS identification attempts use `atlas-identification-layout-v5`. Its additional structured model output requests serial, autograph and relic observations from both supplied image slots and OCR. It preserves all eight descriptive fields and the existing layout/recognition behavior. The new instructions explicitly distinguish unknown from absent, checklist number from copy serial, observed material from use/wear, and visible signature from authentication. No provider calls were made to qualify this change.

The retained proposal uses `atlas-sports-attributes-proposal-v1`, `authority: MACHINE_PROPOSAL`, the exact input subject/source hash, both actual identification-image hashes, per-fact confidence and evidence. Those hashes describe the actual identification derivatives. They are not relabeled as original intake image hashes. The parser rejects invented/stale image binding, unsupported fields, machine claims of absence and present claims without evidence. Non-Sports output carries no Sports proposal.

The details-adoption path still copies only its supported descriptive fields; `gradingIdentity()` does not adopt the new Sports claims. In the review editor, an explicitly selected proposal copies facts into an editable draft and clears all machine observations. Saving present facts then requires the reviewer to record observations against the current saved photograph hashes. A proposal from another source revision is hidden. Existing reviewed attributes are not silently overwritten by a later proposal.

## Private and public projections

New approval snapshots retain the full reviewed private identity and its evidence. Public reports use a separate `atlas-sports-attributes-public-v1` projection containing approved card facts only. Staff observations, source image hashes and actor/authority details are excluded. Public projection clones the identity and does not mutate the full approved snapshot; regression checks retain the original report, approval bytes and hash. The public packet's own approval binding establishes the version of the facts.

Staff and public report detail rows show the exact printed serial, autograph presence/type and each relic window's material/use/manufacturer statement. They do not expose private observations. Existing grade arithmetic, final award policy and retained label artwork are unchanged. Historical published packets remain their saved bytes; this increment does not republish or recompute them.

## Historical identification compatibility

ATLAS identification results v1 through v4 remain readable under their recorded versions. Previously stored v3 and v4 rejected requests retain their existing retry execution, rather than acquiring the new v5 field or prompt. Older unsupported retry cases remain subject to their existing restrictions. The broad adoption tests continue to cover shared V1/V2 historical receipts, source-change fencing, rejection recovery, unknown outcomes and idempotent replay.

For an additional byte check, the original `identification-layout.mjs` was loaded from reconciled commit `c4b7cc85` and run with the exact synthetic pair/OCR/model fixtures now retained in `test/identification-sports-attributes.test.mjs`. The current implementation reproduces those original request hashes:

| Recorded engine | SHA256 of exact serialized model request |
|---|---|
| `atlas-identification-layout-v3` | `5a09e1799a90cbdeaa2bef9638aa40ea622d343a56d473fe666160f8ffec0af5` |
| `atlas-identification-layout-v4` | `2710f828006abb4061be5972cabbe64d6a9fb72a0d4addf11e78a46aab42aa80` |

The temporary original-source comparison modules were removed after capture. The regression also checks that v3/v4 schema/result output has no Sports proposal and that repeated serialization is stable. These hashes refer to the documented synthetic input, not a production customer's request.

## Query and comp semantics

The reconciled live shared identity query remains the basis: manufacturer, year, complete set name, player/card name and checklist number, followed by `psa` and the exact persisted approved grade for automatic retrieval. An example new identity query is `Fixture 2026 Full Sports Set Synthetic Player #007 /99 auto psa 9`. It uses the edition denominator, not copy numerator 7. Existing saved queries and saved inputs are replayed under the established compatibility rules; identities without attributes preserve the live query behavior.

Only reviewed attributes add `/denominator`, `auto` (and `facsimile` when explicitly reviewed) or `relic` terms and the existing supported provider variant fields. Explicit research retains its separate query/provider path; no automatic fallback or extra provider purchase was introduced. Slab-label targets include the new approved facts and a distinct target key so a catalog-only cache result cannot silently certify new attribute distinctions. Only the public fact projection enters those targets.

New-attribute comparisons distinguish missing evidence from contradictions. Explicit wrong denominators, numbering against reviewed absence, autograph types, materials and manufacturer use can exclude guidance. Ordinary “PSA label” or “grading label” text does not imply a sticker autograph. Negated statements such as “not game-used,” “not player-worn,” “not an autograph,” “not on-card,” “not a relic” and coordinated negative use phrases cannot establish the corresponding positive match. Source evidence remains unchanged.

The first increment deliberately stays conservative:

- Aggregated text cannot establish which material/use belongs to which of several relic windows. Multiple-window associations remain unknown even when the overall sets happen to match.
- Unrecognized material vocabulary and missing/ambiguous attributes remain unresolved. The matcher is not a complete manufacturer-language or visual-identity classifier.
- For new reviewed-attribute guidance, lots, reprints, unknown/upper-bound accepted-offer amounts and insufficient price evidence are not recommended. Staff-selected reference evidence still follows the existing explicit review path; no new price, appraisal, automatic selection or valuation is generated.
- Optional selection of one to five curated comps and complete marketplace pricing policy remain separate master-plan work.

## Qualification evidence

All commands used local source, synthetic fixtures and existing installed dependencies. No production database, provider, payment, printing, NFC, ownership or publication effect was performed by this lane.

| Qualification | Result | Evidence |
|---|---|---|
| Focused identity/workflow/publication/query/market/proposal/legacy/report/editor suite | 160/160 passed | `/tmp/atlas-sports-final-tests.log` |
| Final comp/presentation regression after conservative negation/material guards | 27/27 passed | `/tmp/atlas-sports-final-comps.log` |
| Actual mounted workspace compatibility after optional-source correction | 69/69 passed | `/tmp/atlas-sports-workspace-tests.log` |
| New editor/helper scoped lint | No warnings or errors | `next lint` on ReviewIdentityPanel, SportsAttributesFields and review-identity helper |
| Root's complete staff suite | 773/773 passed | `/tmp/atlas-marketplace-foundation-checks/next-r1-staff-tests-02.log` |
| Root's staff production build/boundary | Passed | `/tmp/atlas-marketplace-foundation-checks/next-r1-staff-build.log` |
| Final complete connected suite, independently run | 900 tests; 898 passed, zero failed, two existing native measurement environment skips | `/tmp/atlas-marketplace-foundation-checks/r1-connected-final2.log` |
| Source whitespace check | Clean | `git diff --check` |

The complete connected result and source hash checkpoint are documented in [the next-R1 integration audit](next-r1-integration-qualification.md). The staff build preceded the final native-only comparison guards; no browser source changed after that build.

Root reported browser qualification of the actual `ReviewIdentityPanel` and `SportsAttributesFields` compiled by `frontend/atlas-app/scripts/sports-identity-fixture.mjs`. The loopback fixture uses conspicuously synthetic text and persistence, not real card photographs or provider results. Its server invokes the actual canonical identity parser and original-photo evidence validator and exposes the exact saved action for inspection. Root verified:

1. Adopting a machine proposal does not save it; Save details rejects missing human observations.
2. Recording the Back observations saves one `IDENTITY_EDIT` with exact `007/099`, numeric 7/99 and STICKER. Human evidence is bound to original Back hash `b` repeated 64 times, while the machine derivative hash `d` repeated 64 times is excluded from the saved observations.
3. The save performs no grading or publication action. Summary displays the saved facts.
4. Desktop and 390px/320px layouts remain usable without horizontal overflow; the fixture background is pure white.
5. A fresh Edit → Cancel sequence returns to the saved summary, records the visible `edit → cancel` fixture audit and restores focus to Edit card details.

The synthetic local fixture is not evidence of real authentication, production availability, genuine autograph authentication, real manufacturer statement recognition or a live customer's card. No deployment claim is made here.

## Ownership and next step

The identity lane changed only its agreed schema/workflow/identification/query/report/editor files and tests. The provenance subsystem, SQL 009, Card history page, release runners, commit and SESSION_LOG are owned by the other assigned lanes/root. Root retains the final commit, release selection and deployment decision. Future optical qualification should use authorized real paired evidence and retained provider receipts before claiming recognition performance.
