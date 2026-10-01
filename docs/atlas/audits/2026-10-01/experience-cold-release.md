# ATLAS experience: coordinated cold release

Subsequent public-only continuation deployed at18:11UTC: public source e22595f7, PublicReader39 and homepage e9782ea0080562f8 supersede this audit’s public identity. Staff, customer, schema and private-runtime results here remain current. See [the continuation audit](experience-continuation-release.md); the detailed cold-release sequence below is historical.

Verified October1,2026: the coordinated schema/runtime/web release is deployed. The final public promotion completed after14:09UTC; all107 canonical GET/HEAD checks passed at14:10:18UTC. This release installs the customer, shop handoff, capacity and progress foundation with commerce/progress disabled. It does **not** claim a completed live paid submission, notification send or physical shop handoff.

## Actual deployed identities

The release source is `e853b25ee26828f1866e21c94c31dc4347984a17`, tree `353cf05e7f7382a5794dab8b5d756c732dad9989`. Staff retains its already qualified f49 candidate. Subsequent customer build and component-test corrections did not require restaging it; the source split is explicit in every binding.

| Component | Actual deployment | Source |
| --- | --- | --- |
| Staff | `dpl_F4bBBGgaGAPmCfU8LscG5qfWErhN` / `atlas-grading-staff-lgb8j9t03-ten-kings.vercel.app` | `f49d5d36897d94292df7d7ce1875b7a401931afd` |
| Customer | `dpl_7jSVYPR1mP7A1fQPXsNaGcFKLTt9` / `atlas-grading-customer-prd6k56a3-ten-kings.vercel.app` | e853 |
| Public | `dpl_5Pttw1FoFjxBM8BwzJQQV8eJayCL` / `atlas-grading-public-lsbttgcjc-ten-kings.vercel.app` | e853 |
| Private | Container `884779c7b097f800b2cc8235471227ae1174425647ad604c8412a2caa182c143`, image `sha256:c0bd5ec935b4e4034985d8c4b1671e65f1dde5b9c5dcb694f1df7f720cc57bcd` | e853 |

All hosted candidates are READY, with exact GitHub/generic source metadata, actual root directory, effective Node22 and hosted build-boundary passes. Project settings retain Node20.x; package engines select effective Node22. The private successor started `2026-10-01T13:44:07.069526125Z`, has zero restarts, and retains existing worker/resource/isolation settings. Old private `1404989c` was gracefully drained, stopped with exit0 and disconnected; it was not deleted or automatically restarted.

The actual protected constructors produced staff config hash `16b7a49271c9fd90553de813e4e831598d74f5c336e32291afec052aaf54b6e9`, preserved customer hash `a16194cda97d081b2b878bb59343f68ba30e6e56085dfdaa064c32f7e6ea1563` and preserved public hash `cc3c81e9c8541fb3a2c9c0c8c01e54298a22f04522714561743051d4d331c1c8`. Protected values were read only in approved memory contexts and never included in receipts.

## Schema, controls and preservation

Pinned original Prisma5.22 applied exactly five registered migrations01000 through05000, taking the staff ledger62→67. Prior62 complete staff rows and original112 complete public ledger rows remain unchanged. The applied additions are weekly card capacity, customer-phone payment semantics, authenticated shop handoff, consent-aware progress notification infrastructure and shop contact-only profile support. No migration normalization, manual ledger edit or unrelated role grant was performed.

Before migration, full-row CAS temporarily disabled Staff51→52 and Customer15→16. The original enabled states were recorded. The six-row rebind ran once inside the successor's verified125-second boot fence and restored those states while changing only the planned bindings/revisions:

| Control | Final observed state |
| --- | --- |
| StaffControl | Revision53; actual f49 staff binding; original enablement/policy preserved |
| STAFF SmsPilotControl | Revision50; same staff binding; flags, limits, expiry and policy preserved |
| CustomerControl | Revision17; actual e853 customer binding; original enablement/policy preserved |
| CUSTOMER SmsPilotControl | Revision14; same customer binding; flags, limits, expiry and policy preserved |
| CustomerServiceControl | Actual e853 customer binding; existing service/identification flags preserved |
| PublicReaderControl | Revision38; actual e853 public binding; original config hash/policy preserved |

The final public promotion performed **zero control writes**. Reader38 was already installed by the six-row CAS; there was no second Reader bump.

Correction verified October 1 at 17:41 UTC: original SMS accounting rows, exact phone/destination admission and provider/application bindings were preserved. Mark retired test count, cost and seven-day expiry enforcement on September 10; migration `20260911040000_sms_test_limits_removed` applied September 11 and the current live claim guard still enforces that policy. Historical expired timestamps do not block ordinary sign-in. This release did not perform a real verified sign-in or authenticated checkout. Broader customer phone admission remains a separate launch decision; ordinary authentication, rate limits and accounting remain. Read-only receipt: `atlas-continuation-20261001/qualification/live-availability.json`, SHA256 `436db93b541a6b0a399f827391493b5d9e623c6598a74e74396d6bcbad61db82`.

