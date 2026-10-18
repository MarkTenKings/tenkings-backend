# Approved-card eBay sold-search wording

## Scope and source

The owner authorized this query-only change and production deployment. Application source: `6c6d183bc7656d289b51e316f9b07e4de7be907b` on `codex/atlas-sold-query`, with verified remote parity. Only `presentation-market.mjs` and the retained-response/page checks in `market-worker.mjs` change at runtime.

Fresh post-approval Sports searches use manufacturer, year, player, `#` collector number and `graded` plus the recorded final ATLAS award. Pokémon additionally includes the complete saved set name, uses `Pokémon` as the brand term, and renders set separators as spaces.

- Sports example at9: `Panini 2025 Jaxson Dart #7 graded 9`.
- Current Jaxson approval at8: `Panini 2025 Jaxson Dart #7 graded 8`.
- Alakazam: `Pokémon 2024 Scarlet & Violet Paldean Fates Alakazam ex #215/091 graded 9`.
- Sylveon: `Pokémon 2024 Scarlet & Violet Surging Sparks Sylveon ex #086/191 graded 9`.

The generator omits missing fields, emits one leading `#`, preserves collector-number prefixes/leading zeroes/denominators and preserves the recorded final award, including historical fractional awards. It does not recalculate grades or assert equivalence with a named grading company. Sports set/insert/parallel are not added. Variant-reference acquisition, SoldComps request parameters, image acquisition, image reading, selection and publication are unchanged.

## Existing searches

Saved results remain bound to their exact retained query and publication. Recovery does not repeat a completed provider request. Page continuation keeps the first page's query; mixed queries/pages are refused. The existing **Refresh sales** action creates a fresh search using the new wording. A page reload alone does not refresh comps. No saved result is automatically replaced or backfilled.

## Qualification

Focused Node22.23.2 tests passed58/58 with zero skips/failures. Coverage includes exact examples/current approved8, historical8.5, missing metadata, collector-number fidelity, immutable identity/input binding, malformed saved-query rejection, saved paginated-response recovery without provider replay, old-query page2 continuation and mixed-query/page rejection. Existing provider/service/retrieved-pool checks also passed. Root independently reviewed the two-module diff and verified the pushed source. The exact Linux image additionally passed52/52focused tests with zero skips/failures; production health, public GETs and read-only preservation checks passed.

## Executed release

Release packet: `~/.codex/atlas-handoffs/atlas-sold-query-20261017/release-01/`. The predecessor completed release and postflight first. Exactly two committed modules were overlaid onto its retained native image, preserving web455b27ec and customer bindings. A fresh admission hold, graceful shutdown, read-only preservation check, exact native pair replacement, readiness, normal restart-policy seal and explicit release completed. No Vercel deployment, database mutation, approval or paid test search occurred. The owner will test actual sold-search results.


## Observed production result

Image `sha256:4f9602c86d48be3c7017209301826ef195f9a708f76c5e8a49cbad4f8da4d658` is live. Main `3026f1ca604dddb8024aa1b384cb5e3e271c26a3fb707c9ebb533cc87f6b851f` and worker `c06977d7413376d5eb30259aac92b3115b35957160565a8c8bd99fb18f849991` are healthy with zero restarts;33retained containers/3running, including the unchanged proxy. Native source6c6d183b; web455b27ec. Hold released2026-10-18T02:44:08.853Z; fresh absence and postflight checks passed. All seven controls, complete migration ledger, eight business table commitments and20priorREADY responses/previews remain unchanged.

The inherited210second quiesce check timed out before the application’s own215second HTTP close. Both processes subsequently exited0/noOOM without new signals. Separately reviewed completion verified exact original receipts, fresh clean exits and the same admission session, then performed only the remaining two network disconnects. The original timeout is retained; no effect was replayed. Future operational drain deadlines must include the existing215second allowance plus overhead.

Receipts (SHA256):

- `native/image-qualification.json`: `7915650f62784e775b953e28995c7b1c0f3caf9dfb5f2379901353e2c524c3a1`.
- `native/quiesce-finalized-01.private.json`: `883fc0c88e7f69671f4124edd02cc5f161174412df18f94472cc4b9b20076b40`.
- `native/start-execute-01.private.json`: `22da49caa502be73e8858e204715e57ba44c674e0f0b4c527bb59070f2e7e088`.
- `native/seal-execute-01.private.json`: `6276cbaac055374db0f54838be4cdb7332f247dc0f2f0405286d1d9d916cb41e`.
- `native/health-after-release-01.private.json`: `0ada6afe16a98bc76e6c8bcc55087c01f2b1c99ef765a53d988ee3b37e69b627`.
- `data/postflight-01.private.json`: `c6a2fde5266c521dd5e17818e90aa690358ccdba5f4bc70935f781169a087148`.
- `admission/released.json`: `555e83798ee52dd294fd53979d4016d7e1620a8735c83ba7aad7e5ca0f05c3da`.
- `admission/absence-01.json`: `d6169c99e06be4ce2ee3db4ba843d89fa6884e04742e12ad112b470770cde507`.
- `public-health-01.json`: `899d6a8a3d7686f0bf1a7c36249d2d8617f5205b90ee93b2334d953909556981`.

A separate evidence-handling incident exposed authentication/database credentials in a subagent tool output. Values are not reproduced here; credentials were not changed. The owner was informed and safe credential replacement remains a separate follow-up. Details without values are recorded in SESSION_LOG.
