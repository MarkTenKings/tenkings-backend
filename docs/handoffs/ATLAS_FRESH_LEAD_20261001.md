# ATLAS launch — incoming lead handoff

Prepared October 1, 2026, approximately 18:50 Pacific. This is the current executive checkpoint; earlier dated handoffs are historical unless linked for a specific artifact. The retiring lead is finishing its handoff, not declaring the paid launch complete.

## Mandate and ownership

Mark explicitly requested a **brand-new Astra Ultra lead**, with **two new Astra Extra High subagents**, and will work directly with that lead. Start a fresh context, not a fork of the huge old conversation. The incoming lead owns the launch and is the sole production mutation owner after receiving this package. Spawn two collaboration subagents using `gpt-6-astra`, reasoning `xhigh`, with concise scoped context. Keep Stripe/provider/backend activation with the lead; delegate customer admission/workflow to one and SMS/dealer/shipping qualification to the other. These are suggestions for avoiding overlapping edits, not new product requirements.

Mark wants the site and submissions live tonight, wants to experience the submission workflow himself, and wants to grade actual cards now. Bias toward finishing concrete launch work, give concise progress updates, and don't keep him trapped in repeated Stripe setup. He is frustrated by slow, invisible progress and repeated permission loops. Explain what is live, tested but undeployed, and blocked; don't present a percentage without a meaningful denominator.

Old lead chat: `01a0f887-df2b-7d90-a47b-5353f1dacb54`, title **ATLAS Website & Films — Astra Ultra…**. The full conversation can be read if a specific ambiguity requires it; do not load all its history by default. Mark explicitly authorizes messaging/continuing the new lead as part of this transfer.

## Use this exact checkout

Canonical editable checkout:

`/Users/markthomas/.codex/worktrees/atlas-report-production/ten-kings-mystery-packs-clean`

Branch: `codex/atlas-experience-20261001`.

Last implementation checkpoint: `3a840477df83057f344310c5fc9754e661522fa6` (restricted Stripe keys + live-capacity documentation). This handoff will be committed on top; read `git log -2` and `git status --short` rather than assuming its own commit ID. No source edits are intentionally left uncommitted at transfer.

The project launcher may start you in `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean`. That primary checkout contains unrelated dirty work. **Do not edit, reset, switch, clean, or deploy it.** Pass the canonical `workdir` explicitly. No new worktree is needed. `list_artifacts` on the retiring chat is empty even though this canonical checkout exists.

