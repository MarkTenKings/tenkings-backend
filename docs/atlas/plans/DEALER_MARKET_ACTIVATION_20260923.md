# ATLAS dealer and market activation — September 23, 2026

Mark named “Center courts cards located in Roseville, California” as the first authorized dealer in the September 23 execution session. This is roster authority; no dealer buying commitment, ATLAS submission price, turnaround or commercial offer was supplied.

The reviewed production configuration is `frontend/atlas-public/config/authorized-dealers-20260923.json`. Load its exact JSON into `ATLAS_PUBLIC_DEALER_DIRECTORY_JSON` on the **public ATLAS application only** through the coordinated release. The default without this explicit configuration remains empty. Configuration publication and actual hosted verification are recorded separately by the release coordinator.

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

This record describes the source/configuration candidate. The coordinator must add exact tests and hosted activation evidence to the shared session log; this document is not a live-release receipt.
