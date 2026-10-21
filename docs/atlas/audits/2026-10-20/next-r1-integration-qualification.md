# Next R1 integration qualification

This is a local integration checkpoint for the uncommitted next-R1 work on top of `c4b7cc85f01754eb5776042147e6c0fdf50f845a` in the foundation worktree. It combines the authenticated Card history/provenance read with optional reviewed sports attributes and identification v5 proposals. It is separate from the frozen archive-only release-02 source, which excludes these changes and migration 009. This evidence does not establish production deployment or completion of all R1/master-plan work.

The final source checkpoint contains 56 changed or new frontend/package source and test files. Their byte hashes are recorded in `/tmp/atlas-marketplace-foundation-checks/r1-source-checkpoint-final.json`, SHA256 `1bc4218cf5d9f2ecb31bbfdcf252e0b3bea71c2f524acbe6fa57a43163548ee3`. It was captured after the identity owner's explicit source freeze and final complete test run. Documentation and SESSION_LOG are outside that source checkpoint. The final source includes all reviewed comp-negation corrections and the conservative unresolved-material guard; the identity owner confirmed that the existing core build remained current.

## Final automated results

| Scope | Result | Evidence |
|---|---|---|
| Complete connected-manual suite | 900 tests: 898 passed, zero failed, two existing skips | `/tmp/atlas-marketplace-foundation-checks/r1-connected-final2.log` |
| Complete standalone-database suite plus Card history client/actual-component tests | 14/14 passed, zero skips | `/tmp/atlas-marketplace-foundation-checks/r1-database-history-final.log` |
| Root's complete staff suite | 773/773 passed, zero skips | `/tmp/atlas-marketplace-foundation-checks/next-r1-staff-tests-02.log` |
| Root's staff production build | Build succeeded; `STAFF_BUILD_BOUNDARY_PASS` | `/tmp/atlas-marketplace-foundation-checks/next-r1-staff-build.log` |
| Actual PostgreSQL DTO through the staff client | Passed, including exact safe URL admission | `/tmp/atlas-marketplace-foundation-checks/r1-postgres-client.json` |

The two connected-suite skips are the existing native measurement tests requiring the configured measurement Python environment: “native isolated reports preserve exact measurement receipts, traces and grades” and “native CPU measurements, traces and exact grade survive current human approval without a model reread.” They are not counted as passes. The staff boundary checked 29 browser chunks, 15 server traces and 2,007 traced files, including both `/graded-cards` and `/graded-cards/[cardId]`. The connected suite was run after the last comp correction; the recorded staff build is root's preceding build. Root retains responsibility for a new build if later adapter/source changes require it.

The final connected log SHA256 is `e99072a86f8147dd3b3dc9d1f4de1e2c428a6703349c45775028746093c84212`. The database/history log SHA256 is `d294156811dbd12ffe743007ae7aeacd3cc70520f6d207aef1306a6cf797f064`. The client-integration receipt SHA256 is `c0f0893662b92a149316c558254f86bf0e810932f524295c3ca37a037ba1d3a4`.

## PostgreSQL-to-client integration

The input is the actual synthetic output of the owned PostgreSQL 17 qualifier, not a separately handwritten UI DTO: `/tmp/atlas-marketplace-foundation-checks/provenance-postgres-final2/synthetic-card-history.json`, SHA256 `4a24760a129bcc94d5ee300d4b228aaf786874561ff33d6f1b6987e692c43f24`. Its eight events include two published report versions; the selected current report is version 2.

The real `readCardHistory` accepts the DTO for its exact card. `approvedReportPath` and both `historyPhotoPath` sides return precisely the selected token/version. Each published event's `historyReportPath` points to its own report version, and approval/custody events receive no report URL. The actual helpers reject external and protocol-relative URLs, a foreign report token and a changed version. Removing Back yields no Back URL while retaining Front; a pending publication yields neither photo. A wrong card is rejected, and pagination merge rejects an approval swap. Unknown ownership and unconfirmed physical holder remain intact.

The underlying local database proof passed seven groups, including immutable source records, session/card-ACL revocation, fixed-snapshot pagination, later publication without approval mutation, customer-role denial, no private table SELECT and exact additive 008→009 upgrade/no-op. See [the provenance audit](card-provenance-foundation.md) for the source contract, migration checksum and full database results. These client checks made zero database/provider calls; they read the retained synthetic fixture locally.

## Browser checks reported by root

Root reported the following checks against the local browser fixtures; this addendum records their reported result rather than claiming a second independent browser run:

- Card history at desktop width 1,440 and mobile widths 390 and 320 had no horizontal overflow.
- Missing Back displayed the explicit photograph-unavailable fallback; Front remained available.
- A 503 read failure exposed retry, and retry recovered the saved history.
- An access-ended event cleared private state while a read was pending; the late response could not repopulate it.
- Adopted sports proposal facts could not be saved until the reviewer supplied the required Back observations. The exact printed `007/099` was preserved separately from numeric numerator 7 and denominator 99, and saved human evidence used the original Back photograph hash.

These checks cover the intended local interaction and error paths. They do not prove live account access, production image availability or possession of a real card.

## Review findings resolved in this checkpoint

The independent review found and the identity owner corrected three unsafe comparison shortcuts: an ordinary grading “label” no longer implies sticker autograph; aggregate relic material/use sets cannot mark multiple differently associated windows as a match; and explicit copy numbering contradicts a card reviewed as unnumbered. Negated manufacturer statements such as “not game-used,” “not player-worn” and coordinated negatives cannot establish the positive use classification. Missing or ambiguous evidence remains unresolved.

The reviewed source preserves exact private photo evidence while public projection removes observations and source hashes. Identification v5 proposals retain their derivative-image provenance and machine authority; adopting proposed facts into a human draft clears the machine observations rather than relabeling them as original-photo evidence. The authenticated identity-edit path checks original image hashes, and source replacement invalidates reviewed attributes. Historical v3/v4 request interpretation and retry behavior remain versioned; optional attributes do not rewrite historical approvals. Variant confirmation preserves existing reviewed attributes. The current live PSA query spelling remains retained, with new reviewed attributes added only where present.

## Remaining scope

The history read is authenticated staff functionality. Its public redaction helper is not a public endpoint, publication consent or ownership authority. Current physical holder and ownership remain unknown; claim, transfer and reholder writes are unavailable pending reviewed authority and business rules. Customer/public history integration and the broader collection/marketplace work remain separate increments. No production, provider, payment, ownership or customer-data effects were performed for this qualification.