Mandatory process: read the current leading blocks of `docs/context/MASTER_PRODUCT_CONTEXT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, and the latest entries of `docs/handoffs/SESSION_LOG.md` first. They are very large accumulated histories; targeted reads suffice for current state. Evidence overrides stale prose. Append SESSION_LOG after commit-worthy changes and before/after deploy/restart/migration. No destructive data actions without explicit approval; destructive set operations need dry-run impact and typed confirmation.

Use `git -c gc.auto=0`. Do not reset/gc/repack. Disk was only **238 MiB free** at this checkpoint. Do not run another full local Next build or duplicate large asset directories. Remote qualified builds and narrow local tests are available. Do not delete unrelated files or historical artifacts to recover space. Node 22 is `/Users/markthomas/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`; pnpm is `/opt/homebrew/bin/pnpm`.

## What is actually complete

1. Revised public homepage is live: accepted hero preserved exactly; Beyond card centering axes; short proprietary fingerprint story; explodable interactive NFC anatomy and story; fingerprint+NFC connection; fictional VEX Spot the Switch; improved route motion; a unified weekly submission section. Rejected montage video players are removed from the active homepage.
2. Shared capacity software, private backend, additive database migration, and **one 1,000 individual-card allowance for this week** are live. One 20-card order consumes 20 spots. Both mail and dealer use the same pool. No future week is automatically seeded.
3. The private rollout preserved prior runtime configuration, native dependencies, grading data and authentication bindings. Grading admission is restored. No fabricated grade, report publication, paid order, customer, SMS or email was created for testing.
4. Mark created a separate ATLAS Stripe account and selected Radar Standard. He saved the live restricted and publishable keys through hidden Terminal input. Two read-only API requests confirmed the correct account, enabled payments/payouts, no outstanding account requirements, and active live Tax settings.
5. Commit `3a840477` permits Stripe restricted `rk_` keys in transport/readiness, with unchanged account/mode qualification. Root integrated suite passed **84/84**, no failures/skips. **This code is not deployed**; live private remains a508.
6. One new personal narrated creator ad was delivered separately: 16 seconds, vertical, eight exact two-second groups. It is not installed on the homepage and needs Mark's creative acceptance. Don't claim he approved it.

**Not complete:** paid checkout, public customer admission beyond the original admitted phone, receipt/progress messaging, operational Center Court handoff, mail shipping, actual customer payment/custody acceptance. A quota or enabled Stripe account does not mean those are live.

## Exact production checkpoint

| Surface | Actual serving identity |
|---|---|
| Public/private source | `a508b83e52c2c2406344e288a68c37bb5a37efba` |
| Public deployment | `dpl_HmrAKKsTJCHkzPG1s3e1qGtKJSmo` |
| Public immutable host | `atlas-grading-public-gkqyjymkc-ten-kings.vercel.app` |
| PublicReader | revision **41**, all four canonical aliases |
| Homepage | `c97eaa4760ab6368`, 66 files |
| Private image | `sha256:cf3cbae8a674171f621f54943dae44e8214a69c0f64f9c45a96c2611d37daf06` |
| Private container | `aa27ea7fa6e59a97cb61cdecf1730b50658f7e986955a8447e40d7c96558ec59`, name `atlas-capacity-a508b83e52c2` |
| Remote root | `/opt/atlas/shared-capacity-a508b83e52c2-runtime` |
| Staff | source `f49d5d36897d94292df7d7ce1875b7a401931afd`; deployment `dpl_F4bBBGgaGAPmCfU8LscG5qfWErhN`; host `atlas-grading-staff-lgb8j9t03-ten-kings.vercel.app`; control **55**, STAFF SMS **50** |
| Customer | source `e853b25ee26828f1866e21c94c31dc4347984a17`; deployment `dpl_7jSVYPR1mP7A1fQPXsNaGcFKLTt9`; host `atlas-grading-customer-prd6k56a3-ten-kings.vercel.app`; control **19**, CUSTOMER SMS **14** |
| Database | staff ledger **68**, public ledger **112** |
| Paid/progress gates | **disabled**, no production Stripe overlay or webhook installed |

Current week: `2026-09-28T07:01:00Z` through `2026-10-05T07:01:00Z` (Monday 00:01 Pacific). At 18:34 Pacific signed private and public reads agreed: v2 SHARED/AVAILABLE, quota 1000, held 0, accepted 0, remaining 1000. Later live browser reload also showed one pool and 1,000 remaining, with no console errors. Counts are observations and can change.

Private replacement preserved the complete environment, 16 native artifacts, 29 QR dependency packages, 14 CPU/28 GiB profile, address `172.29.69.2`, and 125-second startup fence. Old e853/container `884779c7` is retained stopped, restart-disabled, network-detached (exit 0/no OOM). Do not restart it as an unplanned rollback.

## Evidence map — retained on disk, not duplicated

All paths below are under `/Users/markthomas/.codex/atlas-handoffs/` unless absolute. They are existing evidence, **not reusable execution authority**.

`atlas-shared-capacity-rollout-20261001/` is the completed release packet:

- `public/qa/canonical-2026-10-02T01-06-23-103Z.json`: 126 canonical GET/HEAD checks; 74 candidate checks also passed.
- `native/qualification-result.json`: 1,620 JS + 43 Python tests, zero failures/skips. SHA256 `2a04423bf4d5ac80d23efe91e9c869143c478e32abd323bd68f1881c7fb41424`.
- `runtime/ready-final-result.json`: PRIVATE_COLD_LISTENING; SHA256 `4673fdada1b05d1d33757ea80274b23116a6b4a4cddb09968e7bed95c3759e69`. `ready-first-result.json` was only the startup waiting observation.
- `controls/restore-result.json`: SHA256 `94aa31a2502946ca6bd449c836c0946a714c30342476970ec8a4b45f56a3bfea`.
- `schema/schema-apply.result.json`: schema 67→68, all prior full rows preserved; SHA256 `86e7261663cb736d0656a56e93c6d5d439df59cd095ece1ceae8ff9fe1b7fd1d`.
- `quota-r2/quota-apply.result.json`: AUTHORIZED_WEEK_QUOTA1000_VERIFIED; SHA256 `b13a7e7760fa557d173fb2cab46b2b9a93f80f19572d73b42010dd4afd4cc317`.
- `capacity-probes/post-quota-final/consumers.json`: signed actual private/public/DB proof; SHA256 `71120e57723a6d8b01c5b7baa007676a2b495caa0d0b1ad95705613d72d298d2`.
- `capacity-probes/probe.py` is a read-only, pinned current-release probe (GET/SELECT + signed aggregate-read POST). Its CLI takes `--schema 68 --quota 1000 --ready-receipt <ready-final-result.json> --output-dir <new direct child of capacity-probes>`. It requires a fresh output and exact current bindings; requalify for any later release rather than weakening checks.

Original quota executor refused before any intent/write due to a mistaken requirement that all historical public migrations be successful. Sixteen public rows retain unfinished/rolled-back/zero-step history. Separate quota-r2 fixed the guard to compare all 112 rows exactly; 21 tests passed, and only r2 performed the first real write. Do not replay either packet. Runtime/schema/public/quota success intents are consumed. The old public preservation receipt predates the later private replacement; it does not describe the final private identity.

Schema SQL: `frontend/atlas-app/prisma/migrations/20261001006000_atlas_shared_weekly_card_capacity/migration.sql`, SHA256 `7bcf0d768e9639fb37f0bfc1ec255c565114bd0c953b02cc1f4881793c7f9633`. Registered Prisma 5.22 apply uses 1-second connection lock and 15-second statement bounds. Shared capacity locks one explicit week under READ COMMITTED; stale other isolation fails closed. Holds include uncertain payments; paid consumes once; cancel releases once.

Repository overview: `docs/atlas/audits/2026-10-01/shared-capacity-launch.md`.

## Stripe: no more key-copy loops

Protected local directory:

`/Users/markthomas/.codex/atlas-handoffs/atlas-activation-audit-20261001/stripe-connection`

- `credentials.json` contains accountId, secretKey and publishableKey. Directory 0700; file 0600. **Never cat it, print it into tool output, pass values on command lines, put it in Git, or ask Mark to paste it in chat.** Use process-local file reads directly into approved provider requests/configuration.
- Expected account: **`acct_1ULu5FGlGXoKJ35h`**. Never use the Ten Kings Stripe merchant.
- `capture-stripe-terminal.py` successfully received both keys with `getpass`, no echo/history/network. Mark's latest successful Terminal transcript said SAVED. There is no need to repeat capture.
- `verify-stripe.mjs` and `account-verification-first.json` record two GETs only: account and tax/settings. The result is ACCOUNT_AND_TAX_READS_QUALIFIED. `productionConfigured:false`; publishable account binding NOT_VERIFIED; tax registrations NOT_PERFORMED; checkout readiness NOT_ASSESSED. It used account default API version (`requestedApiVersion:null`).
- Restricted key permissions were prepared for Accounts read; PaymentIntents write; Tax calculations/transactions write; Tax settings/registrations read. Actual read requests passed. No live mutation has qualified the write paths.
- The abandoned localhost form at port 62976 is stopped. Its strict Origin check conflicted with no-referrer and caused Request refused; root acknowledged this bug. Corrected synthetic tests are not evidence of actual key capture. Terminal capture is the successful path. Do not reopen that form or blame Mark.

External payment packet:

`atlas-stripe-restricted-key-20261001/SHOP_CHECKOUT_EXECUTION_PLAN.md`

This is the concrete next-step source/configuration plan. The four-file compatibility patch is now integrated in 3a840477, not pending. `qa/root-integrated-commerce.txt` is root's 84/84 proof. `qa/shop-launch-configuration-proof.json` proves actual shop adapter construction without FedEx/Terminal/printer, mail refusal before dispatch, mandatory receipt-config refusal, zero network.

Webhook proposal, not yet created:

- Account: ATLAS live, **Your account**, not Connect/organization.
- Exact endpoint: `https://private.atlasgrading.com/internal/commerce/stripe-webhook`.
- **Snapshot** event `payment_intent.succeeded` only. The handler verifies signature/raw bytes, mode/account, persisted attempt/quote and an authoritative retrieved PaymentIntent. Browser redirect alone never marks an order paid.
- Failed/canceled events currently do not update holds through that handler; adding subscriptions does not create that behavior. Customer reconciliation handles cancellation separately.
- Explicit stable API candidate from official docs: `2026-09-30.endive`; it must be qualified with the actual key and pinned consistently in API/webhook configuration. Existing test fixture version 2024-06-20 is not a deliberate production choice.
- Capture the exact destination `whsec_` signing secret privately. No webhook-management key permission is needed if using Dashboard.
- Existing ingress supports this exact route; freshly read back before provider setup. A cold handler returns 503 and no checkout is opened merely by creating the destination.

