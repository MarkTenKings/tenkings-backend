# Private ownership workflow readers — local proposal

The new reader SQL, server adapter and response contract are unregistered and have no runtime or HTTP exposure. They extend the disabled ownership/evidence foundations with exact certificate lookup, a customer's own claims and request recovery, and an independent reviewer's authorized queue and decision recovery. No read creates a claim, establishes title, changes evidence or makes an ownership decision.

The customer projection distinguishes a pending claim, an immutable past decision and currently-owned-by-you. Expired or policy-blocked evidence leaves the original decision unchanged and blocks review actions. A discarded card can retain the customer's historical receipt with no current card binding; reviewer reads refuse. Other claimants, current owners, contact details and private evidence bytes are omitted. Reviewer access requires both the current named authority grant and card ACL, excludes self-review, and rechecks authority after waits.

Certificate resolution follows the latest successfully PUBLISHED report even when a newer attempt remains PENDING. This is deliberate report/ownership-read behavior, distinct from curation writes, which require the latest attempt itself to be published. UI eligibility is a snapshot; the evidence writer still reauthorizes every decision.

Each audience uses a separate restricted SQL role with only its dedicated definer read function. Startup refuses table/sequence/writer/helper privileges, role memberships, schema creation or elevated rights. The server derives cookie digests and frozen deployment bindings; reviewer handles must originate from DurableStaffAuth's WeakMap. Authorization share locks mean these are non-mutating reads, not PostgreSQL READ ONLY transactions.

## Verification

Ten unit checks passed. Owned PostgreSQL17 PG02 passed six groups covering exact certificate/report binding, own-account paging and recovery, independent reviewer ACL/grant, actual60s evidence expiry and policy loss, restricted roles, preserved rows and observed lock waits. Ten read phases retained25table digests; all fixture changes have explicit surrounding baselines. Zero production queries, provider calls, notifications or financial effects.

Exact customer waiter57646 and reviewer waiter57647 were observed blocked by57629 before their known session/grant expirations. Both refused after expiry and unlock. The final discard race observed reviewer57647 waiting on the identity lock, committed the intake tombstone, and confirmed reviewer404; the customer's own pending receipt remained with card:null and BLOCKED review. PG01 passed earlier groups but correctly failed an attempted immutable owner change in the final fixture setup. PG02 changed only that setup to peer ownership plus explicit readers grant/revocation; both owned clusters stopped with verification.

PG02 result: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-workflow-reader-pg-02/postgres-result.json`, SHA256 `ae408a7d1ae63b8f313998713ee6abfd311b956e3d2f5f16530ee95432754ae8`. Cleanup SHA256 `02a8aa070313546d40726de50d42b2b170591cc83624a3386185df1bf84b665c`.

Final source SHA256: SQL `32063d8cc06bfe72e828a6686953692c6f2ce3c1d797e509522ca825f4ef2958`; adapter `eee0aae322602c0e4a36ec4bb33831c237c3ed51fd0cd2087f2137a54785b8a7`; contract `e8d2f0d92fedd1f85a71c2ef19ba45704036e57c640d31e762674404b3c9b325`; fixture `330e249a2e45a667a8ec7e6cea155935b75e94ee93a047edc041a44ef8d45ee3`. Original writer and evidence SQL/services are unchanged.

Practical proof upload/storage/retention policy, genuine reviewer provisioning, claim withdrawal/replacement, migration registration, authenticated routes, persistent UI, complete collection/provenance joins and operational activation remain unfinished. This qualification does not establish real customer ownership.
