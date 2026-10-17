# ATLAS whole-number final awards — implementation and release audit

**LIVE.** Application source `c68e9ea7c77b35fc53cab6ee162e063dfb02b0fe` was published across native main/worker and staff, customer and public web on October17,2026 at11:02:25.779UTC. All66 canonical route/asset checks passed. The claim holder was explicitly released at11:03:40.056UTC; postflight and native health passed. Actual authenticated-card UI acceptance remains pending owner sign-in.

New unapproved final reviews use `atlas-final-whole-point-v1`: round the precise raw overall score directly to the nearest whole number, with exact halves rounding up. Examples: **8.35 → 8; 8.5 → 9; 9.5 → 10**. There is no intermediate one-decimal or half-point rounding.

Refresh an existing unapproved card and reopen its final review to obtain the current preview. Approve only that current preview; an older preview hash must be refused. A retry of an already committed approval still replays its original result. The observed pending Jaxson raw score **7.64684128229908** produces **8** under the deployed policy; confirmation in the actual authenticated production UI is pending sign-in. The actual Chrome tab reached staff sign-in after refresh; see the retained `browser/live-sign-in.png`. The local browser proof used explicitly synthetic photographs and evidence that derive the same raw score; it is not a physical regrading of Jaxson.

Approved historical reports remain immutable under their recorded `atlas-final-half-point-v1` policy. A matching saved approval loads and verifies its original report, hash and award; it is not silently recalculated. Measurements, continuous category scores, front/back weighting, thresholds and precise overall math remain unchanged. Category half points remain valid.

The default **black ink + transparent foil** label remains available with automatic label preparation and the original export option. Finishing reads the recorded award without rounding it again. Existing READY reprints, stored artwork bytes and NFC/report bindings remain preserved.

Protected source SHA256 values match both the prior deployed source and this frozen source:

| File | SHA256 |
| --- | --- |
| `packages/atlas-grading-core/src/scoring.ts` | `fe58ff9d0f24c28ee6bc110b76cd6666423fe8f848f1d5bfbbf610190a01e8fd` |
| `packages/atlas-grading-core/src/atlas-policy.ts` | `7b4c813ac8ff10f67bb03244e97b311eff650ee120f7ad2f55e819b18076ad14` |
| `backend/ai-grader-speedster-service/manual_measurement.py` | `4980093ee4a815b139296cc431c8195929dfcd2be41f45b902b69ee051ad1d0e` |
| `backend/ai-grader-speedster-service/defect_math.py` | `5e4207d623c8ff237df6f528c1c94cf103fbc572b84c56f08bedda9990dc5ec8` |

Qualification completed before publication:

- Native isolated requalification: **529 passed, 0 failed, 0 skipped**. [Independent receipt review](/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/release-01/native/requalification/independent-result-review.json).
- Staff suite: **743 passed, 0 failed, 0 skipped**. [Test log](/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/staff-tests.txt).
- Staff, customer and public local production builds passed. All three actual candidate receipts independently verified 2,602 source files each, including 56 current source GETs and 2,546 retained qualified files. Served JavaScript contains both current and historical policies; retained label features also passed. The customer candidate correctly retains its direct-host 403 unavailable boundary; this does not establish authenticated customer access. [Three-zone crossreview](/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/browser/candidate-qualification-crossreview.json).
- Actual FinalReportReview component fixture: **4/4 passed**, desktop and phone, synthetic current 8 and historical 7.5, exact images verified and print preserving report hashes. [Fixture result](/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/browser/result.json).
- Reviewed test-only correction: `batch-preparation.test.mjs` now asserts unchanged raw **8.5**, current whole-point policy, and proposed **9**. The physical damage **.04** and surface score **4** assertions are unchanged; the narrow file passed **35/35**. Corrected test SHA256: `a0280c81b6a4e954308e665b04381067a4f916cd041a62203a5b384315fc1ae9`. Deployment runtime source remains frozen at `c68e9ea7`; the test correction is included in the documentation/test follow-up; it does not change the deployed runtime. [Exact patch provenance](/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/browser/batch-preparation-test-correction.json).

## Observed release evidence

The evidence packet is `/Users/markthomas/.codex/atlas-handoffs/atlas-whole-grade-20261017/release-01`. Receipt hashes are SHA256.