Browser-specific confirmation policy requires action-time confirmation for creating/materially expanding security-sensitive access. Prepare the precise endpoint/event/scope first; don't invent a vague approval loop. A new webhook transmitting payment snapshots to ATLAS may trigger that rule. Explain the tool policy if confirmation is needed. Never bypass policy by switching tools after a rejection.

## Current launch blockers and decisions

### Receipts and card-progress texts

Mark just confirmed: he uses Twilio for ATLAS signup/login, likely in the existing **Ten Kings Twilio account** because a prior Codex agent advised reuse. He explicitly wants SMS receipts and grading-status updates and is frustrated prior attempts never finished. He asked what SendGrid is; root explained that it sends email, while SMS uses Twilio Messaging rather than Verify. Do not make him create a second Twilio account before inspecting existing approved setup. Ten Kings Stripe prohibition does not forbid the shared Twilio account.

Actual software currently requires both SendGrid and Twilio receipt adapter configuration, even when an individual customer omits email. Every phone-shop paid order queues SMS receipt + tax transaction; optional email adds an email receipt. Progress delivery has its own disabled gate. No SendGrid account is known. Existing Verify `VA…` service and legacy AccountSid/AuthToken/From are not automatically the required approved receipt `SK…` API key + `MG…` Messaging Service. No actual receipt has been sent.

