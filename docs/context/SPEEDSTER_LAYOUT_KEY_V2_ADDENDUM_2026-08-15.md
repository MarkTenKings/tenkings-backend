# Speedster Pokémon Layout Key V2 Addendum — 2026-08-15

Status: reconstructed local candidate; not deployed. This addendum supersedes older Layout Key V2 planning statements where they conflict with the current evidence and owner direction below. Historical records remain untouched.

## Owner authority and sequencing

- Mark's Phase 0 grading continues on the current deployed application and does not wait for Option C, Layout Key V2, or Color Geometry candidate work.
- Candidate reconstruction may proceed in parallel. Production deploys remain serialized: Option C, then Phase 1, then Phase 2, each with its own evidence packet and Mark's explicit approval.
- No funding gate, auto-recharge gate, provider pre-capture readiness gate, silent retry, or silent fallback belongs in this work. A failure is visible, preserves completed operator work, and ends in an explicit human choice unless grading accuracy itself requires blocking.
- Mark does not grade Trainer/Energy reverse holos or author Trainer maps until Layout Key V2 ships.

## Current rescue baseline

- Mark's Aug 13 save moved the Front anchors to the four corners of the printed design area. It atomically created FAMILY r9 `cmssbc8fi0002jfswkc7ra2rl` and paired EXACT r5 `cmssbc8hf0004jfswua36k5bf` from identical reviewed Front/Back map bodies.
- FAMILY r8 remains intact immutable history. FAMILY r9 is Mark's intended rescue target. Front follows the four printed-design corners; Back follows the prior Back reference.
- The editor intentionally loads EXACT before FAMILY for the completed source. EXACT r5 is therefore the visible editing baseline and is geometry/content-equivalent to FAMILY r9 for this source. Their revision hashes are not equal because their key and authority metadata differ.
- Completed Phase 0 card `TKH-001259` (Charmander, 2023 Pokémon MEW EN Reverse Holo, 004/165) pinned FAMILY r9. This is read-only evidence, not approval to deploy this candidate.

## Layout Key V2 authority

- New Pokémon FAMILY identity is Category + operator-selected Layout Type (`POKEMON`, `TRAINER`, or `ENERGY`) + Year + Product/Set + Parallel. Card name and number remain exact-source identity/provenance only. Sports FAMILY identity and the frozen EXACT key serialization do not change.
- A historical Pokémon source with no layout authority remains EXACT-only. Its first V2 save requires one explicit human layout selection and appends one immutable source authority. That authority cannot be edited or deleted.
- Layoutless historical Pokémon FAMILY revisions remain readable historical evidence but are runtime-ineligible, filter-ineligible, and non-restorable. No existing identity, revision, pointer, decision, completed card, grade, report, label, image, or permanent-card record is rewritten.
- Registration-transfer authority may cross legacy source IDs only for a V2 FAMILY target whose explicit layout and map body match the acting immutable source authority. Layoutless EXACT promotion retains the same-source requirement.

## Draft and history durability

- A bounded, sanitized browser draft preserves capture/map-registration state across crash or reload. It contains no image bytes, URLs, credentials, or tokens and is bound to the exact session, profile, surface, and map authority.
- Resume and Discard are explicit. Server HMAC receipts remain final registration authority; browser state never manufactures one.
- A successful final server save clears the preserved draft before navigation. If browser cleanup fails, the saved server work remains complete and the parent surface displays a persistent factual cleanup warning with explicit Retry.
- `AiGraderV2CardTypeMapRevision` and legacy-source layout authority rows are append-only at the database layer. Restore appends a new revision; it never mutates historical rows.

## Release boundary

- The additive migration must be proven on a loopback-only disposable PostgreSQL database as a true pre-final-to-final upgrade over pre-existing layoutless and explicit-layout session rows. Their complete row, identity bytes, `ctid`, and `xmin` must remain unchanged.
- Before an approved cutover, run the read-only legacy-session/filter-decision inventory in the deploy runbook. Cutover requires quiescence so no old runtime can write after V2 identity authority becomes available.
- Only after Mark approves the exact Phase 1 candidate: quiesce Speedster, drain old web requests, verify no old instance can accept traffic, apply the reviewed additive migration, deploy the exact reviewed V2 web commit, prove exact source/schema/read-only behavior, and then reopen Speedster. Record every planned and observed migration/deploy action in the append-only session log.
- The first V2 identity or legacy-source layout-authority write is the rollback boundary. After that write, never route traffic to the old runtime because it cannot enforce layout-scoped FAMILY authority; preserve the additive schema and roll forward with the reviewed V2 runtime.
- No deploy, migration, restart, Production mutation, or map re-save is authorized by this document.
