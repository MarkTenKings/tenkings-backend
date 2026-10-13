# Independent ATLAS: extraction, cutover and retirement

Owner direction: October 12 Pacific / October 13 UTC, 2026. **R16 cutover is complete:** application `14411f8611789f565587067f41b8a5f2b7c96b46` serves all three canonical surfaces using the dedicated ATLAS database. Historical artifact/schema retirement remains underway. Exact observed identities and receipts are in [DEPLOY_RUNBOOK](../../runbooks/DEPLOY_RUNBOOK.md); this plan does not turn unfinished retirement or human acceptance into a completion claim.

Mark explicitly authorizes a dedicated ATLAS database, removal of every ATLAS connection to Ten Kings, deletion of obsolete ATLAS versions and historical card remnants, deletion of the five formerly retained inventory photographs, and removal of the offline learning activation tool. He clarified that old/shared backups must be retired; future backups containing only independent ATLAS data are allowed. Existing Ten Kings inventory, ownership, payments and other unrelated business records are not disposable ATLAS artifacts.

## Decision

Extract the current grading product into independent infrastructure and build a current-only database baseline. Do not rewrite the image, geometry, scoring or review engines to change their storage ownership. An independently delegated Astra Ultra review reached the same recommendation after inspecting the source and retained production evidence.

This is a new database **cluster**, not another schema or database on the old cluster. Use independent database users, passwords, connection pools, object storage credentials and deployment configuration. No dual writes, legacy reader, Ten Kings catalog fallback or old-cluster recovery setting is retained in the serving application.

## What the shared database did before R16

| ATLAS function | Current owner/schema | Independent destination |
| --- | --- | --- |
| Staff sign-in, access and current release configuration | `atlas_staff` | ATLAS staff schema and current-only privilege contract |
| Customer accounts, quotes, orders and payments | `atlas_customer` | ATLAS customer schema; preserve actual transaction facts |
| Dealer accounts and memberships | `atlas_dealer` | ATLAS dealer schema, without invented accounts |
| Grading state, corrections, approvals, report/label/market state and candidate learning | `atlas_manual` | ATLAS grading schema, with no historical physical-card import |
| Intake and uploaded pair metadata | `atlas_manual_intake` | ATLAS intake schema |
| Provider preparation, durable jobs, variants, reference cache and native runtime coordination | `atlas_manual_connected` | ATLAS connected schema and owned references |
| Defect analysis requests and observations | `atlas_defect_analysis` | ATLAS analysis schema |
| Ten Kings catalog reads, image retrieval and outbound reference/observation proposals | `collect.tenkings.co` facade over Ten Kings catalog tables | Remove the facade client and contributions; use ATLAS-owned manufacturer/Scrydex/SoldComps data and local references |

The old database is not itself an AI memory. Learned influence comes from explicitly selected example records and application retrieval. Infrastructure separation eliminates the unwanted access and recovery paths; the empty active learning release separately eliminates historical lesson influence.

## Observed R16 cutover

- Dedicated PostgreSQL17.11 cluster `atlas-grading-pg17-20261013`, database `atlas_grading`, has a current-only baseline, five fresh application roles and no shared public AiGrader structures. Current source has no Ten Kings catalog client or legacy report-reader branch. Every live ATLAS database URL points to this cluster.
- Final exact transfer copied29 account/financial/capacity/fresh-control rows. It imported no physical cards, lessons, sessions, old provider responses or historical reference cache. The624-source manufacturer bundle remains. The active learning baseline is fresh and empty; offline activation tools are deleted and future samples remain inactive.
- Old writers were stopped/disconnected before transfer. New main/worker became ready, target controls activated, all three web surfaces promoted and verified, and restart policies sealed. The tested old report returns404. All eight old ATLAS database accounts now have login disabled, passwordNULL and no remaining sessions.
- Five former grader PNG copies are deleted;35nullable image fields are clear, with10required dead strings awaiting a compatible missing-photo change. Old Vercel/native artifacts and held archives are being removed from exact inventories; old shared schemas and managed backup expiry remain separate work.
- ATLAS storage uses a verified bucket-restricted existing credential; do not describe it as newly rotated. Native HTTPS ingress still traverses an existing Ten Kings-host reverse proxy. This is an explicit remaining transport dependency, not database/catalog coupling.
- Canonical/public deployment verification and native/schema qualification passed. A fresh authenticated real-card workflow, physical printing/NFC and universal catalog/photo acceptance have not been established.

