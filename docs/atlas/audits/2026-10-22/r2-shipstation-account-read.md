# ShipStation account inspection — read only

The owner signed into ShipStation in the ATLAS Chrome profile. Native Chrome accessibility confirmed `Mark (atlasgrading.com)` and the ShipStation API **Production** portal. The Ten Kings extension profile was not used for this account inspection.

Observed carrier inventory: Stamps.com, UPS, FedEx and GlobalPost. Exact private account carrier IDs are retained only in external `continuation/r2-shipstation-readonly-inspection.json`. ParcelGuard is available. Its displayed price per $100 coverage is $1.09 for USPS domestic, $0.99 for other domestic, and $1.39 international. These are displayed insurance prices, not a complete shipment quote or coverage approval. Production webhook inventory is empty. No key was revealed, setting changed, funds added, agreement accepted or label purchased.

The rate viewer requires ship-from/destination city and postal code, outer dimensions and packed weight. Root requested the actual marketplace parcel measurements and origin from the owner; none were assumed from grading packaging. No rate request was submitted at this checkpoint. The adapter has not yet been tested against this actual account.

## Coverage qualification remains open

[ParcelGuard terms](https://www.parcelguard.com/terms/), dated July21,2026, require carrier acceptance, adequate non-content-revealing packaging for loss/shortage, and preservation of damaged goods/packaging through claim completion. Do not return damaged evidence to the seller while a claim remains open. Published limits are $10,000 per package/$100,000 per conveyance; valuation is invoice value, otherwise actual cash value, capped by the declared amount. Immediate notice and claim documentation within120 days are required. The terms do not specifically establish ATLAS-graded-card/slab/regrading treatment. Retain applicable account-policy confirmation before approving that coverage.

The adapter accepts independently approved coverage records, not insurer approval by itself. Actual parcel fit, service/signature selection, value/conveyance caps, issued coverage, carrier acceptance and claims-preservation practice must be qualified before live use. The current pilot opens a staff-reviewed case and does not automatically dispatch return goods. Its24-hour buyer return-request deadline is separate from the insurer's claims rules. The implementation exports rates only; actual label/coverage purchase and tracking proof remain fulfillment operations.

## Successor action

Use the owner-provided measurements and explicit origin to obtain account-specific rates without buying labels. Bind the chosen carrier/service and coverage record into the existing explicit configuration. R1/successor owns production webhook/credential/routing changes and eventual live activation; this inspection grants none of those effects. Retain this actual dashboard evidence separately from mocked HTTP, synthetic UI and prior Stripe sandbox qualification.