Independent read-only postflight, before the final browser's ordinary anonymous bootstrap, passed20/20 preservation invariants. It verified all32 original card-history fingerprints and64 broader history fingerprints exact, as well as protected function definitions, serving capabilities, legacy SELECT ACLs and all seven detailed role/column privilege sets. Original card/grading records were not changed or restored. The owner-deleted graded reports remain retired. No real customer/order/card write, new approval, grading/model call, payment, commission or notification send was performed for release qualification. New operational tables were empty; the two initial capacity configuration rows have NULL quotas. Active work counters were zero. The later browser check is not represented as another whole-history hash audit after anonymous bootstrap.

The existing original evidence, lossless preparation, presentation-image service, native16 artifacts, QR29 dependencies and1,135-file private source closure are preserved. This release changes presentation and the submission/account foundation; it does not change the grading formula or invent defect findings.

## Public routing and narrow ingress correction

Public environment changes were exactly four fields: staff and customer deployment origins, the private customer-service URL, and one new narrow directory read key shared with private. Other environment metadata, project settings, domains and protected values were preserved. The directory key permits only `dealer-locations` and `weekly-capacity`; it grants no customer/session/payment authority.

The original four-read probe held because existing Caddy customer-service path/raw-URI allowlists omitted `weekly-capacity`. Staff401, unknown-report404 and directory200 already passed; the capacity request was rejected before application handling. Its original HOLD and one-attempt intent are retained.

Root applied only the exact weekly-capacity regex alternative in two allowlists at each of the dedicated runtime-link and shared-edge boundaries. Actual Caddy validated both candidates. The dedicated Caddy2.10.2 link had admin disabled, so root gracefully stopped/started only that same proxy container with its original image, settings, resources and network address. The private grading container was not restarted. The dedicated-link receipt also verified96 other containers unchanged. The shared edge retained its process and received a validated reload.

Shared-edge application passed candidate loading and then held at `STATIC_PROXY_SETTINGS_CHANGED`. Read-only reconciliation verified exact original image/static values/process lifetime/network/resources and exact mounted/loaded candidate configuration. Twelve Docker inspect reads reproduced three different `Mounts` array orders with identical values; the hold was array-order sensitivity rather than a changed mount. No writer replay or guard weakening occurred. A pre-edge whole-host snapshot was not persisted, so no retrospective whole-host comparison is claimed for that edge step. The dedicated-link check and independent private/runtime preservation proofs remain valid.

Both boundaries were checked narrowly: bare POST to the exact capacity path reaches authentication401, while GET, query-string and trailing-slash variants remain404. No wildcard route, authentication bypass or unrelated configuration change was added.

The fresh qualified probe used new intent/result paths and the **same** exact four-read code `c5f36a9e0151afe87d98532bd7c485ac75d587726386fc4ab9bb865cf3b93e27`. It passed at14:06:53UTC:

| Signed TLS read | Result |
| --- | --- |
| Staff route without a session |401 `SIGN_IN_REQUIRED` |
| Synthetic unknown public report |404 with empty body |
| Customer dealer directory |200; zero configured locations |
| Weekly capacity |200; mail and shop pools both `NOT_CONFIGURED`, remaining countsNULL |

All four had authorized TLS1.3, no-store and nosniff headers. Runtime identity/configuration stayed unchanged, and there were zero real sessions, approval actions, card writes or paid requests. A relative-path invocation held locally before any intent/network action; the absolute-path qualified execution succeeded once. The original failed probe/result were not overwritten.

## Final public cutover and acceptance

The promotion plan bound actual READY/public source, completed schema67/112, all six current rows, completed startup fence, live successor identity/configuration, exact protected constructor receipts, candidate55 checks and qualified signed4 reads. Root executed one exact Vercel POST for only `dpl_5Pttw1FoFjxBM8BwzJQQV8eJayCL`. All four public aliases now select it. Other provider settings/environment/staff/customer state, current controls and private runtime were preserved. No environment, schema, runtime or control mutation occurred in the promotion step.

Canonical107 GET/HEAD checks passed: exact homepage package `d8ebedb13703d0fd`, all assets and script bindings, retired/unknown report/presentation/film denials, account/staff routing, cold capacity DTO, unauthenticated customer/dealer read401s and handoff write-method405s. No POST/bootstrap or real sign-in was part of that checker.

The separate live browser check passed at1280px desktop and390px phone: no horizontal overflow, visible fingerprint over the card, exact front/back calipers, finding6 with its exact2.75mm/10.05mm dimension labels, all seven navigation entries, lazy-loaded lower fingerprint with three findings/0.51mm², and NFC stage4. Findings1 and6 were checked live; the seven navigation entries were observed without claiming every finding was opened. Account sign-in and mail-in selection reached the phone step. No console errors were observed. This check performed ordinary anonymous bootstrap **after** the independent DB audit; it entered no number, sent no SMS, uploaded no card, paid nothing and created no order. Physical Safari, authenticated checkout and the first legitimate new report remain acceptance gates.