A prior names-only inventory found no ATLAS receipt sender/business binding or SendGrid config. That doesn't prove the account lacks them elsewhere. Read-only inventory preparation is complete: the existing ATLAS Verify credential source is the staff/customer Vercel projects, not a proven private-runtime environment. The old film agent documented exact same-account Messaging Service/sender/registration GETs and protected handling; no new executor or provider requests ran. Details are in the final agent supplement. Do not print credentials or change existing Ten Kings messaging. US application texts require the relevant number/campaign approval; verify actual state, don't promise same-night approval or claim Verify approval covers receipts.

### Public customer admission

The current DB claim guard still restricts CUSTOMER to the originally configured phone/destination hashes. Removing historical test budgets did not make signup public. Existing protections include binding/provider/revision verification, 60 global / 12 client / 4 phone sends per 15 minutes, 1-minute phone cooldown, unknown-operation quarantine and max 5 verification attempts. The old 10-send/$5/7-day pilot caps were deliberately retired September 11; don't silently reinstate them.

An external narrowly scoped default-false CUSTOMER public-admission proposal is complete, preserving STAFF restrictions and all rate/idempotency checks. It is not integrated/deployed. Actual PostgreSQL 17.10 qualification passed seven assertion groups with real CustomerAuth and restricted roles, synthetic Verify and zero network. The fixture had 68 staff/95 source public migrations, not a restored production 112-row public ledger; it was stopped and removed. Proposal and final handoff are at `atlas-public-customer-admission-20261001/` under the external handoffs root. Existing input accepts international E.164; no US-only policy or hard spend cap has been qualified. Resolve intended audience/provider fraud settings before claiming broad launch. See final agent supplement for hashes and test status.

