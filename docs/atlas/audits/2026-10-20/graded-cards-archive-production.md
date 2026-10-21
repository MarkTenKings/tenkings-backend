# ATLAS Graded Cards — production release

October20,2026 Pacific / October21 UTC. **Technical deployment completed; owner screenshots now confirm signed-in gallery access and design approval. Full interaction acceptance remains outstanding.** No admission hold remains. The canonical route is https://atlasgrading.com/admin/graded-cards and correctly redirects unauthenticated visitors to normal staff sign-in. The user confirmed availability for the final check; no code or fabricated session was requested.

## Delivered behavior and scope

- Reviewer-only Graded cards navigation, white gallery and table, complete authorized archive search, category and inclusive UTC approval-date filters, snapshot paging and honest empty/error/missing-media states.
- Saved approved identity, certificate, grade, approver/review staff and recorded submission/customer/dealer context. One physical card per result with its latest approval at the query snapshot. Submission associations do not assert ownership.
- Existing card workflow, exact versioned public report and exact linked order destinations. Actual approved photographs, recorded slab photos when available and explicitly labeled illustrative slab previews. No synthetic inventory or invented full-resolution masters.
- No listings, prices, checkout, payment, transfer or ownership claim is introduced by this archive release. Sports attributes, staff Card history/SQL009, My Collection and remaining marketplace work are tracked in the [master plan](../../plans/ATLAS_MARKETPLACE_MASTER_PLAN_20261020.md).

## Exact deployed identities

Web/operation source `c4b7cc85f01754eb5776042147e6c0fdf50f845a` is deployed to staff `dpl_AmUUXzXbNpHPB6ZSrcpCZ4VqjGbX` / `atlas-grading-staff-chbqd5o92-ten-kings.vercel.app` and public `dpl_CeohHmXm57UeSmktNQAP7JGioN1h` / `atlas-grading-public-75b283s70-ten-kings.vercel.app`. Public content/photo behavior remains the retained showcase; its staff-origin binding changed with the archive deployment. Exact production targets and alias sets were observed after both promotions. Project settings/environments were unchanged.

Native-only successor `31c6685e8ae49e05c8f78b748a6233d143776131` uses image `sha256:f64dfc31485603df756ec9cd64976fda8cc5effe8b0155fa727a45fb82b4fa52`, main `4137c69637f07ebed4c70463ae81d0d7030dd3859b54d3b294e3cd399f4d05a2`, worker `bb4840ec80850dce8a22eba59bc9e5ae56538696ffb31e6adbd4e97c3e178f80`. It corrects restricted-worker startup without broadening any role's grants. Web source metadata remains truthfullyc4b; executed web traces do not import that changed native composition. Actual composition tests and232/232 isolated Linux tests qualified this image; full release staff suite768/768 passed.

Customer retains `c68e9ea7c77b35fc53cab6ee162e063dfb02b0fe` / `dpl_2aW7K6CTUftYNKaWanBouvgUaDS5`. Registered008 was installed with manual-only EXECUTE. Staff/public/STAFF SMS controls advanced135→136/96→97/103→104 with the newly derived staff config hash; customer83/CUSTOMER SMS35 and all other controls were preserved. Only the reviewed exact archive GET matchers changed at both gateway layers.

## Qualification and observed preservation

Canonical GET acceptance verifies exact homepage and archive bundle bytes, normal staff sign-in redirect and401/no-store archive denial without credentials. Four retained approved packets/pages and eight photograph byte hashes passed. These are saved approval-bound grading photographs; this does not establish that each is an untouched raw intake upload.

The final pre-release preservation snapshot verifies unchanged business records and schema ledger after the intentional008 installation, all31 prior READY market results and saved labels, with only the approved control transition. Native validation proves healthy exact new services, zero restarts, unchanged source/environment/start times,38 non-proxy containers matching seal and the reviewed inner proxy change only. This is not a load/performance benchmark.

The same bounded admission holder was explicitly released at2026-10-21T06:42:09.621Z. Fresh proof at06:42:37.838Z establishes no holder session or exclusive admission lock remains. No automatic reacquisition occurred. No grading approval, paid comp request, label print, NFC write, customer notification or commerce transaction was performed for release acceptance. Two preserved historical variant requests remain UNKNOWN; no payment/completion outcome was invented and no provider request was replayed.

## Reconciled execution stops

