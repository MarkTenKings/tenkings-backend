# ATLAS dealer and market activation — September 23, 2026

Mark named “Center courts cards located in Roseville, California” as the first authorized dealer in the September 23 execution session. This is roster authority; no dealer buying commitment, ATLAS submission price, turnaround or commercial offer was supplied.

The reviewed production configuration is `frontend/atlas-public/config/authorized-dealers-20260923.json`. Its exact JSON was installed in `ATLAS_PUBLIC_DEALER_DIRECTORY_JSON` on the **public ATLAS application only** and is live after the c0a42a24 public promotion. The live `/dealers` read verifies the exact roster, contact-only message and Google directions. See [release evidence](../audits/2026-09-23/workflow-completion.md). This configuration action is consumed; do not repeat it. The default without explicit configuration remains empty. The successor `1b880d0690dd0b3a64a76103557815cf40675029` release preserves these dealer bytes unchanged on public `dpl_DjGX2yStocGFYPf8PP1kgALuJtx2`; its only public environment change was the staff deployment origin. See [current release evidence](../audits/2026-09-24/completion-followup.md).

The entry is explicitly `contactOnly: true`, with no claimed BUY/SUBMIT services and no programs. It remains discoverable from buying/submission inquiry filters and says to confirm availability and current arrangements with the dealer before visiting. It does not enroll a customer submission, promise custody, offer a buyback or contact the business automatically.

## Location provenance

Verified September 23, 2026:

- [CenterCourt Cards official website](https://www.centercourtcardsroseville.com/) supplies the CenterCourt branding, 307 Lincoln St, Roseville, and the website contact channel.
- [Roseville Area Chamber listing](https://business.rosevillechamber.com/directory/Details/centercourt-cards-4884910), also in its [shopping directory](https://business.rosevillechamber.com/directory/Search/shopping-retail-427358), confirms the same street/city and the full postal code 95678. The shop website's four-digit `9567` is incomplete.
- The website and chamber publish different phone numbers. Neither is selected; the listing links the official website. The memorabilia service prices on the site are not ATLAS grading program terms and are not imported.
- No coordinates were supplied or geocoded. The position stays null, so no approximate location pin or invented distance is published. Google Maps directions use the verified street address and require no Maps API key. Embedded maps remain optional pending a real restricted browser key, map ID and verified coordinates.

## Sold-sale evidence

The existing ATLAS adapter uses the shared SoldComps engine at `https://api.sold-comps.com/v1/scrape` with a dedicated `ATLAS_MANUAL_SOLD_COMPS_API_KEY`. [SoldComps' current API reference](https://sold-comps.com/docs) documents bearer authentication and metered searches. No provider account, usage entitlement or live sale is established merely by the adapter or a populated environment variable.

Activation requires the reviewed presentation schema/grants, `ATLAS_MANUAL_PRESENTATION_ENABLED=true`, `ATLAS_MANUAL_MARKET_ENABLED=true`, and the dedicated key on the private service. Public report reads never issue searches. A real authenticated staff action against an approved report initiates the retained search, then a separate deliberate selection publishes chosen evidence. Unknown dispatch results retain their original reservation; no automatic paid retry is added. Only actually disclosed, supported graded sales reach the public projection; the latest sale is not a valuation or a cross-grader equivalence.

Dealer offers remain absent until exact authorized scope, amount/currency, expiry and terms are supplied. The existing presentation contract supports such evidence without a payment/trade execution path. No Ten Kings inventory, ownership, TKD buyback, credentials or locations are copied implicitly.

Superseded missing-key checkpoint — before the September 24 follow-up: dealer publication was verified; market remained disabled. The signed-in provider account has one masked existing Ten Kings key, and the scoped legitimate configuration checks found no accessible original. Do not rotate/revoke it or invent a credential. A saved original must enter through protected local custody, or a separately issued/coordinated replacement is needed. The provider currently documents a40-result cap without cookies and429 for both rate/quota exhaustion; real bounded contract qualification remains necessary before activation. No paid market request or dealer communication was made. Exact receipts and remaining inputs are in the current release audit and shared session log.


### September 24 UTC follow-up

Mark recovered and securely entered the original key. Exactly one real transport check passed (HTTP200,13 candidates); no key rotation or Ten Kings configuration change was needed. Source `1b880d0690dd0b3a64a76103557815cf40675029` is now live on staff `dpl_27Dj9ngpLzn7yqw271e6Bo2KyhPJ`, public `dpl_DjGX2yStocGFYPf8PP1kgALuJtx2` and native container `f7949…` / image `2039…`. Market, batch and presentation are enabled; station remains disabled. Controls 25/23/3 are verified with staff 47/public 112 and existing grants preserved; no new migration or grant was applied. The prior c0a42a24 / `4f11…` runtime is retained stopped.

The live source fixes explicit40-result requests, typed quota refusals/reconciliation and redirect rejection. Approved-report search, actual selection and public presentation acceptance remain **NOT_RUN** until a genuine human-approved report exists. Mark's reviewer authorization now runs for 90 days (`2026-09-24T01:32:51.855Z` to `2026-12-23T01:32:51.855Z`), accessVersion2, requiring ordinary reauthentication; this does not supply a card approval. The dealer remains contact-only with no offer, buying commitment or submission program. See the [current release audit](../audits/2026-09-24/completion-followup.md); the missing-key observation above is historical.