Any new customer web deployment needs exact CustomerControl + CustomerServiceControl + private service binding + CUSTOMER SMS binding updates together. Payment CSP must be enabled on that web deployment; it receives no Stripe secret. The current shared-FULL copy fix is in source but the retained customer e853 deployment predates it. Create a fresh coordinated release plan; never reuse the schema67/empty-environment cold-runtime authority.

### Center Court Cards

Only authorized dealer: **CenterCourt Cards, 307 Lincoln St, Roseville CA 95678**. Existing directory record is contact-only, with no coordinates/expiry; operational census was zero locations. User selected Friday **12:00 noon cutoff** and Friday **12:00 noon return**. Root has stated and user most recently confirmed **the following Friday** for return.

Root asked actual collection day/time and quoted those cutoff/return times; user answered **“correct”**. This confirms the quoted times but does not provide a distinct collection time. Root told him actual pickup remains unspecified. Do not silently convert cutoff into pickup.

Important current algorithm: return slot must be at least seven local days after collection. A Friday pickup after noon misses next-Friday noon and selects the following week. Resolve actual pickup or deliberately review the product rule; don't misrepresent the promise.

Configure genuine location IDs/token, actual position, Pacific timezone, authorization period and schedule. Resolve technical identifiers yourself; ask Mark for business facts and receiving employees, not UUIDs or configuration hashes. Closure exceptions are not known. Terminal/printer IDs can be NULL in customer-phone shop flow. Real receiving employee(s) need verified customer accounts/location membership. Prior read-only census had one genuine REVIEWER but zero operations grants at that checkpoint. Configuration requires a current bound operations grant and real reviewer session under five minutes old. Reuse real identities after fresh verification; do not invent one or fabricate physical custody. Staff/private dealer gates are still off.

### FedEx and mail-in

User selected customer-paid shipping **both directions**. He needs to set up an ATLAS FedEx account and previously asked PO box versus office. No final receiving address or carrier credentials supplied. Pending unanswered question from old lead: “Is the ATLAS FedEx account ready, and what office street address should customers mail their cards to? Address only, no credentials.” FedEx needs an appropriate street receiving address and measured shipping/package plans; don't invent them.

Shop-only checkout can be qualified without FedEx: omit all four FedEx fields together and use shippingPlans `[]`. Mail payments stay unavailable until shipping is genuinely configured. A partially filled carrier config can prevent adapter construction. This is an available sequencing choice, not a completed shop launch.

### Tax and real acceptance

Active Stripe Tax settings do not establish actual registrations. Retrieve explicit-version account/settings/registrations with bounded sanitized GET-only tooling; qualify actual grading/shipping tax codes and jurisdiction/sourcing. The adapter sends explicit tax codes and uses mail return address/shop registry address. Do not choose a fixture code or invent legal registration requirements. The new `atlas-stripe-restricted-key-20261001/qualify-stripe-readonly.mjs` helper and official version evidence are complete; ten offline tests passed. It has not read actual credentials or made provider calls. Review its README/source/manifest, then run the exact GET-only observation if appropriate; the supplement records its hashes.

Actual end-to-end acceptance remains with a real consenting customer and scoped employee: legitimate saved/reviewed cards → shop quote → original PaymentIntent → customer confirmation → authoritative webhook/reconciliation → one paid order and receipts/tax effect → handoff QR → real custody receipt. No live paid test, notification or fabricated custody is authorized merely by this checklist. Honor browser financial handoff rules when applicable.

## Design/media continuity

Authoring directory: `docs/atlas/design/experience/site/`. Locked hero baseline is source 3d6bbbfb, 19 files and literal section; don't alter it. Keep original evidence separate from AI presentation imagery. Fingerprint story is proprietary: do not reintroduce the removed algorithm explanation. NFC product boundary is `static_url_v1` with `FEIJU_F8215`: the tap opens the saved report and the human compares the physical card with its evidence. Do not imply automatic counterfeit detection or cryptographic authentication. No unsupported “most secure”/uncopyable claims. No fake customer names, order activity or countdowns.

