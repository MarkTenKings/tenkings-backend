# Collection privacy and bounded price-evidence preview

October 21, 2026. Local source on `codex/atlas-marketplace-foundation` only. This work is separate from the dedicated detail/SQL009 release. No customer route, endpoint, grant, migration, deployment, provider search, notification, listing, payment or ownership record was activated by this lane.

## Scope and source contracts

The actual customer application is `frontend/atlas-customer`. New components and pure modules use its existing React/Next dependencies, without package or lockfile changes. The implementation adds:

- `lib/collection-contract.mjs`: a bounded, allowlisted owner display parser and reversible settings preview.
- `components/collection/MyCollection.jsx`: current verified collection, name/certificate search, exact-version grade-report links, and clearly marked local privacy/offer previews.
- `lib/sold-comp-curation.mjs`: optional one-to-five selection, Skip/No suitable comps, conservative eligibility and explicitly proposed arithmetic explanation.
- `components/collection/PriceEvidence.jsx`: isolated curation preview and method/sample/date/range explanation, with no persistence or provider capability.
- `components/collection/collection.module.css`: white/emerald responsive layout with semantic labels and focus states.
- Three focused test files and `test/collection-preview-fixture.mjs`, which contains explicitly synthetic records only.

The ownership lane and this lane agreed the server exports `projectOwnerCollectionCard` and `projectCollectionPreferences` in `packages/atlas-connected-manual/src/card-ownership-contract.mjs`. The customer parser accepts the exact `atlas-owner-collection-v1` envelope and the `atlas-owner-collection-card-v1`/`atlas-collection-preferences-v1` records. Every shown card must be VERIFIED for the expected current account, with positive title revision and exact approval action, certificate, permanent report token, version and public hash. Staff access, submission customer, recorded custody, certificate knowledge and NFC never create ownership. Unknown/non-owner records do not become collection cards. This parser is a display check, not authentication or title evidence.

Collection and card visibility are separate saved choices; effective collection visibility must agree with both. All graded-card offer preferences default OPEN_TO_OFFERS unless the owner disables the collection or card. Neither visibility nor preference enables delivery. The current contract requires `canReceiveOffers:false` and `notificationDelivery:'NOT_REQUESTED'`; it rejects invented enabled/sent states. Recorded custody stays separate, and the current physical holder remains Unknown. Existing public grade-report availability is not changed by collection privacy.

The optional display join accepts title and grade only when card ID, approval action and the complete report binding agree. No contact details, staff fields, custody addresses or raw record blobs are forwarded. Public/customer publication of ownership history and handles remains future work. A supplied `renderCardMedia(card)` callback is display-only, receives the validated card projection, and must use a separately authorized exact-approval media reader; this component performs no media request.

The UI rejects changed account/access bindings before rendering old metadata, scopes private search text and pricing decisions to the current account, drops local draft applicability on ownership/preferences/report revisions, and removes private content on pagehide. The pricing component requires a current account scope as well as the separately authorized saved-source input; this scope is for display cleanup, not server authorization. Controls are expressly preview-only; there is no Save, Make Offer, Buy Now, email action or browser-storage persistence. A non-null pagination cursor is shown as a partial page, never as a complete collection count. The bounded component accepts at most 200 supplied rows; the current server proposal pages at most 50.

## Curation and explanation

The saved-evidence wrapper is `atlas-saved-comp-source-v1` with card ID, approval action, preview ID, source hash and the existing `atlas-market-preview-v1` or `atlas-market-preview-v2` shape. The underlying source must be EBAY_SOLD / `ebay-sold-comps-v2.3.0`. The caller must fetch this from an authenticated saved-source reader and verify the stored source hash server-side. A hash supplied by a browser is not authenticated evidence; this pure preview does not perform cryptographic integrity verification or authorize a save.

The requested card/approval/report token/version/hash must agree. One to five unique eligible references require an explicit local reviewed selection. Skip and No suitable comps return a null guidance result, never a zero value and never a report-approval gate. The input preview and grading packet are not modified.

Guidance excludes uncertain or contradictory identity/printing/Sports evidence, lots/bundles/reproductions, unknown accepted-offer amounts, missing/unsafe/nonpositive prices, unavailable currencies/dates/links, dates later than the source observation, and sales outside the explicitly supplied recency window. Candidate selection remains visible, including exclusions and reasons. Missing special designation remains unknown and is excluded; it is never silently converted to Standard. Raw cards, exact graders/grades/designations and currencies cannot be mixed. The same eBay item ID under different source IDs, title slugs, domains or query aliases is excluded as a duplicate.