## Historical evidence driving the implementation

- Fresh DigitalOcean console inspection identifies the mixed cluster as `db-postgresql-nyc3-83816`, PostgreSQL 17, NYC3, 2 GB RAM / 1 vCPU / 30 GiB, primary only. Its displayed monthly rate is $30.45. This is the existing cluster's rate, not a promise of new infrastructure pricing.
- The current three web applications and their workspace dependency closure contain 29 packages. Four reusable engines carry the Ten Kings namespace; algorithm reuse does not require database or network access to Ten Kings. The independent artifact must own their source and build inputs.
- Current ATLAS functionality spans seven schemas. The retained relation census contains 160 ATLAS relations, which includes obsolete structures and is not the target table count.
- Five historical staff migrations reference shared `public.AiGraderV2Session` or `public.AiGraderV2InstrumentationEvent` composite types/tables and triggers. Blind replay of the old migration chain into the new database is not the migration strategy.
- Every staff authentication transaction currently checks a legacy-inclusive privilege contract. Removing old tables without correcting that contract would break sign-in.
- The public app still contains a legacy PostgreSQL report-reader branch alongside the current manual reader. The branch and its configuration must be deleted.
- The catalog client hard-codes `collect.tenkings.co` for six operations. A database URL change would leave this coupling intact.
- Retained post-purge reference evidence includes 3,369 cache rows and the manufacturer bundle contains 624 official sources / 1,144,344 explicit rows. These are reference knowledge, not past human grading lessons. Historical source coverage gaps remain real.
- The saved financial projection is one staff identity, one customer account, one ATLAS order/payment, three quotes, one provider event and two effects. Refresh these counts before transfer. A saved PAID value is not independent settlement proof.
- Fresh retirement inventory identified five copied PNGs totaling 16,377,848 bytes, with 45 image field references in five Items and five CardAssets. CardAssets also contain unrelated business information; they cannot simply be deleted as photo rows. Thirty-five photo fields are nullable; ten required strings need a proper missing-photo contract before their removal.
- Fresh runtime inventory found 407 stopped ATLAS containers across two hosts. Three running native services, unrelated containers, shared layers and host link-service dependencies are separately identified and excluded from blind deletion. Container image sizes cannot be added together to claim reclaimed disk space.

## Ordered implementation

1. **Record engineering knowledge.** Preserve the decisions below, current product rules and synthetic regression fixtures. Do not carry historical physical photos, provider payloads, grade records or restore scripts into the new baseline.
2. **Remove obsolete executable paths.** Delete the offline learning activation family, legacy public database reader, old staff privilege requirements/routes and Ten Kings catalog client/contribution execution. Keep future candidate collection and nonmutating comparison tools. No substitute automatic learning activation is introduced.
3. **Prepare clean schema and source.** Derive a reviewed current-only baseline from the active dependency map, qualify it on empty PostgreSQL 17, and package the three applications and two processing roles with only their required source. Do not clone the shared database, ship the old migration chain as a recovery path or import public legacy grading tables.
4. **Provision independent infrastructure.** Dedicated ATLAS PostgreSQL cluster/database, application roles/pools, ATLAS-only object storage and scoped credentials. Preserve required phone-hash/account lookup compatibility while rotating access credentials. Record exact provider resource identities without secrets.
5. **Transfer only current allowed data.** Accounts, actual ATLAS payment facts, necessary configuration, manufacturer/reference data and the empty learning baseline. Perform a fresh current-card census; a previous purge receipt is not authorization to silently discard newly submitted cards. Shared reference records must be checked for physical-card/example content before copying.
6. **Qualify without Ten Kings.** Start a candidate using only the new database/storage and direct provider connections. Prove sign-in, upload, generated-image authority, OCR/Astra xhigh, geometry/finding edits, variants, explicit approval, report/label/market flow and reference reuse while Ten Kings database/catalog access is unavailable. Keep software qualification and real human/physical acceptance distinct.
7. **Cut over once.** Briefly stop old ATLAS admission/writers, make the final narrow business/configuration transfer, and switch staff/public/customer surfaces plus main/variant workers together. One active writer set; no shared-database fallback. Do not fabricate a staff session, finding approval or final card grade.
8. **Remove old capabilities and artifacts.** Revoke old ATLAS database/storage/catalog credentials; remove old web deployments, stopped native artifacts, old ATLAS-owned schemas/functions/triggers, local card archives, restoration payloads and the five photographs. Use exact dependency inventories so Ten Kings business survives. Rebuild every remaining deployment that contains old database credentials. Check filesystem copies, container layers and any retained Git objects with historical card payloads rather than claiming a file deletion erases all copies.
9. **Retire mixed backups.** Follow the provider-specific strategy below and record actual completion. No old restore endpoint may remain a valid destination for independent ATLAS.

