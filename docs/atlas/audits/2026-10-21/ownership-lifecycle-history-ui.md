# Disabled customer ownership lifecycle history UI

Status: locally qualified source; unregistered and disabled by default. This audit records the customer-only read adaptation to the qualified lifecycle v2 reader. It does not authorize a migration, runtime registration, deployment, proof upload, policy activation, reviewer grant or ownership decision. Independent source review passed on the exact pinned candidate; see the review record below.

## Implemented boundary

- `OwnershipClaimsWorkspace` still defaults to `enabled=false` with no reader. It has no claim, withdrawal, replacement, proof-download, proof-upload or reviewer mutation controls. An explicitly injected page reader is required; an explicitly injected history reader enables the read-only recorded-changes panel.
- The browser accepts only `atlas-ownership-claims-page-v2`, `atlas-ownership-claim-state-v2` and `atlas-ownership-claim-history-v2` for current/list/history data. The previous `atlas-ownership-claims-v1` payload is refused. `LEGACY_V1` is a truthful origin marker inside the new v2 history contract, not a fallback to a v1 reader or fabricated transition.
- The inactive HTTP adapter defines closed same-origin GET metadata dispatch for `claims?limit=…[&afterClaimId=…]`, `history?claimId=…&afterRevision=…&limit=…` and the existing `claim?claimId=…`. These require `listClaims`, `listHistory` and `readClaim` capabilities from the restricted lifecycle reader. Missing capabilities return unavailable; the lifecycle writer and old workflow reader are never substitutes. No application route imports or registers this adapter.
- Existing CustomerAuth cookie checks, independent live `readAccess` before and after dispatch, exact account-scoped projected responses, and browser validation against the current session account remain required. The client sends no account authority in selectors. Limits are 1–50, UUID/cursor inputs are closed, history revisions are ordered/contiguous under the reader contract, and a complete history tail must agree with current claim state/revision/bundle.
- Current state, current evidence reference, recorded changes and the independent current-title boolean are displayed separately. A later history read updates the current row; closing or retrying that history does not revert it to the older list snapshot. Regressing history or a changed state/bundle at the same revision is refused. List and current-read timestamps remain visibly distinct.
- Original request receipts remain on the unchanged `recover_request` lifecycle path. The adaptation does not reinterpret a recovered submission receipt as the present state of its claim. The integration regression preserves a `PENDING` revision-1 submit receipt while current state is `WITHDRAWN` revision 3 with a replacement bundle, and history records both intervening actions.
- History is bounded and replaces the displayed transition page. There is no inferred total, automatic replay or hidden mutation. Account/session/reader changes, logout, pagehide and unmount cancel reads; late responses cannot restore hidden private rows. A foreign account response or access refusal clears the complete private page and latches access ended for that session.
- Evidence access expiry is explicitly distinguished from deletion. No deletion, proof authenticity, legal sufficiency, current owner identity or competing claimant identity is inferred or displayed. Latest published card/report binding remains the qualified reader's explicit source, even if a newer publication is pending.

## Exact candidate source pins

These ten files are the complete product/test scope of this increment. The five qualified new-reader files in commit `d71f91df` are unchanged. Original writer/evidence/object/lifecycle SQL and services, submission UI/client/state, runtime registrations, package and lock files are unchanged by this increment.

| File | SHA-256 |
| --- | --- |
| `frontend/atlas-customer/lib/ownership-claims-client.mjs` | `85d9ab9f1b090f98b4928e2a206f4cbfdcecd8d0380a46a05780fa03166fc004` |
| `frontend/atlas-customer/lib/ownership-claims-transport.mjs` | `8f3803c34e11c5f2c9d03be3719db7244160aa271c76a46a61f86646a956ab8a` |
| `frontend/atlas-customer/lib/server/ownership-claims-http.mjs` | `d405eb2f214c08b54fc1b7125774feabf9e4568e0b6f69fc654345f137c9a45e` |
| `frontend/atlas-customer/components/collection/OwnershipClaimsWorkspace.jsx` | `605575a10716302459dac08cd8369aea01c5833c0d3804b8617180bf4f71039b` |
| `frontend/atlas-customer/components/collection/OwnershipClaimsWorkspace.module.css` | `534b4ab08de36d4c10ffbbc0ce28826364588a7de342bcf9a589ce6fc8f1dce4` |
| `frontend/atlas-customer/test/ownership-claims-client.test.mjs` | `d88ee8f77d1e2c0a36083a0a8c3680ad620417fdca3a9f3393fb6ad30bef7d6b` |
| `frontend/atlas-customer/test/ownership-claims-transport.test.mjs` | `e6f708006f24c286fa66ae0581960a1393fb611bc32e3ca1025ee49910287d49` |
| `frontend/atlas-customer/test/ownership-claims-http.test.mjs` | `7bb4fbcbdbacc049d7b68db69f0d670a8f08b8481f1339caa80639de58540b62` |
| `frontend/atlas-customer/test/ownership-claims-workspace.test.mjs` | `adc4965fdf7d29dc4a749128c686ccc154b5ee4a60bc13666b7c71396e63f69e` |
| `frontend/atlas-customer/test/ownership-claims-fixture.mjs` | `3ea586e24a47ea9977436540f7933bec5c3a6a682997df23702e8f88f98b9ae4` |

