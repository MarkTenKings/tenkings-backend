# Retained Back geometry recovery — September 22, 2026

## Checkpoint and acceptance boundary

**Deployed and verified September 22, 2026 UTC.** Source `053768aa` is live with automatic Back geometry recovery. Exact-photo qualification, private activation, public promotion, hosted checks and independent saved-card preservation review pass. Mark's signed-in saved-card/new-card optical acceptance remains open.

Mark reported Magikarp card `cb7846f9-b81b-4ec8-bc83-e218feaed449`: the saved Back photo was visible in Physical mode, but no automatic outline appeared; Printed mode was blank and incorrectly said it was waiting for a verified photo. Front physical and printed work already existed and had to remain intact.

Evidence is private and remains outside Git:

- Release root: `/Users/markthomas/.codex/atlas-handoffs/atlas-back-geometry-20260922-09df/release/` (abbreviated `R` below).
- Image diagnosis/local proof: `/Users/markthomas/.codex/atlas-handoffs/atlas-magikarp-back-20260922-09df/` (abbreviated `P`).
- Prior qualified originals/native baseline: `/Users/markthomas/.codex/atlas-handoffs/atlas-upload-recovery-20260922/`.

No original photo bytes, secret values, credential material or signed image links belong in this audit. Successful automated qualification does not constitute Mark's signed-in workflow/optical acceptance or report approval.

## Observed failure and narrow correction

The bounded current-card read found intake revision 9, Front version 1 and Back version 2 with saved photo sources, manual revision 1, zero actions and zero approvals. An immutable geometry read showed Front ENGINE physical/printed/prepared work intact while Back physical, preparation, printed and confirmation were null. Card metadata receipt SHA256: `4c78c21cfe7b84b0008b89734ad6e67945b82be571794d079bbb02b075e358e0`; geometry receipt: `80306339914ea22d30da97db45356c91b3d1e45a782ddf71e39afec30c352aae`.

Exact retained-image replay reproduced the cause: grayscale Canny lost the blue-on-dark physical border and selected interior landscape artwork. That legacy proposal was reported accepted by the shared proposer but failed the existing normalized physical-quad contract. Adoption correctly refused it. The image was saved; the missing data was physical geometry and the resulting rectified preparation.

`atlas_photo_geometry.py` adds an ATLAS-only fallback, imported by `manual_preparation_worker.py`. It returns every already-adoptable legacy result unchanged. Only an accepted but unadoptable legacy quad can enter recovery. Color-channel edges use the existing threshold calculation; a replacement requires four observed side-line fits, valid normalized bounds/order/area/convexity, enclosure of the failed region, visible selected mat at the photo perimeter, all four locally referenced side supports of at least 0.70, and no near-equal competing candidate. Missing evidence is never supplied by clamping, template corners or a bounding-box fallback.

The worker binds policy `atlas-native-photo-color-edge-v1` and the new module SHA into preparation identity. Recovered proposals carry engine `atlas-physical-color-recovery-v1` and provenance `ATLAS_NATIVE_PHOTO_COLOR_EDGE_V1`. Shared `card_geometry.py`, `color_geometry.py`, `defect_math.py`, `preparation_pixels.py`, their warp/printed/grade behavior, the native photo decoder, dependencies and database schema remain byte-identical to the previous qualified application.

Existing initialized drafts do not silently change on open. The existing journaled `PREPARE_SIDE` action now permits missing-physical detection only when the selected side has a saved image, no physical/prepared/printed/confirmation work, and zero physical/preparation/printed/review revisions; workflow also requires no existing defect workspace for this branch. The connected action checks the current source before CPU work, adopts the checked physical result, and prepares only that side. Existing authenticated revision/hash CAS and transactional current-source checks reject stale work. Saved human outlines retain their ordinary preparation path. No GET mutation, model call, confirmation or approval was added.

The UI offers **Detect edges automatically** for eligible saved sides, including Printed mode. It explains that the saved photo needs a physical outline before a straightened printed-border view can exist. Unsaved manual work hides automatic recovery; failure retains the original and manual outline option. It never substitutes original pixels for a verified rectified frame.

## Frozen source and local proof