Approved direction from Mark: simple childlike short stories about what/why; interactive explodable NFC anatomy better than a four-step player; personal young fast creator video, vertical framing and phones held vertically, narration/selfies, every cut exactly 2 seconds, 12–20 seconds total. He rejected the three repeated impersonal montage videos. Do not regenerate those or install the pending ad without creative acceptance.

Current personal ad:

`/Users/markthomas/.codex/atlas-handoffs/atlas-personal-ad-20261001/service/atlas-personal-web.mp4`

16-second 9:16 export: 14 seconds creator native speech plus a 2-second actual report insert. No unbenchmarked “submit in 90 seconds” claim. Two reference links he liked are in the old user conversation; this new ad is a separate review item. Higgsfield Plus is paid and user fully authorized asset generation; stop asking about a “free edit.” No more generation is needed just for the transfer.

Live user links:

- https://atlasgrading.com/#nfc-technology
- https://atlasgrading.com/account/submit
- https://atlasgrading.com/admin/grading

Existing loopback walkthrough may still run at `http://127.0.0.1:4361/?scene=signin` (session 2670); it is explicitly synthetic, not live paid checkout. Capacity DOM fixture may run on 8178 (session 54146), and authoring preview 4364. Do not confuse historical localhost previews (4280/4345) with production or restart anything blindly. Only stop processes you can establish belong to this task.

## Browser and tool continuity

The real signed-in Stripe session was in native Chrome profile **Mark (atlasgrading.com)** at `https://dashboard.stripe.com/acct_1ULu5FGlGXoKJ35h/apikeys`. Native app control follows the currently focused window; Mark has since been using another Chrome profile. Do not click stale indices or fight his unrelated browsing. The extension browser profile was Ten Kings and the Codex browser Stripe tab was still signed out. Don't assume the key save signed either browser in.

Persistent CUA bindings from the old chat do not transfer. Start with documented discovery for the needed surface and inspect fresh state. Never expose live key fields in full AX output/screenshots. User can help focus the right Stripe window if required, but credentials are already securely captured, so no repeat key-copy request is needed. The old local form server is closed; any remaining form tab is stale.

Fresh-lead package directory:

`/Users/markthomas/.codex/atlas-handoffs/atlas-fresh-lead-20261001`

It contains final live-browser evidence, an agent supplement, a manifest of authoritative receipts, and transfer metadata. No key values are packaged. The final screenshot and `live-browser-check.json` show one shared pool/1,000 after explicit reload; navigating only to a different hash had retained the old open document until reload. No new deployment was needed.

## Incoming lead's first actions

1. Read this handoff, the final external agent supplement and manifest, then verify canonical checkout/HEAD/clean state and only the mandatory docs' current sections. Acknowledge the factual launch boundary to Mark.
2. Start the two requested fresh Astra Extra High subagents with separate ownership. Consume the prior agents' prepared work; don't make them rediscover completed releases or rewrite the hero.
3. Finish the scoped read-only Stripe version/tax and shared-account Twilio inventory, resolve the webhook using the correct logged-in browser, and prepare exact missing settings for Mark. Reuse hidden Terminal input for any remaining secret. Do not ask for the already-saved Stripe keys.
4. Advance the public customer admission and optional-email/provider design deliberately, with meaningful targeted proof. Coordinate dealer schedule/membership and mail prerequisites. Give Mark a real workflow to exercise when genuinely ready.
5. Only after a concrete qualified successor exists, execute a **fresh** coordinated private/customer/control release with current schema68 identities, unchanged unrelated config and fresh zero-work census. Mark may be grading, so fence/drain without force-killing work. Record plans/results. Keep future quotas, payments and notification dispatch bounded to actual authorization.
6. Finish actual launch/acceptance and report remaining limitations honestly. The old lead stops production/source work after this transfer; there must not be two simultaneous lead writers.