Qualification also includes1615 Node +43 Python cases, zero failures/skips, hosted builds/boundaries, original Prisma upgrade/no-op rehearsal with actual seven-role permissions, native concurrency/CAS tests,31 public promotion refusal groups and four qualified-transport offline fixtures. Independent agents reviewed the upload, environment, schema, controls, runtime and promotion boundaries.

## Gates retained and owner activation inputs

`ATLAS_COMMERCE_ENABLED=false` and `ATLAS_CUSTOMER_PROGRESS_ENABLED=false`. Fresh read-only inspection at 17:41 UTC also confirms that `CommerceControl` has no row, while the progress-control singleton is false; an absent commerce configuration must not be described as an installed, disabled provider configuration. Installed schema and deployed UI do not activate charges or sending. Mail/shop capacity quotas remain NULL; the site reports that truthfully rather than displaying either example500/1000 quota. No enabled dealer location was invented from contact information.

- Configure the actual weekly **card** quotas for the separate `MAIL_IN` and `DEALER_DROP_OFF` pools. Monday00:01 America/Los_Angeles is DST-aware; a20-card batch consumes20 spots, and a weekly reset does not erase backlog. The existing100-card limit applies per intake batch, not per person/week.
- Configure each real authorized shop, address/tax context, membership/QR entry and pickup/return schedule. Terminal/printer IDs are optional for the customer-phone flow. Payment/QR issuance does not record custody: scoped staff must scan and confirm the exact paid card set.
- Review existing pricing, provider/tax/receipt/carrier policy and actual mail/shop turnaround before enabling commerce. Mail turnaround starts on physical receipt. Shop intake requires name plus verified account phone, optional email and no return address; mail retains its full return profile. Historical paid and uncertain attempts are preserved and must not be blindly released or converted.
- Qualify an ordinary authorized customer submission/payment/handoff and authenticated operator workflow using the real configured route. The source/anonymous tests above do not claim this live physical acceptance is complete.
- Verify real sign-in within the existing approved phone/destination scope. Broader customer admission needs its actual launch scope; the retired SMS count, cost and expiry limits do not need renewal.
- Configure notification providers and qualify consent, contact changes, opt-out and uncertain-delivery reconciliation before enabling progress sending. Customers' preferences remain opt-in; no automatic messaging activation occurred here.
- Perform the first new legitimate human approval/publication to verify live prepared front/back presentation images, immediate defect/centering motion, report tour and per-card film on a current real report. No eligible live graded report existed for that test, and none was restored to manufacture success.
- Social collection/community publication and NFC cryptographic authenticity remain separate qualified scope. Public sharing does not publish a customer's identity automatically; the fingerprint is evidence-derived presentation, not proof of physical uniqueness or implemented NTAG424 cryptographic validation.

These are activation/physical acceptance inputs, not missing schema deployment. Consumed source upload, migration, controls, ingress, probe and promotion intents must never be replayed. Any subsequent recovery or rollback requires a fresh reviewed forward plan, actual bindings and new revisions; additive schema remains unless separately authorized destructive work is planned.

## Receipt index

Private packet root: `/Users/markthomas/.codex/atlas-handoffs/atlas-experience-cold-20261001`. These receipts contain safe identifiers/hashes, not protected values.

| Receipt | SHA256 |
| --- | --- |
| `runtime/actual-bindings.json` | `8aa8e01464b9c6cd2fea6c85014d51e7e0a4627275ef5dbdbab95d66abca33cc` |
| `controls/fence-result.json` | `854def9b5304b7cb322f4d339cc3cc0908ca6370b43daa6b34e2a35c2c0f6f97` |
| `controls/rebind-result.json` | `403691823cfad92e292a4578e8f5de204bc1b2750ec8d4aa0b54339df28f504a` |
| `runtime/started-result.json` | `37cdc55ecbdad9e8256e29574fd26fddc81fce71bc277b8b13d0ed69e43795bd` |
| `postflight/live/result.json` | `4a8513c2b7c62fde0b8a7c79f46f1fe1a17e662ef2838b4b0e9110c9847dedd2` |
| `runtime/ingress/edge-readonly-reconciliation.json` | `9a11e295afc9982c768b25b23926ff6390c4f332212fe5d007a2919e3ad55493` |
| `runtime/ingress/edge-mount-order-diagnostic.json` | `73188ebd1ba72be0922d3e9860dc322efab1a97b6cdf83057c3f62dc345c7f5b` |
| `runtime/ingress/edge-four-route-proof.json` | `3afafb8465fc4fabd6deec7e077b2e29b19db17790bdf48bb12e2fafc35a4ede` |
| `runtime/signed-probe-qualified.result.json` | `3858a440d2efdb4feb948af8f4526a70643feb26a37a17703f9006f46008cd9d` |
| `web/promotion-result.json` | `a6a1c2eb32a3294f118de0b890dc6e10bb655ff15fef13b7c50008a4873aeb24` |
| `qa/canonical-result.json` | `b77be5759ce5e62bbe06c7d538a046d4962b7f1f7f8598b8df5eaf6933278a99` |
| `qa/production-browser-result.json` | `669f58b9351cf22b774897b3070dadfc3c9a4472a19de8ab0993bb20ce404105` |
