# Scalable pipeline validation

These are explicit operator-run validation programs. They are not serving entry points and do not read ambient production database configuration.

## Offline acceptance

`validate-postgres.mjs` runs actual migrations and restricted PostgreSQL roles, two separate worker processes, a 20-of-21 global claim barrier, SIGKILL/restart recovery, saved READY result recovery, positive 429 and negative 500 successor fences, upload lease loss/deletion, native PNG preparation, implicit pair admission, browser-session revocation and owner-isolated progress. Its provider callbacks are controlled fixtures. It makes no paid calls.

Set `ATLAS_SCALABLE_EVIDENCE` to a fresh absolute private output directory and supply the existing disposable PostgreSQL arguments:

```sh
/opt/homebrew/opt/node@20/bin/node validation/atlas-scalable-pipeline-20260925/validate-postgres.mjs \
  --ack-disposable-local-postgres \
  --postgres-bin /Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/diagnostic-deps/node_modules/@embedded-postgres/darwin-arm64/native/bin \
  --pg-module /Users/markthomas/.codex/atlas-handoffs/atlas-timeout-root-cause-20260911/diagnostic-deps/node_modules/pg
```

`validate-retention.mjs` takes the same environment/arguments. It retains the complete native PostgreSQL cluster, stops and restarts it, verifies system identity and exact request/receipt/acceptance row hashes, then invokes the actual analysis executor and provider adapter with a mocked GET response. The narrow collector role cannot select arbitrary run rows. It preserves the old UNKNOWN receipt, appends the terminal response and makes zero POSTs. This fixture intentionally retains its private database files.

`benchmark-full-resolution.mjs` takes `ATLAS_BENCH_ORIGINALS`, an absolute private JSON manifest containing `{path,sha256}` entries, and `ATLAS_SCALABLE_EVIDENCE`. It performs 25 decode/full-dimension conversion tasks at concurrency 2. Original hashes and dimensions are checked. Repeated inputs, host CPU, parent-only RSS and omitted storage/geometry/provider work are explicitly recorded. This is not an end-to-end capacity test.

Observed offline receipts are outside Git under `/Users/markthomas/.codex/atlas-handoffs/atlas-scalable-pipeline-20260925`: `owned-pg-6` passed 11 groups; `retention-2` passed retained restart/GET recovery. The earlier `native-1` result measured 25 tasks from two 12.2MP originals in 13.25 seconds on this Mac before the later native PNG optimization. It does not establish production capacity.

## Real adapters: explicit paid execution

`benchmark-real-adapters.mjs` requires `--ack-live-provider-benchmark`. Root owns execution. It creates isolated local PostgreSQL records and a fresh `atlas-connected-manual-v1/benchmark/<UUID>` object prefix. It uses actual storage, identification, geometry, Astra analysis, measurement and report implementations. A baseline card runs first; only a successful machine REVIEW result allows the 20-card wave. A failed quality/identity gate remains a failed gate. No human approval or publication is issued.

Required arguments:

- `--output`: new absolute private output directory (must not exist).
- `--pair-manifest`: private version-1 manifest with `matchedPair:true`, `priorGeometryBothReady:true`, `priorAstraReceiptState:"READY"` and `sides.FRONT/BACK` containing absolute original `path`, `sha256` and `byteCount`.
- `--python`: qualified native Python. The local identity probe passed for `/Users/markthomas/.codex/atlas-handoffs/atlas-speedster-build-20260912/cpu-measurement/venv/bin/python` (OpenCV 4.10.0, NumPy 1.26.4).
- The native PostgreSQL arguments above. Docker mode is deliberately rejected because its disposable fixture removes its data.

Credentials arrive only as one bounded JSON object on stdin, with exactly these keys:

```text
ATLAS_MANUAL_STORAGE_ENDPOINT
ATLAS_MANUAL_UPLOAD_ORIGIN
ATLAS_MANUAL_STORAGE_BUCKET
ATLAS_MANUAL_STORAGE_REGION
ATLAS_MANUAL_STORAGE_ACCESS_KEY
ATLAS_MANUAL_STORAGE_SECRET_KEY
ATLAS_MANUAL_OPENAI_KEY
ATLAS_MANUAL_GOOGLE_VISION_KEY
```

Root supplies these from the protected runtime configuration without printing values. Production database URLs, cookies and staff sessions are rejected as input. The benchmark privately retains only its own generated local database/auth credentials. Real provider/storage credentials are not written to its output.

The matched pair is available at `/Users/markthomas/.codex/atlas-handoffs/atlas-scalable-pipeline-20260925/matched-pair/pair.private.json`, SHA-256 `13654bc759d45fef26d1e6e981c96e8d1784b9c00a4d5512f277d50c9c406e70`. Both full originals were read by exact historical selected-upload binding, size and SHA-256 from the pinned live storage runtime. They belonged to the same retained card and had both automatic geometry sides READY plus an actual Astra READY receipt. Repetition of that one specimen across 21 independent benchmark jobs is explicit; it measures capacity, not grading diversity or accuracy.

Add `--preflight-only` to construct the real runtime, exercise all restricted grants, plan 42 uploads and revoke the synthetic browser session without starting workers or making network calls. The final preflight and zero-work GET-only resume both passed using fake credentials. Do not interpret preflight as provider or storage acceptance.

## Measurement and recovery

The live run records actual PUT status/bytes/timing, 2-second persisted stage observations, exact provider request/receipt timestamps and usage, request model/tier settings, allowlisted rate-limit headers and sampled accepted-but-unsettled model concurrency. The configured 20 worker slots do not prove 20 simultaneous model computations. Compare the baseline and 20-card results from their respective last verified original-pair point as well as from upload start. Host-to-storage PUT throughput is not iPhone uplink throughput.

SIGINT/SIGTERM immediately stop new worker admission and abort/drain original PUTs. Already admitted provider results retain their collector, using the persisted acceptance polling deadline. Unknown outcomes never authorize a new paid POST. The complete owned PGDATA, roles, grants, requests, receipts and artifacts remain available; `fixture.stop()` is never called after paid work can start. Object originals and result artifacts remain under the isolated prefix.

For interrupted accepted results, run `resume-accepted.mjs --ack-collect-existing-results --context <retained-context.private.json> --output <new-private-directory>`, supplying the same eight-key JSON on stdin. It validates ownership and the exact database system identifier, starts only that stopped local cluster, and exposes only accepted-result collection. Its fetch fence permits only GET `/v1/responses/resp_*`; no ingestion, batch or geometry worker starts. It appends actual response artifacts/receipts and stops the cluster without deleting it. The runner reports recorded outcomes; a collection attempt is not a claim that every provider result succeeded.

Keep all `*.private.json`, database files, original images and credentials outside Git. Root controls subsequent reconciliation and any eventual cleanup of the explicitly scoped benchmark data.
