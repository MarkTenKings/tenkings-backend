# Shared-capacity launch — October 1, 2026

Verified October 1, 18:34 Pacific / October 2, 01:34 UTC. The public and private capacity readers, schema 68 and the current week's shared 1,000-card allowance are live. Existing grading admission is restored. **Paid checkout and progress delivery remain disabled.** This audit records the completed software/quota release, not payment or physical workflow acceptance.

| Surface | Verified state |
| --- | --- |
| Public | Source `a508b83e52c2c2406344e288a68c37bb5a37efba`; deployment `dpl_HmrAKKsTJCHkzPG1s3e1qGtKJSmo`; PublicReader 41; all four public aliases |
| Homepage | Package `c97eaa4760ab6368`, 66 files; accepted hero retained; rejected montage players absent; 126 canonical GET/HEAD checks pass |
| Private | Container `aa27ea7fa6e59a97cb61cdecf1730b50658f7e986955a8447e40d7c96558ec59`; image `sha256:cf3cbae8a674171f621f54943dae44e8214a69c0f64f9c45a96c2611d37daf06`; source a508; listening, zero restarts at readback |
| Staff / customer | Existing f49d / e853 web deployments and service bindings retained; enabled controls Staff 55 / Customer 19; SMS 50 / 14 unchanged |
| Database / capacity | Staff ledger 68; public ledger 112; one shared 1,000-CARD current-week row; both readers v2 `SHARED` / `AVAILABLE` |

The native image passed 1,620 JavaScript and 43 Python tests, with 1,139 source files verified, 16 native artifacts and the 29-package QR dependency closure preserved. Qualification ran offline without production credentials, model requests or database writes. This is the affected regression suite, not a claim that every repository test or physical customer workflow was exercised.

The private replacement fenced staff and customer admission with a two-row full-row compare-and-swap. All 13 active-work counters were zero at the fresh drain checkpoint. The predecessor stopped cleanly, was restart-disabled and disconnected, and the new container started with its complete environment unchanged. Original enabled settings were restored at revisions 55 and 19 during the 125-second boot fence; listening was then verified. Those idle counts describe the drain instant, not the current grading queue.

Signed private and canonical public probes first verified the new readers serving v1 on schema 67. Original registered migration `20261001006000_atlas_shared_weekly_card_capacity` advanced the staff ledger 67→68 through Prisma 5.22 with one-second lock and 15-second statement timeouts on every migration connection. Exact SQL SHA256: `7bcf0d768e9639fb37f0bfc1ec255c565114bd0c953b02cc1f4881793c7f9633`. The prior 67 staff ledger rows, all 112 historical public ledger rows, protected controls, grading/authentication definitions and serving-role grants were preserved. Both consumers then returned v2 shared capacity before quota configuration.

The first quota helper refused before any local or remote execution intent or write: it incorrectly assumed all historical public migration rows were successful. A separate corrected `quota-r2` packet instead preserved the exact baseline, passed 21 preparation tests and successfully applied the owner-authorized single row. Its result is `AUTHORIZED_WEEK_QUOTA1000_VERIFIED`. The period is September 28, 00:01 Pacific to October 5, 00:01 Pacific (`2026-09-28T07:01:00Z` to `2026-10-05T07:01:00Z`). Final signed private and canonical public reads both reported quota 1,000, held 0, accepted 0 and remaining 1,000. These are observed counts; mail-in and dealer drop-off consume the same allowance. No future-week quota was seeded and commerce/progress remained false. Consumed release and quota intents must not be replayed.

The separate ATLAS Stripe restricted live and publishable keys are saved locally through hidden Terminal input. Two read-only requests verified the intended account, charges/payouts enabled, submitted details, no outstanding account requirements and active live tax settings. The credential receipt explicitly says `productionConfigured: false`; checkout readiness, publishable-key account binding and tax registration verification remain incomplete. The restricted-key compatibility change is integrated and passes all 84 commerce tests locally; it is not in deployed a508. Production key installation, webhook receipt, FedEx integration, dealer schedule and physical workflow acceptance remain activation work. The 16-second personal creator ad is a separate owner-review deliverable, not part of this deployment.

Evidence lives under `/Users/markthomas/.codex/atlas-handoffs/atlas-shared-capacity-rollout-20261001/`; its `docs-handoff/evidence-index.json` retains full receipt hashes. The separate Stripe read-only receipt is `atlas-activation-audit-20261001/stripe-connection/account-verification-first.json`, SHA256 `bb4b7a473d322500cad744be726d1fed294ab38370c8faaefd6d30ac05f63f6b`. No credential value is included in this audit.

| Final receipt | SHA256 |
| --- | --- |
| `public/qa/canonical-2026-10-02T01-06-23-103Z.json` | `e582e2870568d99da1802a8d1c3d8b5d94ce1348f0cad548faf9185ea1420aca` |
| `native/qualification-result.json` | `2a04423bf4d5ac80d23efe91e9c869143c478e32abd323bd68f1881c7fb41424` |
| `controls/restore-result.json` | `94aa31a2502946ca6bd449c836c0946a714c30342476970ec8a4b45f56a3bfea` |
| `runtime/ready-final-result.json` | `4673fdada1b05d1d33757ea80274b23116a6b4a4cddb09968e7bed95c3759e69` |
| `schema/schema-apply.result.json` | `86e7261663cb736d0656a56e93c6d5d439df59cd095ece1ceae8ff9fe1b7fd1d` |
| `quota-r2/quota-apply.result.json` | `b13a7e7760fa557d173fb2cab46b2b9a93f80f19572d73b42010dd4afd4cc317` |
| `capacity-probes/post-quota-final/consumers.json` | `71120e57723a6d8b01c5b7baa007676a2b495caa0d0b1ad95705613d72d298d2` |