The proposed method `selected-sold-price-arithmetic-mean-v1` uses the selected disclosed prices only, a safe integer sum, and nearest-minor-unit rounding with exact halfway upward. It exposes the selected rows/dates, count, minimum/maximum, sum/divisor, comparison group and currency. Shipping, taxes and fees are excluded. It does not equate ATLAS awards with other graders, appraise a card, guarantee a sale or assign an asking price. Seller-controlled asking price remains null in this preview. The recency window is a required caller input; the synthetic fixture uses 180 days as an explicit local example, not an owner-approved operating policy.

This is a LOCAL_PROPOSAL method preview. Method/recency policy approval, real matching acceptance, authenticated staff curation persistence, freshness-at-listing review, customer-safe read projection and deliberate refresh preserving the original report snapshot remain unfinished. Do not expose the curation controls as customer write authority merely because the isolated component lives in the customer app directory.

## Qualification and remaining gates

Node 22.16.0 focused tests passed 37/37: ownership projection interoperability, no inferred title, allowlist redaction, default offers/privacy independence, retained opt-out across report versions, exact joins, pagination, draft invalidation, amount/date/group/currency/duplicate safety, arithmetic rounding, React server rendering and actual component-handler behavior, first-render account/access refusal, private search and pricing draft isolation across accounts, and pagehide cleanup. Receipt: `~/.codex/atlas-handoffs/atlas-detail-release-20261021/collection-preview/focused-tests.log`. The first component-harness run failed four assertions because its synthetic text helper doubled JSX whitespace; normalizing the helper fixed the assertions without weakening them. Source-only tests are not browser or production acceptance.

An independent media-lane review identified eBay slug/domain aliases bypassing URL-only duplicate checks. Dedupe now uses the stable item ID, with query/slug/domain regressions. The actual source/approval binding, unknown accepted offers and mixed grading groups remain unchanged.

External mounted-preview package: `~/.codex/atlas-handoffs/atlas-detail-release-20261021/collection-preview/`. `start-preview.mjs --build-only` passed with the installed esbuild and actual components. The runner binds only `127.0.0.1` (default port 58612), labels every screen as synthetic, intercepts links and disables network connects with CSP. It includes access-ended/account-switch/reset controls. Root owns the logged server start, desktop/320px browser qualification and final screenshots. Root reports initial browser verification of preferences, account loss, explained three-sale mean and mixed-grader refusal; final refreshed-source/320px capture is pending at this lane's handoff. Real-device performance and owner acceptance remain separate.

Focused command from `frontend/atlas-customer`:

```sh
/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node --test test/collection-contract.test.mjs test/sold-comp-curation.test.mjs test/collection-ui.test.mjs
```

Preview command after the root records its planned local start:

```sh
/Users/markthomas/.npm/_npx/2ad0c2d1aba2dd61/node_modules/node/bin/node /Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/collection-preview/start-preview.mjs
```

Independent ownership review found a possible read-collection preference snapshot mismatch and an expiry-after-final-claimant-lock window. The ownership agent added strict per-card/outer preference equality and final reauthentication/grant expiry checks after the claimant lock. Follow-up inspected the final code and `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-pg-05/postgres-result.json`: all seven groups pass, including a blocked claimant account across reviewer-grant expiry that leaves title UNKNOWN; `stoppedVerified:true`. Qualified proposal SHA256 is `00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2`. No remaining concrete source defect was found in this independent review. Its SQL stays an unregistered proposal, not a production migration or public/customer endpoint. Reviewed claims, off-platform transfers and policy/customer acceptance are not established by these UI fixtures.

All 30 master-plan parent requirements stay open according to their actual evidence. These local building blocks do not complete My Collection/social/profile/album/provenance, R1 combined acceptance, R2 fixed-price ATLAS-held marketplace or the later R3 offer engine. Root owns shared SESSION_LOG/master-plan updates, integration, commits and release work.


## Root browser integration qualification

The final actual-component loopback fixture passed at1280px and320px: default Open to offers with separate private visibility, reversible unsaved collection opt-out, search and account mismatch clearing, three-sale explained arithmetic, unknown accepted-offer/lot exclusion, mixed-grade-company refusal and access-loss removal. Both mobile views have document scrollWidth320 at viewport320, with white body background. Root reran all46 ownership/collection tests successfully. Evidence: `~/.codex/atlas-handoffs/atlas-detail-release-20261021/collection-preview/browser-result.json`, screenshots and `preflight/ownership-collection-01.log`. The retained local preview is127.0.0.1:58612; no real collection or saved preference is asserted.
