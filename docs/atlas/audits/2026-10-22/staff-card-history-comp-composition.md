# Optional Card History comp browser composition

The graded-card page now requests the existing authenticated page-access display hint explicitly and enables curation only when `compCurationConfiguredForDisplay === true`. The hint is configuration presence, not authorization. Its server mapping/runtime remains separately root-owned; no flag, route, role, provider or deployment was activated by this browser slice.

## Exact source scope

- `frontend/atlas-app/pages/graded-cards/[cardId].jsx` — preserves reviewer/manual/unavailable gates; effect-owned optional browser composition passes the existing CardHistory props. SHA256 `5e0d9208ff1b4783b7bf748534e32d5cb4ab9f53d3694c2305134af74c49ac07`.
- New `frontend/atlas-app/lib/card-history-comp-curation.mjs` — actual existing Response transport, fixed staff/card lifetime, explicit fetch, no import work/default fallback. SHA256 `b55d7e071bdbd281d3eb1fdd38e5fb5471dd3314b503e4c75fdcbeb6103c9f51`.
- New `frontend/atlas-app/test/card-history-comp-curation.test.mjs` (`fd560660e377b2c13a36ba08d054e5651c74f7f647200e6cdc7ed2498e22eaa6`) and `card-history-comp-curation-page.test.mjs` (`b9245282a649a37a96f10ab5e6a989ad4430fb49258db08db1d00d496c21becc`).

Ordinary renders retain one request capability and the existing CardHistory instance. Staff object/identity/mode, card or flag changes hide the old capability before effects; cleanup, pagehide and unmount close it and cancel pending reads. StrictMode replay creates a fresh live effect context without reviving old handlers. A page-hidden lifetime remains closed even if its display flag is toggled. Actual session checks, actor/CSRF validation, response limits and current-card checks remain in the existing transport and downstream service.

Saved pool/curation reads remain available through their exact existing paths. This composition only authors Skip or No suitable comps with `expectedPolicyHash: null`; it cannot select comps or manufacture price guidance. It does not acquire new comps, retry a write automatically or claim that page closure rolled back a saved decision. Existing uncertainty/recovery handling and original report/pool bytes remain unchanged.

## Observed qualification

Evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/page-composition-qualification-01/`. `qualification.json` SHA256 `2ba25b2f2817550dbe4886c450d71900f56cd8f9b8a19c660cc0ac99ffc8aac4` pins21 explicit current/saved direct sources and four evidence files; this is not a full vendor/transitive closure.

- Initial11 new tests passed. After the exact SSR option amendment, the combined focused run passed54 groups, including all11 new groups, with zero skips. One retained Response-transport test file could not load because parallel root HTTP integration referenced a factory not yet present at that instant. The failure is preserved in `focused-tests.log`; it is not described as a passing combined run. Root owns final integrated qualification after that factory is complete.
- Scoped ESLint exited0 with an empty saved log. Source diff whitespace check passed.
- Tests exercised the real helper/Response transport/client and unchanged native service/HTTP with synthetic saved artifacts and transaction boundaries. They cover null-policy reads/Skip/No suitable, exact source preservation, cross-card/acquisition/selected-policy refusal, observed delayed-response teardown, no replay, exact SSR flags, stable capability, pre-effect hiding, StrictMode replay, pagehide and unmount.
- Page JSX tests use a focused hook harness and stub CardHistory/Shell; retained actual CardHistory/panel tests are separate. No new DOM/browser/build/PostgreSQL/provider/storage qualification is claimed. Prior joined CardHistory browser and restricted-role receipts remain historical downstream evidence, not a new full-page acceptance.

No grading engine, review workflow, prompts, scoring, approval, SQL, shared server/runtime/gateway or production setting changed in this lane. Independent source review and root combined build/browser acceptance are recorded separately when available.

Independent ownership source review PASS on envelope2ba25b2f: all21 current/saved refs and four evidence hashes match; exact SSR gate, account/card/lifetime fences, null-policy decision allowlist and no replay traced without rerun or effects. Root combined build/browser remains separate.
