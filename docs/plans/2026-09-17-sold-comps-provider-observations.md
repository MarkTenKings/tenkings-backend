# Live sold-comp provider observations — September 17, 2026

**The bounded provider experiment ran successfully. It identifies a concrete pricing-evidence gap; it does not enable new research or establish comp accuracy.** Four deliberate checks ran through the normal signed-in staff Preview on exact application `5aeff41180ffeb679b85507777262dc9e3be617c`, deployment `dpl_CY2FmT9BLbGPTtsteA8rEc4uDfim`. Existing sensitive credentials stayed inside the Vercel server. No model, inventory save, research-job change, catalog write or production deployment occurred.

## Observed results

| Fixed cohort | Search rows | Search offer status | Exact-item detail | Actual decoded primary sizes |
| --- | ---: | --- | --- | --- |
| Bo Bichette anniversary, sold | 1 | 1 missing | Explicit no-offer, positive sold banner, matching USD amount/date | 137×225 → 304×500 JPEG |
| Snivy Legendary Treasures, sold | 12 | 12 missing | Explicit no-offer, positive sold banner, matching USD amount/date | 225×225 → 500×500 JPEG |
| Wembanyama Silver, sold | 12 | 11 missing; 1 accepted offer without realized amount | Selected accepted-offer item remains price-unverified | 138×225 → 307×500 JPEG |
| Snivy, active control | 12 | Not sold-price evidence | Misleading `ended:true`, relative `endedDate:3d 20h`, no sold banner, no-offer flag | 367×500 → 1175×1600 WebP |

All25 sold-query rows explicitly report `listingType:sold`;24 omit Best Offer status. The12 active controls explicitly report `listingType:active`. Four detail responses and eight bounded image downloads/full decodes succeeded. Each check made exactly one search, one detail and two image reads: four searches, four details and eight image reads total; no retry. Provider request count is separate from account billing. The exact fixed plan hash remains `eee141bd1c15b25ef3d7040a98d31bea26aa770f93df40092f7fa3fd59fe190d`.

The sold-image examples reach500 pixels, while the active control reaches1600. Larger supplied images exist, but advertised size is not a per-listing guarantee. The provider's [official documentation](https://sold-comps.com/docs) describes larger primary URLs and separate item-detail lookup; the observations above are the actual runtime evidence. No URL suffix was synthesized. Image bytes were checked and hashed in server memory, not retained or sent to a model. Dimensions alone do not establish readable finish cues, correct card/side or improved identification.

## Consequences for implementation

The current private research path uses search responses. A missing offer flag correctly prevents assuming an ordinary realized sale, but the two ordinary exact-item details supply that missing evidence. Add a bounded, separately recorded detail-evidence path for promising candidates rather than treating every missing search flag as false. Preserve the original search receipt and bind the detail to the exact item, title, amount, currency and absolute sale date. Recompute every remaining price/identity requirement after confirmation.

The active control demonstrates why `ended:true` plus `bestOfferAccepted:false` is insufficient. Explicit active status always defeats detail-looking sale fields; relative dates, absent sold banners and conflicting evidence cannot grant completed-sale authority. An accepted-offer detail asking price is still not an established realized amount.

Any integration needs explicit versioned source evidence, duplicate-search reconciliation, per-attempt request limits, optional-failure fallback and responsiveness checks. No overwrite of historical results, silent flag substitution, accepted-offer price inference or broader provider rollout follows from this observation. At least two independently supported matching comps and other estimate gates still apply. This25-row search sample is not independently labeled all-card coverage and supports no90% claim.

## Evidence and qualification

-25/25 focused provider/page/site tests and scoped lint pass. Exact hosted Linux build passes native Sharp0.34.5 trace/shared/calibration checks; no migration. Unsigned provider/workspace APIs remain401/private-no-store; signed-in plan and all four explicit checks worked.
- Reports, exact build/config receipts and test log are in `/Users/markthomas/Library/Application Support/TenKingsInventory/investigations/20260917-live-provider-qualification`. Eight-file manifest SHA-256: `21b289fe4ba11aa52bf3658895593a37d78c5db4a3d8e19e5cb76b88ffa256f2`.
- Sports report SHA `2b9baf470203f20e3db411b16c4fd1dcc08d51fe7fbbea20335606c5907362eb`; Pokémon `ba127ada9c68e6333333ce093decd37db94dc22bb7dd2fee1c0bd3ba32350483`; parallel `2226f62a3c405d14066a1486c1345329ac898dd6e2a6c7233b3df31b9d13cc15`; active `0ea29b2fe1620038ba82a1841e60b2c30a437a0344764e5cadb1c7a052e77ac7`.
- The sports-parallel image sample and detail sample are different listing IDs, each independently identified in its report; no cross-item evidence is combined.

Execution was disabled again after these four observations; record the replacement deployment and disabled human-session check before marking that closeout complete. Production web/DNS and larger-image research remain unchanged.


## Experiment closeout — observed September 17

Execution is now disabled in exact branch configuration. Source `cc1ccc10b3ad6cccf7743f914ca60c793a3676ed` deployed READY as `dpl_FSXWqJbRmhG4AuqoPQNt6jJsmPrk` on the stable main Preview alias. After reloading the normal signed-in diagnostic page, its status reads “Execution is disabled. The plan can be reviewed without provider requests.” and the run button is disabled. No fifth provider check ran. A fresh deployment receipt confirms collect and both existing production aliases remain on `dpl_Bo43ux8vAyyDe6WEKy4Q1A6iT6sj`. Phone acceptance and main-domain cutover remain pending.