- Runtime commit: `053768aa4474f950017c43b659648668631f6b9e`.
- Runtime tree: `db3af90336d384466a9b9700a7db9158d8d1d0e1`.
- Source manifest: `fa5cfd9ba265b23758a0d4f32b60844a3fe1736b8cdd386dd767ca939939b26d`, **593 files**.
- Exact reviewed source delta: `R/reviewed-source-delta-053768aa.json`, SHA256 `af9436b9e305bb357e7f0540ca08d9b0b340ed569f2adf4e8b0caa73b455b6e2`; **12 runtime/test file changes**. Independent traversal of the frozen Git workspace closure and every before/after byte hash matched this document.
- The existing PR #378 was fast-forwarded with this source and remains draft/unmerged at this checkpoint. Documentation commits after source freeze do not change the runtime identity above.

Local checks recorded in `SESSION_LOG.md` pass: 47 focused workflow/geometry/client/component cases; 513 full staff tests; staff production build and boundary; 10 generated-pixel detector cases. The focused suite covers exact Front/uploads preservation, human Back preservation, refusal after historical edits, preparation failure before commit, lost reply after committed action with exact receipt replay, concurrent Front edit rejection, and changed-photo source rejection.

The detector cases include an unmocked weak chromatic edge with competing landscape artwork, preserved valid legacy output, nonaccepted legacy abstention, invalid quads, truncated perimeter, interior printed distractor, unrelated shape, absent selected mat, missing fitted side and ambiguous enclosing candidates.

Four retained original decodes independently reproduced the prior qualified working PNG hashes. `P/local-proof-1/geometry-proof.json`, SHA256 `10940fd3202decbbc92a8b187842c277d859d34d8ad8795e25203edff6609c73`, passes on local Python 3.9.6/OpenCV 4.10.0/NumPy 1.26.4. Both Front physical and printed dictionaries equal the shared-engine output exactly, and all five Front derivative byte hashes match direct shared preparation. Both Back sources reproduce the old invalid interior-art region, then produce valid full physical outlines and accepted printed borders. All **20** prepared artifact hashes, byte counts and dimensions were checked. The lead and photo specialist visually inspected the desktop Back outer and printed overlays; these derived images remain private.

The pure four-photo qualifier is hash-pinned at `12fbbb71673d16e76b9bc622b7b6f5eefee8d39f4d3e14395662e9c681364af0`. Its intended-image wrapper rechecks all original/working associations against prior raw proof `9b9ee966682ec5f8f44d5273a7ee7339b2656d8283d1d69a0fa2025172ae1724`; it does not repeat native decoding because photo source and all 16 native artifacts are immutable. The strict independent validator follows raw proposal/artifact/source/runtime/container evidence. One explicitly synthetic positive receipt fixture and 12 negative mutations passed/rejected as expected; helper review `R/independent-geometry-helper-review-1.json` has SHA256 `8ccba373ec274c533a8435350694f0c6d8248d2668972b29de9a2e6624f69f29`. These synthetic validator checks are not the actual intended-image photo qualification.

## Intended-image build and regressions verified

The fresh offline source-only build inherited image `sha256:9fdbd82d3fc9af3acf3ec2c636360347579439f2d1b2cba2389f0c6bb33d00af` from runtime `a00f988568f29cbe01946213005ee50bd5e6b1d9`. No addon compilation, dependency installation or database operation occurred in this build.

Candidate image: `sha256:4f9e3bb553bb778d93e05b2da5c70c726562178430360e5beabe78e19a4d8ff7`.

- Plan: `R/native-context-053768aa/plan.json`, SHA256 `4b8e49503977528cfe3db5d15bea8bf0b6199aa2e485b23bf87e7ec824c44283`.
- Build result: `R/native-context-053768aa/build-evidence/result.json`, SHA256 `d4c6dc1bc98f2266c42dd550f6077601509fb6b3304426bcd919b5ae6e2c21c5`.
- The internal source receipt, external build result and pinned prior receipt `9174a41680007da16243c50997fa249002eaa5a65d548f415b3abaaca5071545` agree on **all 16 unchanged native artifact hashes**. All 593 candidate source files were verified. Runtime image configuration and nonowned container state were preserved.

Five sequential qualification groups passed against that exact image. Each result and raw log was independently rehashed; retained container inspection confirms exit 0, restart 0, no OOM, network none, read-only root, 1 CPU, 3 GiB memory/swap and 256 pids. Package/staff runs have zero failures, cancellations or skips.

