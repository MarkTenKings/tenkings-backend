# R1 resumed candidate qualification — October 22, 2026

The disk blocker is resolved. Exact isolated candidate `a0f4951fb7adc34a92ea1cd67d6bd6d4271cb3e1` (tree `0730910b546cdbfb412eb153072a1376d5e36bae`, based on production `cf5fcefa`) passes all three local production web builds and the actual Linux native build, with 150 targeted tests passing and zero failures/skips/cancellations. It is **not activated**. Claims/history and selected-sale guidance remain disabled; Fingerprint remains separate and offline.

Evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-r1-activation-20261022/resume-01`. Combined `qualification.json` SHA256 is `a15da750bc9b57e0da9d915f37c001409b05b785d9f033edd2d34b7ea1f6e5d3`. Historical broad suites and local SQL010/011 qualification remain retained; no broad suite was replayed.

## Local web qualification

An exact Git export with no environment credentials was built using Node22 and a frozen, filtered offline pnpm install: 504 packages reused, zero downloaded. Staff, customer and public production builds ran sequentially with a clean environment under OS network denial. Their bundled-engine, route, dependency and secret-boundary checks passed. Tracked source bytes and modes are unchanged; the pnpm-touched CLI required only an index-stat refresh after byte/mode equality was proved.

`web-qualification.json` SHA256 `63918657588eea03a8fa6f64036a6572553b41f850c0e6640db922114e4fd8cd` records 104 staff, 75 customer and 69 public emitted files: **248 total**. Eighteen source-closure checks and 61 focused web integration checks pass. These are local build artifacts, not immutable provider deployment/served-asset proof or ordinary-session acceptance.

## Native Linux qualification

The fresh one-use packet `bd94d52228d9ef93a2c8588020b6162161b49b0424418d6faf659f34296f9c0f` was dispatched once at 17:56:09 UTC, after resource/preservation checks. It completed at **18:04:15.999958 UTC** with `ATLAS_R1_NATIVE_BUILD_TARGETED_PASS`. One transient SSH status failure was reconciled read-only; execution was not replayed.

- Image: `sha256:abd2919052f4a133f0d861bc6af9d68ad5bd914bb7cad6be3a039829a58ef33b`.
- Exact native manifest: `9f5dcf7cd8359ca31bfebfbaef007067b983b4c8ba80d2b0e1cae01559211880`, 2469 serving files, no SQL/test inputs, 35 serving deltas from the labels context.
- Native verifier passed source closure, decoder, approved-label sources, Python/OpenCV and offline catalog checks. All 71 focused comp/transport/coexistence tests passed.
- Build limited to four CPUs/8GiB. The nonroot test container had no network, credentials, mounts or published ports; capabilities dropped, no-new-privileges, restart disabled. It exited0 with no OOM/restarts.
- All 61 pre-existing containers and 412 pre-existing images were preserved. No serving process was restarted, deployed or reconfigured. No database, storage object, provider, grading, printing, message or money action occurred.

Collected receipt: `native-prep/packet/collect-20261022T180655.500975Z.json`, SHA256 `6eaf91fd9b43bd7a367cecb5a69138c5bfbfb709c25313b59d321472cad8d733`. Embedded result SHA256 `03229b184338ef931b25aae2813e038b2bafcc6b105372f90b1f374dd038fc28`; build log `987b8d2cf45ba650e9cac3c66522033977bb1c16b160eefc85b11f6f1b7c8f65`; test log `2a4f417d0341625e269da62f2f3c69dac56280fe047c2427fb757076743de45d`. Root independently checked all embedded byte counts/hashes and the exact result/test totals after the helper's review.

## Current coordination and remaining gates

Fresh 17:44:40 UTC native observation still showed the approved-labels pair at cf5fcefa, zero restarts and optional flags absent. Vercel inventories retained the staff/public/customer deployments recorded in the takeover. The after-build inventory includes a separate new `/hungry_hopper` container, started18:01:48; it was not touched or claimed as ours. Its purpose remains unverified.

During the resumed session, read-only chat evidence showed the owner had authorized deployment in **Investigate Atlas slab visuals**, and that chat was preparing a release. R1 must not race that work or overwrite its eventual successor. No release admission or cutover is started here. Refresh actual production/source after that release, compare the exact R1 closure and preserve the approved slab changes. Reuse unchanged evidence and requalify only affected combined inputs; the a0f image is not automatically qualified for a different source tree.

Storage inspection and the concrete approval gate are recorded in [storage readiness](r1-storage-access-readiness.md). Additive SQL010/011, three distinct restricted roles/effective-rights checks, immutable web targets/control bindings, signed gateway proof, bounded cutover/preservation/holder release and real-session acceptance remain outstanding. No titles or reviewer authority may be fabricated. Positive owned-card cases remain pending if no genuine current titles exist. All 30 master-plan requirements remain tracked; this is a bounded R1 milestone.

Preparation-only follow-up: `resume-01/database-activation-preparation.md` SHA256 `f85d90b40e42b9d263e1193e49f24cea6130653671abc21790a92a5968884b20` identifies the existing SQL009 live transaction wrapper, current checksum registry, additive preservation comparators and exact three-role checkers. The current product migrator commits its own transactions and must not be nested in a release-owned transaction. The labels controls-only helper cannot migrate or switch customer bindings unchanged. A fresh bounded orchestration wrapper and targeted qualification remain to be implemented after reviewing these gaps; no effects or source implementation occurred in this preparation.