Retirement scope correction after full consumer review: the25 shared `public.AiGrader*` tables, their15 trigger functions/seven enums, `CollectibleCardV2` relation and Ten Kings `/ai-grader*`, `/c`, `/nfc`, `/card-maps` routes belong to the separately approved Ten Kings/Speedster product. Their current empty state is not authorization to delete that product. Preserve them independently; retire only the seven ATLAS-owned schemas, eight old ATLAS roles, their explicit residual grants and the three ATLAS-specific external identity-correction objects. Broad private retirement drafts01–03 are superseded and must not execute. ATLAS's new database and deployed source have no connection to the retained Ten Kings structures.

## Backup retirement

DigitalOcean documents daily automatic PostgreSQL backups with seven-day retention. Destroying a database cluster destroys its contents and automated backups. The current console exposes restore points from before the purge; opening that dialog was read-only and no restore was requested.

Sources: [DigitalOcean backup/restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/), [cluster destruction](https://docs.digitalocean.com/products/databases/postgresql/how-to/destroy/).

The fastest complete **ATLAS isolation** is independent cutover, credential revocation and removal of ATLAS from the live mixed database. Then verify all old mixed restore points have expired; do not equate waiting seven days with observed completion. Future backups of the independent ATLAS cluster are explicitly allowed.

Immediate destruction of the mixed cluster and all its managed backups requires first transferring and verifying **Ten Kings itself** on a clean cluster. It is a second production migration, not an ATLAS database setting. Never destroy the serving Ten Kings cluster to make an ATLAS erasure claim. Present this scope explicitly if immediate provider backup destruction is required. Do not create a new archive containing the old ATLAS data during that transfer.

Local mixed dumps and private archives are independent from provider restore points. Classify exact files, preserve necessary unrelated business facts in their live authoritative system, and remove authorized old ATLAS copies without making a replacement historical-card backup. Document any inaccessible devices or third-party retention instead of asserting physically universal erasure.

## Engineering lessons to carry forward

1. **One image authority.** Complete OpenAI generative removal first. Bind OCR, Astra xhigh identity/geometry/defects, review coordinates, variant comparison and report media to the same generated Front/Back pair. Originals are lineage, not a fallback.
2. **One geometry frame.** Include the full physical contour in saved-state comparisons and reproject measurements together. A guessed placement guide is not a detected printed border.
3. **Measure before scoring.** Keep defect measurement, scoring policy and model proposals separate. Historical corner/edge multiplier hypotheticals were not an approved numerical policy change.
4. **Visible failure is not a clean card.** A provider error has no defect result; preserve specific job status and reconcile accepted requests before buying another call.
5. **Reference discovery is not approval.** Manufacturer/Scrydex candidates and SoldComps evidence help humans; missing photos or strict label spelling should not prevent legitimate human review. Retain raw/unassigned listings and literal labels; never invent their variant association.
6. **Approval and delivery are separate facts.** Save the human decision once. Report formatting, labels or sales failures must not require a second grade approval. Use the same identity contract at review and publication.
7. **Feedback is inactive evidence.** Save future corrections for comparison. They become grading inputs only after Mark reviews the impact and explicitly approves the exact release. Delete reusable-policy activation shortcuts.
8. **Ownership must include recovery.** Separate schemas and role names do not separate cluster backups, external catalog APIs, container credentials or old deployments. Verify every layer and remove the replaced path.
9. **Qualification is not product acceptance.** Tests and deployed health prove their stated checks. Record actual fresh human workflow, physical label/NFC and provider-return evidence independently.

## Completion evidence

Completion requires independent proof that every serving ATLAS connection targets its own database/storage; no operative Ten Kings URL/credential/bridge exists; the current-only schema initializes without legacy public objects; the workflow works with Ten Kings access unavailable; candidates remain inactive; obsolete artifacts and authorized photos are gone; unrelated Ten Kings business facts are preserved; and old backup/archive retirement is either verified complete or explicitly still pending.

No completion date, speedup factor, universal accuracy guarantee or physical zeroization claim is implied by this plan.