| Group | Result | Result SHA256 |
| --- | --- | --- |
| Source | 593 source files and native identities pass | `83b8c3d5ba08523e7b84db5e0543df2c65112277c82e9901df70204e7e6d4690` |
| Boundary | Pass | `72ce0436b81c8329f4cd5ea05b366b171322acb9b06c633368a97da8809d2b78` |
| Packages | 594 tests pass | `882d3afb419595ed69fe86e02d2c92ec39cf0c4c95c6ceadc92b56b343e8d800` |
| Staff | 82 tests pass | `add6d50b6f70ea2ec6acb16631f6fca463883644db7dc9909632bed600989435` |
| Detector | 10 tests pass | `c019613fad40d2ccef30833d5cf19aa961c44d0d0787e265346aa9dd104930de` |

Receipts and raw logs are under `R/native-context-053768aa/qualification-evidence/back-geometry-09df-053768aa-1-{group}.*`.

## Matched web build and binding evidence

The seven web helper materializations match the reviewed templates, exact commit/tree and provider baseline; all imports resolve. Materialization record SHA256: `b2dfe8b7d67335607501a9f6922590974bf6fdfa9487d986418f5d615491eac1`. The stale predecessor import in the build-readback helper was corrected before materialization. The final hosted verifier retains all 33 earlier feature markers and adds four geometry-recovery markers; it remains bounded GET-only verification and cannot establish signed-in optical acceptance.

The staff CLI upload completed once with source and credential custody unchanged. Its guarded missing-file negotiation made two deployment HTTP exchanges (400 `MISSING_FILES_CONFIRMED`, then 200 `TERMINAL`) and 18 distinct file posts with no repeated file attempts. This is one guarded upload invocation, not two deployment retries.

- Upload result: `R/staff-upload-053768aa-1/result.json`, SHA256 `f11cc9620228e8080fd094126a00882c427c4d86ed0e52389dda3cda14deae0f`.
- Actual READY readback: `R/staff-build-readback-1/result.json`, SHA256 `b134bd5b5b4b8127197bf7e4694f11342b9108ee1934af474bcd7ae44e08ef12`.
- Staged staff deployment: `dpl_2qg5oUC78A4UG4NBWJKu9pS7mw2n`, immutable host `atlas-grading-staff-f86pk9uw5-ten-kings.vercel.app`; exact runtime commit, staff project, production target and Node 20 verified. It is READY/STAGED with automatic custom-domain assignment disabled.
- Constructor/private binding: `R/binding.json`, SHA256 `8fd15277e233f2810d81cb31351611e19fc0274c74e984a7712d5bf2d714a18a`. All 11 constructor source hashes match the frozen commit. The derived private environment changes only `ATLAS_MANUAL_WEB_DEPLOYMENT` and `ATLAS_MANUAL_WEB_RELEASE_SHA`; its binding config hash is `7714c0e0ae63336808aa8a067d2ae388aabcb4d88d45317d5b0496796ed9bfc2`. The binding proof performs no provider write and contains no secret values; it does not prove that this private configuration is serving.

One public-project environment PATCH staged `ATLAS_STAFF_DEPLOYMENT_ORIGIN` to that exact immutable staff host. The five other public environment keys are outside its mutation scope. Plan semantic SHA256: `84f95413a3e95b70dc778756362189511f325f3c836f0a2b39f1a5d01d413201`; plan file SHA256: `ad1a8740ae2b2881dca7c5686015d94561612f0773bad6a603aed2e4449eb1ab`. Stage result `R/public-environment-stage-1/execution/result.json`, SHA256 `b2dabe85df6b611b45058521fe3585b9e23ef960f8532fbc0a35acbbba6ea170`, reports one write, HTTP 200, metadata readback confirmation, unchanged credentials and no automatic retry. Project environment staging does not prove that the public gateway has been promoted or that the private service has been rebound.

## Release verification record

