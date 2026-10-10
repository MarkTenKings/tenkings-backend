# ATLAS visual variant review — implementation record

## Authorized scope

The owner approved the complete shared photo-reference library, independent background preparation, AI suggestion, and explicit final human variant confirmation. Three Astra Ultra specialists own catalog evidence, durable backend processing, and staff UI; root owns integration and qualification. No claim of universal catalog coverage or zero performance impact is warranted without evidence.

Implementation checkout: `codex/atlas-visual-variant-review`, based on `ca3d0de2101d87713cb1b3212cbc4ae301c8b088`, in the existing managed `atlas-automatic-comps` worktree. The original dirty/conflicted checkout is preserved.

## Release requirements

- Astra grading never awaits catalog/provider/image acquisition. Use independent bounded worker capacity and connection allocation; cached status GETs do not start external work.
- Both applications use the existing reviewed SetOps catalog contract. Provider candidate IDs do not impersonate canonical printing IDs. Keep metadata applicability, diagnostic photo coverage, source permission, and human approval separate.
- Generic card artwork cannot establish a foil/parallel finish. Exact-card and representative finish photos are labeled separately. Incomplete evidence stays incomplete.
- Human confirmation binds the actual uploaded pair, current identity revision, saved candidate result, and reviewed catalog version. AI suggestions remain unconfirmed. Missing references can hold an individual final approval while other cards continue.
- Changed identities retain unaffected evidence, require compatible grading analysis, and invalidate stale approval readiness. Historical reports/approvals remain immutable.
- The existing approval transaction continues to record the automatic sold-comps intent.
- Qualify ordinary and corrected approval, stale results, duplicate requests, restart recovery, unavailable providers, image/hash failure, narrow screens, and grading throughput under concurrent library work.

## Starting evidence

Read-only October 9 continuation inspected private host `161.35.178.144` using the retained verified SSH transport. Current runtime is `4c816855b7a58f27918f5e0456b51ac1c416e3adddf4e4282230463349cd2489`, source `88d227e`, image `a9c42bb2…`, started `2026-10-09T06:16:05.333596216Z`, zero restarts. Shared catalog access is enabled and token-present; no Scrydex credentials were found in the inspected runtime environment. Secret values were not emitted. The old general deploy runbook host `104.131.27.245` remains the Ten Kings backend, not this current private ATLAS service.

The existing manual role's pool and connection cap are four. A dedicated worker requires independently allocated bounded database capacity; it must not compete for that serving pool. No production configuration, schema, provider call, approval, or catalog publication has been changed for this feature at this checkpoint.

## Status

Implementation in progress. Production remains on the previously qualified automatic-comps release. This document will be updated with exact source, test, browser, performance, and release evidence.


## Local integration checkpoint

- UI supports explicit photo choice, unconfirmed AI advice, source/relationship labels, original comparison, manual observation and unresolved hold. UI fixture evidence is in `~/.codex/atlas-handoffs/atlas-visual-variant-review-20261009/ui/browser-qualification.json` (SHA256 bcfda4b0723c7e09b7d3bbf97d3f042008116c061a66047c5972a0d2016b39ac). This is fixture behavior, not measured recognition accuracy.
- Root workflow/provider/runtime tests21 pass; backend disposable PostgreSQL r6 passed10 groups. Remaining SQL guards and matched performance qualification await disk space. All test model callbacks are synthetic; no live model requests occurred.
- Changed variants require fresh human geometry review plus an exact compatible defect recheck. Human findings and original images are not erased.
- Independent worker: one in-flight comparison, dedicated one-connection DB role, one libvips thread,32MiB image cache. CPU/memory deployment limits and provider-quota measurement remain pending.
- Shared demand bridge is implemented on exact current collect production source f73249be, in the separate shared-variant-catalog worktree. It stages unreviewed explicit manufacturer rows and does not expand set-level parallel lists into unsupported exact-card variants. ATLAS calls it only in the isolated worker; pending acquisitions retry before immutable comparison inputs are saved. Host database rehearsal/build remain outstanding.
- Scrydex signup is complete and credentials are stored only in the private local handoff directory. Two live metadata GETs revealed a statusless response envelope; the importer was corrected and retained-body fixtures added. A subsequent cached qualification made zero metadata calls and verified the Snowflake Pikachu reference image (211466 bytes,726×1024,SHA256 d300a56d25af1ee2567044e16a6ae8147f1be598ef538a6f6eec113e886c1a9a). Pikachu025/165 has five listed variants but only one exact variant gallery in this sample; Magmar006/034 has generic artwork only. This is availability evidence, not a recognition accuracy benchmark. Evidence: `~/.codex/atlas-handoffs/atlas-visual-variant-review-20261009/scrydex-live-qualification-r2.json`.
- Optional reference-photo contribution is off by default. Staff must assert rights and internal ATLAS/Ten Kings use. The background worker saves exact private JPEG bytes and source/identity/permission lineage before submission, making lost-response retries byte-identical. Host submissions remain pending authorized catalog/permission review; they do not publish automatically. Latest UI/client/recovery suite134 pass; root packet/client/demand integration21 pass using real Sharp and immutable in-memory artifact storage. Host pending receipts are checked against the exact image roster, physical observation and permissions.
- Production feature activation has not occurred. No migration77, new grants, worker start, web deploy or source publication has been applied to either live system.

## Latest local validation and remaining release work

- Three main packages:648 passed with3 native cases omitted in the first invocation; all3 then passed with the existing OpenCV environment. Combined651 distinct tests passed, zero remaining failures. Logs: `local-unit-final-r2.log` and `local-native-final-r1.log` in the handoff directory. UI/client/recovery134 pass separately.
- Private photo packet tests17 pass. Actual producer request passed actual shared-host acceptance and the root client's exact receipt validation. Capture descriptors are real canonical artifacts; aggregate source hashes are retained as evidence fields rather than misrepresented as downloadable bytes. Publication guards remain unchanged.
- Shared-host attachment lets a reviewer choose an existing supported depicted card/printing, diagnostic scope and permission acceptance, then add the photo to a full review packet for normal preview/publication. Host focused35 tests pass; real SQL submit→attach→publish→both-application retrieval remains to be run.
- Scrydex cached r3 requalified retained image retrieval and polished labels across a new process with zero network calls. Photo coverage limitations above still apply.
- Remaining: owned ATLAS and shared-host PostgreSQL/migration/grant rehearsals; final browser and production builds; matched background-work timing; source freeze; coordinated release and production smoke. Mac free space remains below0.4GiB, so heavy checks remain held pending the owner's storage cleanup. No live feature activation has occurred.