| Check | Receipt / hash |
| --- | --- |
| Exact-image native qualification,529 passed/zero skips | `native/requalification/requalified-result.json` — `1e41da795bda2fb5e8c8dc6442b595ccb64736048bac4e1409ab1011e0d0d627` |
| Atomic six-control apply | `data/data-result.json` — `fd12c0049b9ea48b5b62e98c7a50e9a1498eff148eda0fbcacaafde88381e29e` |
| Native start | `native/start-result.private.json` — `c924dcf8ffe31db3d86f01d460c334cf3c6d3a14ff7a3cfcd884470593b88364` |
| Native seal | `native/seal-result.private.json` — `433c5cf842b2dd646ea6543a1db741ad6cec0d705fb319825cb0a8934c332a54` |
| Independent five-step publication review | `qualification/release-prep-publication-review.json` — `3efdaa9687462a20eaea635d375adf190071fe46b025c36f1cde5b303514ae71` |
| Canonical66 routes/assets,11:03:23UTC | `web/checks/canonical-01-result.json` — `0b97b1e5cc57afc9369c56b1c4d08c8e4c8094a4855a5656eae43563ca22f795` |
| Same holder explicitly released,11:03:40UTC | `admission/released.json` — `44e8d70a242e325f3bc11b1f82b1860e61b3369ec503c45853b56c0de92a843a` |
| Data preserved, holder absent,11:03:52UTC | `postflight/postflight-01.private.json` — `ef8f7904dae4268e8f1bd49dfef57510627e1dc74c9a3e89bdfbe0f1c14b7b78` |
| Exact healthy native runtime,11:03:54UTC | `native/health-postrelease-01.private.json` — `2b471354261e12dc5cebd62aae8c52fac2dc2e475b3447b37b66dbadc6e49daa` |

The41 current cards and zero approvals were retained. Discarded rows, prior READY market results and label requests remain intact. No card was restored, approved, regraded through a provider or deleted by this release. The six control updates are Staff134, PublicReader94, Customer83, StaffSMS102, CustomerSMS35 and the exact CustomerService deployment/source binding. Zero DDL or ledger writes; installed005/006/007, all seven ledger rows and105 protected tables remain unchanged. Native inventory29containers/3running, zero new restarts, retained125-second startup fence and unchanged proxy/security/resources.

Before shutdown, an existing reference lookup was allowed to finish naturally:563/563 readings persisted on its original attempt. The same bounded admission holder was retained throughout; no paid request was interrupted or replayed. Web publication initially encountered an expired CLI token on a read-only GET before any effect intent; the routine existing-login refresh resolved it. Staff promotion returned201 before aliases settled; read-only finalization verified the original accepted operation with zero requests sent. Failed qualification and consumed effect evidence remain preserved, not rewritten or replayed.

Canonical `/account` returned200 and available through the public router. The direct customer candidate's403 host-boundary response was preserved honestly during qualification and did not weaken the canonical availability requirement. Current and historical grade-policy assets are verified for all three zones; automatic-label, black/transparent, original-format and NFC feature bytes are retained. These checks do not claim a human approval or authenticated report-export acceptance. No new production approval or physical print was performed.

## Existing pending cards

An ordinary full browser reload loads the new application and clears the old in-memory report preview. Reopen **Review card → Grade**. When the saved human geometry/findings confirmations are already complete, the workspace fetches a new report preview automatically and resumes Grade. Otherwise complete only the remaining human review checks. The Grade action fetches a fresh no-store preview. No photograph retake, provider analysis or manual grade override is needed.

A retained batch machine proposal may still show its original half-point award with the earlier-rounding notice. It is saved machine evidence, not the current human final preview. Background queue polling does not replace an open review; reload/reopen once after publication. Already approved historical cards remain under their original policy.

## Rollback compatibility

After a new whole-point approval exists, readers must continue supporting `atlas-final-whole-point-v1`. Do not roll back to a half-only reader that rejects newly approved reports. Historical policy verification remains necessary. Every consumed release effect is retained as evidence and must not be replayed.

## Printing scope

Automatic Sports and Pokémon label preparation and the default black-ink/transparent-foil export from the prior label release are retained. Individual PNG canvas remains68.342×20.082mm (6458×1898pixels); the50-position jig remains310×400mm (9764×12598pixels). Physical E1 scale/origin, coverage, fine detail and adhesion still require an actual sample on gold and holographic material. Software verification does not constitute a physical print qualification.