| Gate | Observed status | Evidence |
| --- | --- | --- |
| Exact-source CI | Independently verified: all 14 jobs completed successfully for exact `053768aa`, run attempt 1 | `R/ci-053768aa.json`, SHA256 `e85a1b56cf0980ce1dcbf4d5843114276a37806148b15dd495b8f79e9f316a4e` |
| Isolated PostgreSQL qualification | Independently verified: both groups pass; 698 fixture files, 42 staff migrations, unchanged 16 native artifacts and owned-cluster cleanup | `R/pg-context-053768aa/pg-evidence/result.json`, SHA256 `2ca047f6640041c2a2a1735927bfd4875b94777fc5f546cd32009fdb3a3ff8d7` |
| Intended-image four-photo geometry | Pass: all four physical/printed results and 20 derivatives match local proof; Front exactness preserved | `R/native-context-053768aa/geometry-qualification-evidence/back-geometry-053768aa-09df-1/result.json`, SHA256 `7ffe0129b018930f18ca70dd91cad6f397f71c37aa63e60e470fdf2c8ea94328`; independent review `b6e41dd795795f2e3877fef3b355e4d3a61762373f24da2350b7a6b404ea2243` |
| Public staged build | Independently verified READY/STAGED `dpl_Gfz8m5mSBWmxq1EavAV4p8Mu5ttn`, host `atlas-grading-public-kbnvyhqv5-ten-kings.vercel.app`, exact `053768aa`; not a promotion claim | `R/public-build-readback-1/result.json`, SHA256 `8d618904fe6934e25805c5a2fccdb6b2c4922a81c08be94938cc763faf3fe088` |
| Fresh cutover baselines and sealed action | Passed root and independent materialized review | `R/sealed-action-053768aa-1/action.json`, SHA256 `595bc2016916dd258e8df73c0305252446e973d17951cf12cb39c37b1d3ec6a3`; independent review `ade12b59a91fd382c9d248a961f55ac463945cfadd61deeaba3749e63285d93c` |
| Private activation and two-control rebind | Pass: old writer drained, stopped and detached; candidate started; signed TLS 401/404/400; exact controls 22/20 | Start `2463cf4e6063dd421101457e360f0e89f6a64fce5e5858cf48869daf1ab8e0dd`; TLS `5a79e9070296ef44cf69d5edf4d5b32f2866fbbfdfc901f318943a78d704e8ae`; controls `3eeb84dbb1175891736da943808bd0b77a4f3ee40d490b7471883784e80948cd` |
| Separate public promotion | Verified: all four aliases and production target select Gfz8; www retains 308 | `R/provider-final-1.json`, SHA256 `db9f17643aa41dd71e5430b91a732cfd4b3c72b0e5a0420a4aee9992342c7a50`; final promotion readback `b96743031918750732db3ed89b66a2d5b8ee3cec8701a28c8819a39a1340a418` |
| Final host/DB verification | Pass: 593 sources, 16 native artifacts, exact ledgers/ACL/history and saved Magikarp preserved | `R/final-readonly-1/summary.json`, SHA256 `1cba4df117e37090a9955a64ac4ad3334af61613f25726f70957512830c9065d` |
| Final hosted verification | Pass at 04:03:59 UTC: 10 routes, 49 assets, 37 UI markers, 59 GETs / 2,688,179 bytes | `R/final-web-prepared/hosted-1/result.json`, SHA256 `1687fea68f6a86552fa11e0683c62c9611dd4711c4decc93d2966aedb6148271` |
| Owner acceptance | Open | Mark's signed-in saved-card/new-card/optical checks and any separate human review/report approval |

The completed PostgreSQL result binds plan `20fe4ff3bf0893ec9b049ae77c3ebe243510bd9f8d6f5975f01c3636c603c8ed` and fixture manifest `89ef2e7e3a1f3599a5b858c18b4e4cdcfd18c423601d7192e64a3b34e1a8226c`. Raw overlay receipt `18da186aabd3b0fc55d39ea3d1dd1c041e88834b23270455f70afd1f97b32e94` matches the pinned 16-native baseline. The ACL group checks 2,950 columns, 14 manual tables and six nontrigger functions with unchanged grant replay; its nine actual connected assertions include retained Back detection/preparation with exact human Front preservation. The memory group passes 25 assertion groups, including both same-transaction confirmation fences. Each fixture replays migrations twice as no-ops and retains cleanup proof with no owned database data directory. Raw ACL/memory logs hash to `381870150f24ab04ffc78c9d11e29b2e33ffac9104c3b629828e31528333cd5d` and `53c3c5baa72dfd691943c5c21513fff5f8368982c51593cdf9efd713a024c7b8`. All three setup/test containers are stopped, capped and network-isolated. The fixture's 95 public migrations describe its frozen test source; they are distinct from the production 99 active / 13 historical rolled-back ledger.

The CI receipt's raw run and all 14 unique jobs bind source `053768aa` / tree `db3af903`; run `35683693625` is completed/success on the pull-request event. Conditional main-push publication/signing steps are skipped by that event, so this audit makes no registry-publication claim. The public READY receipt independently links upload result `bb94b20fe615c9ffad3f3bd7c54125cc06b9df7eb2237261d74d67ecef45bf5e`, provider snapshot and exact READY metadata `f733696c21f49cdfb0a014607924a9ec719119ac4977d875f3a54a4599200bf3`; automatic custom-domain assignment is disabled.