## Local qualification

Receipt: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-lifecycle-history-preview-02/qualification-01.json`

SHA-256: `90d4ccd35ccdeaeb5247abb35635de59aaee6254b2e4a95d891b312848abb43f`.

- Node 22: 38 focused tests passed, zero failed or skipped. The browser parser is differential-checked against the actual qualified lifecycle read projector across 96 current-state/title/blocking/card combinations, bounded history cases, and a legacy claim with no manufactured v2 event. The actual inactive transport, HTTP adapter, CustomerAuth checks and browser submission state are exercised in process with memory-only fixtures.
- Customer-app lint and `git diff --check` passed. The repository-root lint invocation previously emitted only the Next pages-location notice; the correctly scoped customer-app invocation is clean.
- Actual React component and bounded Response readers were inspected in Chrome on a localhost-only synthetic preview with CSP `connect-src 'none'`. Observed CSS viewport and document scroll widths matched at 1440, 390 and 320 pixels. Screenshots are pinned in the receipt.
- Browser observations cover current withdrawal/replacement versus past submission, closing history without losing the newer current state, explicit legacy origin/no invented event, 25+2 transition paging, foreign-history refusal and a delayed response after access ended. No console errors were observed. The viewport was restored, preview tab closed, and both owned servers stopped with exit 0.
- Preview01 remains intact. Its synthetic 27-transition data was mistakenly generated as a 25-row page, then the browser mock incorrectly marked the slice complete; the real parser correctly refused it. Preview02 changes only fixture generation to retain the full synthetic history and the localhost port. Product bytes are identical; corrected pagination was observed successfully. This is a fixture correction, not a weakened parser assertion.
- No production request, DB connection, storage/provider call, real customer account, grant, migration or policy activation occurred. Browser and in-process qualification does not establish real deployment or operational proof-storage acceptance. Earlier disposable PostgreSQL qualification belongs to the separately pinned reader audit; it was not rerun here.

## Remaining integration gates

1. **Restricted database composition:** root must review and register the intended ownership proposals and the new reader in a future planned migration, provision a serving role with only the exact customer read entrypoint, and run its capability checks. The generic customer database client and writer-capable ownership gateways are not suitable fallbacks. No database change is part of this source increment.
2. **Trusted server composition:** connect existing CustomerAuth and exact live configuration/control bindings to `createOwnershipLifecycleReadService`; inject its live access, list, current and history methods into the inactive adapter. Keep account identity derived from DB sessions, not cookies merely being present or client-supplied account IDs. Verify revocation/expiry and exact role capabilities in the deployed composition.
3. **Explicit read-only route/UI wiring:** register only the reviewed GET paths in a future server boundary, preserve private/no-store response headers, GET framing/origin checks and the `/account` browser base path, and provide the session customer to the component. Keep its readers and `enabled` flag absent until that composition is qualified. Read-only history can be enabled independently of proof preparation; absence of upload capability must not fabricate an empty history or disable permitted management reads.
4. **Real-session acceptance:** after a separately reviewed deployment, verify a real own pending/withdrawn/replaced or decided claim, current published card binding, ordered history pages, immutable request recovery versus current state, cross-account denial, access expiry/revocation, unavailable/empty distinction and responsive interaction. Synthetic local fixtures are not a substitute for these facts.
5. **Separate operational claim decisions:** proof kinds/rubric, practical accepted media, retention and deletion/disposition policy, named independent reviewer provisioning and private storage/decoder qualification remain explicit owner/operator decisions. No defaults in this UI activate them. A retention deadline or access expiry is not deletion evidence. Submission/writer/proof activation and reviewer grants require their own reviewed composition and acceptance, not the history UI flag.

## Independent review

`detail_media` independently read the ten pinned source/test files and verified all ten source hashes plus eight evidence references against qualification receipt `90d4ccd35ccdeaeb5247abb35635de59aaee6254b2e4a95d891b312848abb43f`. Bounded review **PASS**, no concrete blocker found.

The reviewer traced dedicated v2 list/history/current dispatch without writer or old-reader fallback; pre/post live access; closed private 256 KiB/25-second browser reads; exact cursor and legacy semantics; newer current state versus immutable original submit receipts; account/page/history generations and cancellation; regressing-history refusal; and complete private-row removal on 401/403, foreign account or session loss. The reviewer inspected the 38 focused assertions and retained browser/CSS evidence, and ran no tests, DB connections, network requests or effects. The reviewed qualification remains local, synthetic, disabled and unregistered.