1. Initial008 attempt stopped beforeDDL because node-pg Date values differed from persisted JSON strings. Read-only proof confirmed no effect. Separate attempt02 used exact database timestamp text retaining microseconds; actual-runner ownedPG qualification reproduced the original refusal, exercised drift checks and passed migration/ACL/preservation/replay checks. Original intent/failure remained intact.
2. Outer Caddy reload succeeded once; postcheck then rejected a changed raw Mounts-array hash. Independent comparisons proved only array order changed, with identical complete mount objects and all unrelated containers unchanged. Disk file/inode/ownership and actual live admin configuration matched the candidate. File-only reconciliation preserved the consumed empty output and failure evidence; no second reload occurred.
3. The final file-only native-health validator encountered Python3.9's inability to parse Docker's nine fractional timestamp digits. A separate validator preserved all digits with Decimal and passed seven tests, including one-nanosecond order and malformed refusal. A fresh read-only snapshot then passed unchanged service checks. No production correction was required.

## Evidence

Packet: `/Users/markthomas/.codex/atlas-handoffs/atlas-marketplace-foundation-20261020/release-02/`. Private artifacts remain local and may contain credentials or private metadata; do not publish their contents. The table records result hashes only.

| Check | Packet-relative receipt | SHA256 |
| --- | --- | --- |
| Registered008 commit | `database/result.json` | `cfb0db4cde0d5ca2992eae7fc74a798508d7b41bcb6fccc4f153a588c192fa75` |
| Native seal | `native/seal-result.private.json` | `aed71ffefa14c370e64bf28988e0133aa1c1d599e51f4c77f9a516204c72db19` |
| Inner gateway | `gateways/inner-activation-result.json` | `03eeed1c1ec30b73fcfe34ee7bc7726dbbb21a25c14a21552d1c992b9caedccf` |
| Outer gateway reconciled | `gateways/outer-activation-result.json` | `75725777dd7f44638c63772b271d6c32c5bf39f40bd162821aa9efa4e4b47eab` |
| Atomic controls | `controls/result.private.json` | `a18e2837056be808288f1f6854feade900f5683ef5c52631ec2cde44c2e7690a` |
| Staff publication | `publication/forward-staff-result.json` | `2207380062217a78a6d8a6de41f361825f22a1ca299ccd0583b9dcf5d5391777` |
| Public publication | `publication/forward-public-result.json` | `5d2185dfd02e8a4a390af2498d7dc5ebf8229dcff117aa9fe65e864fb43d7b71` |
| Canonical technical checks | `acceptance/technical-after-cutover.json` | `3fbcbc75b03081dccfb6203c84ab45e3b5607ceda8dac5c677e142f942d814c7` |
| Four reports / eight photographs | `acceptance/reports-after-cutover.json` | `972479245ae23ecc89685c226850a10c3953de60b299f3bdf3b9b9b6ad7a796a` |
| Final data preservation | `data/final-postflight.private.json` | `ec377487a88c27827ab2c70e88d63c565987bd98e8e6c31298c1e66bf5b81789` |
| Native health | `acceptance/native-health-result-02.json` | `228d4a6da58b21dc693358717cca9373127336ed366645eeabfd07dbf9fdbef9` |
| Explicit hold release | `admission/released.json` | `1f9c8aa6acfd4c5d410beb705796621e4999888549f003d7013f2230853d64df` |
| Fresh hold absence | `admission/released-absence-final.json` | `6e2dda46e9012d8a9222f3d5491e857add29f22d6f7b10378d1cd0b520a5cc7e` |

An independent file-only final review verified all60 local hash-bound receipt references. Immutable FINAL_PACKET/FINAL_EXECUTION artifacts describe preparation, including the superseded first migration attempt; actual completion uses the separately reviewed attempt02, outer read-only reconciliation and native-health-v2 described above.

Consumed intents must not be rerun. Recovery requires a new observed/reviewed plan and monotonic controls, keeps additive008 and uses a retained-image successor rather than restarting the retired generation. The prior source, integration and rollback qualification artifacts remain historical evidence.

## Remaining human acceptance

After the owner signs in normally: confirm real approved cards in Gallery/Table; search a visible certificate and verify category/same-dayUTC filters; open the exact saved card/report and compare identity/grade/front-back photos; inspect an exact linked order if such a record is present. Record missing examples as unavailable, not passed. Current screenshot `acceptance/production-sign-in.png` establishes normal sign-in only. Real archive access and browser acceptance are not yet claimed.

## Owner gallery review — October20,2026 at23:51–23:52 Pacific

The owner supplied three Chrome screenshots at the canonical production archive, displaying four approved cards, and stated the page looks good. The later screenshots show all four slab previews. The first shows two Photo unavailable placeholders; record image-delivery reliability for investigation without assuming a cause. These screenshots establish actual signed-in gallery access and owner approval of the gallery design, but do not prove search/filter/table/paging, exact linked-order navigation or complete report/media interactions. The owner says the clicked-card destination needs work; Open card currently opens the existing manual grading workspace, and the dedicated card-detail design remains planned. No user-supplied login code was accessed and no new production effects were performed during this review.