The inherited private identity at the start of this repair was container `146e1d266a42fd67c1a1c04f5c69b5a6066d8cedd302e5475652e3ea6c51f4e5`, image `9fdbd82d…`, source `a00f9885…`, controls 21/19. The fresh shared-host scope was coordinated with Inventory. Its separately authorized schema work established public 99 active / 13 historical rolled-back entries; staff remains 42. Ordinary Inventory cron/database writes continue, so release fencing must preserve ATLAS-relevant state without asserting whole-database quiescence. No ATLAS migration, grant change, original replacement, production card action, paid inference, human confirmation or report approval is part of this release plan. Consumed action custody and hold release are recorded below.

## Activated runtime and saved-card preservation

The old writer drained cleanly at 04:00:44 UTC and is retained stopped with both networks detached as `atlas-manual-connected-20260917-retained-a00f98-20260922`. Its container `146e1d266a42fd67c1a1c04f5c69b5a6066d8cedd302e5475652e3ea6c51f4e5`, old environment and prior retired writers remain preserved. New container `b95a7bf5aa422d1f141b3794514c80af25ff75a49adff08422693c1a04611b76` started at **04:00:57.572282202 UTC** with image `4f9e3bb5…`, one private service alias, read-only root, 1 CPU, 3 GiB memory and zero restarts/OOM/runtime errors. Configuration is `/opt/atlas/manual-back-geometry-20260922-09df/private.env`, SHA256 `374c83b3c9bcd20b495c3a9716b3a2918613ac4700fa804a50acd337f344a8b7`; compose SHA256 `bc3caa5f2a69d80c48fbf9239c6b23397126202686bbe2be8fed0639bf31ff6b`. Only private deployment/source fields changed; keys and other configuration are preserved.

The root dispatched public promotion once after private activation and exact controls 22/20. Initial provider readback showed propagation pending; a later GET-only readback verified all aliases and the production target. No promotion replay occurred. Final hosted checks verify 37 expected intake/report/geometry markers and preserve the customer deployment; two anonymous session GETs may create authentication browser/rate bookkeeping but request no SMS or signed-in session.

Final raw preservation review `R/independent-actual-final-preservation-review-1.json`, SHA256 `4664c0f9e6ce264708c0857727fcdd28e095c1bc704b145a7eff7a7ca110a4f0`, independently recomputes all ten receipt checks. Saved Magikarp remains intake revision 9, manual revision 1/hash `d5e5ad4a2560a0853f3f5322de9938bc03493e742f28f12514e3223d93e2aa3a`, zero actions and zero approvals. All selected uploads, preparation references, saved Front work and original bytes remain unchanged. All 14 manual histories, full staff 42/public 99+13 migration ledgers and effective restricted-role grants are preserved.

Sealed action `595bc2016916dd258e8df73c0305252446e973d17951cf12cb39c37b1d3ec6a3` and public promotion plan `93727a46d87f1ac14cf090750a36c7c0c9796a1b3794c050d2a10ed892f7e514` are **consumed** and must never be replayed. Any recovery requires fresh review and a compatible roll-forward preserving source descriptors, report V2 and confirmation fences.

For the existing untouched failed Back, Mark can refresh the card and choose **Detect edges automatically** once. This uses the saved photo’s verified working frame and journaled side recovery, preserving Front work. New eligible cards use the corrected detector during automatic initialization. No live saved-card recovery, paid identification/analysis, confirmation or report approval was performed by deployment.


Inventory's shared host/schema/grant/lifecycle mutation hold was explicitly released at 04:07 UTC after final host/DB/provider/hosted checks, to both the new Inventory lead `01a0c746-65c6-7523-851b-a25a50f017a9` and prior lead `01a0c55f-aeb0-77d3-912c-0736a7f6c429`. No further ATLAS host or database mutations are planned. Owned qualification containers remain stopped with evidence retained; normal Inventory cron writes continued throughout. Future operations require fresh live baselines.


Final independent reviews pass without findings: actual private phase chain `69ce636c986a5153466b6f746d05cde5226ab6e1a5606213269ae6cd265aefbf`, saved-card/runtime preservation `4664c0f9e6ce264708c0857727fcdd28e095c1bc704b145a7eff7a7ca110a4f0`, and completed release/promotion/hosted proof `6554ffd9ca17c687238f516df89699293e091b78b8f8aed519ffa74730f6b937`. The new Inventory lead acknowledged hold release. These reviews establish deployment and preserved state, not owner optical acceptance or report approval. PR378 remains draft/unmerged; final documentation and its description are updated separately from the frozen runtime source.
