# Appliance independent review and native execution plan — September 17, 2026

**Current native startup — September 17:** Mark authorized startup after transfer. An isolated working copy at `/home/tkvault/vault-native-r3-20260917.mVRi5N` passed 363 native tests, the SQLite durability probe, source integrity recheck, mock purchase smoke and two clean stop/start checks. Portrait B is running at `http://127.0.0.1:55497/?experience=portrait` on the SER and its Chromium window is open. This is a disposable mock preview, without real doors/payments or boot autostart. The original transfer remains unchanged. See [native acceptance and restart instructions](SER_NATIVE_ACCEPTANCE_2026-09-17.md). Earlier access/transfer-only/native-pending descriptions below are historical.

The appliance worker read `AGENTS.md`, both required runbooks, current product context, the **entire 1,638-line approved V2 blueprint**, current relevant handoff/session records, and the external fresh-lead `START_HERE.md`. Work is confined to imported `df09`, branch `codex/vault-integration-20260917-9ddb13`, base `c4f04006d9302445e2a68b01dcc316def3b4eb73`. Accepted Portrait B and all frozen source/handoff directories are unchanged. The lead owns access, host mutations and the shared session log.

## Independently verified immutable inputs

Verification used the system Python standard library directly, without executing snapshot code, copying files or installing dependencies. Every manifest entry's exact relative path, byte size and SHA-256 matched; membership was exact, duplicate paths were rejected, and no links or special files were found.

| Input under `/Users/markthomas/tenkings/vault-handoffs/` | Verified result |
| --- | --- |
| `2026-09-16-ser-candidate-r2/candidate-source.json` | SHA-256 `1313aeed7b8232b990236d572dbd2b905570dfa7e9864f4108d8336114fcc05e`; 185 source files, 35,017,097 source bytes; 186 total files including manifest; expected base and unsigned-candidate state |
| `2026-09-16-ser-continuation-r2/SHA256SUMS` | SHA-256 `229ff05122fa50ad3be83979f462f15f1609eb3c57e66dcd53bed529d6c34528`; 14 payload files plus `MANIFEST.json` and `SHA256SUMS`; 16 total files, 4,765,478 bytes |
| Continuation `MANIFEST.json` | SHA-256 `b56a41bfca5217ef2a39164ea20f8a20d5b6b1ef3694bfbafdbf678e436c90ae`; all 14 payload hashes/sizes and its candidate-r2 hash/count/byte binding matched |
| Candidate verifier | `deploy/vault-linux/candidate-bundle.py`, SHA-256 `3ed861eea2ad4cbcffd16ece748aa0e79ebbff55dd8d0b6787654d4b1c07f7c7`, bound by the trusted candidate manifest |

These are integrity results, not native execution, an authorized signed release, physical qualification or payment acceptance. The September 17 lead reports a timeout before authentication at the SER's last observed address `192.168.2.36`; no remote command succeeded. Its current address/reachability and public-key authorization remain unresolved. Mac `en0` remains `192.168.2.21`.

## Review findings and corrections

- The old bring-up sequence hashed the manifest, then immediately executed the copied verifier. A modified verifier beside an intact manifest could execute before detecting its own changed bytes. The bootstrap below verifies the verifier against the independently authenticated manifest first; the current bring-up document now points here. No deployment implementation change was needed.
- Current-owner/install prose now reflects imported `df09` and completed Omarchy installation. Windows erase/install instructions are marked historical. Old frozen candidate documents retain their historical bytes.
- `scripts/run-vault-simulator.mjs:90-98` creates temporary state and deletes it on graceful shutdown. Two process starts cannot prove retained financial state. Existing recovery tests reopen durable state; `deploy/vault-linux/probe.cjs:9-24` checks exact Linux runtime/native package and disposable WAL/FULL transaction rollback/reopen/integrity. The stop/start step below is explicitly process lifecycle evidence.
- `build-release.py:26-27` correctly requires clean reviewed committed source. Do not invoke the signed release workflow on this unsigned sparse candidate. Root aggregate `vault:build` and `vault:test` invoke unrelated database/cloud work; native commands stay within the three Vault workspaces.
- No concrete deployment-code blocker was found for this native simulator plan. Installed systemd execution, protected credentials, physical serial access, touch, encrypted power return and official Marshall integration remain separate unpassed gates. The repository root's Node 20 engine declaration may emit a warning; the Vault runtime is explicitly pinned to Node 22.23.2. Do not replace system Node or relax an unexpected install failure without inspecting it.

No Mac dependency download, build or fixture rerun occurred. The command blocks were reviewed against current source and syntax-checked; they have **not** run on the SER. The lead records planned/observed native simulator starts and stops in the session log when actually executing them.

## Current native input — candidate-r3

Root exported a new immutable candidate after two cross-reviewed software corrections: all non-MOCK dispatch now rejects candidate/unverified source identities, and a helper failure during the final OFF interval cannot become a successful terminal receipt. Root recorded 7 source-identity regressions plus 39 adjacent controller/dispatch checks, all passing on existing Mac Node20.20.1. No native Linux or hardware qualification is implied. Candidate-r2 above remains historical and unchanged.

The next SER input is `/Users/markthomas/tenkings/vault-handoffs/2026-09-17-ser-candidate-r3`, with **186 source files / 35,028,973 source bytes**, exact base `c4f04006d9302445e2a68b01dcc316def3b4eb73`, and trusted manifest SHA-256 **`0a50c296f10dfdee3cde4848b06b5a1306e3067c6e5c3f65e3bdda9f5881cc39`**. The verifier's hash is unchanged. Context/logs and this command plan belong beside the source tree. The active commands below use r3.

## 1. Initial read-only SER preflight

Run through the lead's authenticated session as the ordinary `tkvault` account. Do not apply SSH, package-manager, service, firmware or desktop changes in this block.

```bash
set -euo pipefail
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
test "$(id -u)" -ne 0
id -un
hostname
cat /etc/os-release
findmnt -no SOURCE,FSTYPE,OPTIONS /
lsblk -o NAME,PATH,MODEL,TRAN,RM,SIZE,TYPE,FSTYPE,MOUNTPOINTS,RO
df -h / "$HOME"
ip -brief -4 address
ip route show default
for vault_tool in python3 curl tar xz sha256sum git make gcc g++ openssl; do
  command -v "$vault_tool"
done
python3 --version
openssl version
```

Stop for a missing prerequisite, unexpected OS/architecture/account or insufficient disk. Inspect and resolve only that observed blocker before downloading. `hyprctl` from SSH may lack the graphical session environment; absence of its live output does not prove the screen is missing.

## 2. Authenticate the transferred source before executing it

The lead transfers candidate-r3 into the new user-owned path below and current continuation-r3 beside it. The commands make no transfer claim. If the lead selects a different destination, change only the first path. Keep tools, logs and continuation material outside the candidate; extra files break exact membership.

```bash
export VAULT_CANDIDATE="$HOME/tenkings-vault/2026-09-17-ser-candidate-r3"
export PYTHONDONTWRITEBYTECODE=1
cd "$VAULT_CANDIDATE"
python3 -I - <<'PY'
import hashlib, json, pathlib, stat, subprocess, sys
root = pathlib.Path.cwd()
manifest = root / 'candidate-source.json'
assert stat.S_ISREG(manifest.lstat().st_mode)
raw = manifest.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '0a50c296f10dfdee3cde4848b06b5a1306e3067c6e5c3f65e3bdda9f5881cc39'
doc = json.loads(raw)
relative = 'deploy/vault-linux/candidate-bundle.py'
entry = next(row for row in doc['files'] if row['path'] == relative)
verifier = root / relative
for parent in verifier.parents:
    if parent == root:
        break
    assert stat.S_ISDIR(parent.lstat().st_mode)
assert stat.S_ISREG(verifier.lstat().st_mode)
data = verifier.read_bytes()
assert len(data) == entry['size']
assert hashlib.sha256(data).hexdigest() == entry['sha256'] == '3ed861eea2ad4cbcffd16ece748aa0e79ebbff55dd8d0b6787654d4b1c07f7c7'
subprocess.run([sys.executable, '-I', str(verifier), 'verify', '--bundle', str(root)], check=True)
PY
python3 deploy/vault-linux/appliance.py doctor
```

For the new continuation-r3, authenticate `SHA256SUMS` against its new trusted receipt digest before `sha256sum --check`. Require exactly the listed members plus `SHA256SUMS` itself; `MANIFEST.json` binds its payload members. Do not reuse the historical r2 context digest/count. Never execute a setup script supplied by continuation material.

## 3. Create user-owned pinned native tools and external evidence

Use the same Bash shell as above. This writes only to a newly created user-owned run directory and, later, generated build/dependency paths in the candidate. The [official Node checksum list](https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt) is fetched on the SER and must agree with the already recorded archive digest. A September 17 web-tool fetch was unavailable; no fresh online verification is claimed in this receipt.

```bash
VAULT_NATIVE_RUN="$(mktemp -d "$HOME/tenkings-vault/native-acceptance-20260917.XXXXXX")"
export VAULT_NATIVE_RUN
mkdir "$VAULT_NATIVE_RUN/tools" "$VAULT_NATIVE_RUN/logs"
cd "$VAULT_NATIVE_RUN/tools"
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 60 \
  https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt -o SHASUMS256.txt
python3 -I - <<'PY'
from pathlib import Path
expected = 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307'
rows = [line.split() for line in Path('SHASUMS256.txt').read_text().splitlines()]
assert [row[0] for row in rows if len(row) == 2 and row[1] == 'node-v22.23.2-linux-x64.tar.xz'] == [expected]
PY
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 600 \
  https://nodejs.org/download/release/v22.23.2/node-v22.23.2-linux-x64.tar.xz \
  -o node-v22.23.2-linux-x64.tar.xz
printf '%s  %s\n' d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307 node-v22.23.2-linux-x64.tar.xz | sha256sum --check
tar -xJf node-v22.23.2-linux-x64.tar.xz
export PATH="$VAULT_NATIVE_RUN/tools/node-v22.23.2-linux-x64/bin:$PATH"
test "$(node --version)" = v22.23.2
npm install --prefix "$VAULT_NATIVE_RUN/tools/pnpm" --ignore-scripts \
  --no-audit --no-fund --package-lock=false pnpm@9.12.0 \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/pnpm-install.log"
export PATH="$VAULT_NATIVE_RUN/tools/pnpm/node_modules/.bin:$PATH"
test "$(pnpm --version)" = 9.12.0
node -p 'JSON.stringify({executable:process.execPath,node:process.versions.node,abi:process.versions.modules,platform:process.platform,architecture:process.arch})' | tee "$VAULT_NATIVE_RUN/logs/runtime.json"
```

## 4. Native compile, existing tests, SQLite and source recheck

These are new native Linux results when actually executed; they do not replace or inflate historical Mac totals. Test scripts rebuild contracts/machine, so no additional duplicate explicit build is needed for those two packages. The kiosk test script does not build its production bundle, so its build remains explicit.

```bash
cd "$VAULT_CANDIDATE"
npm_config_build_from_source=true pnpm \
  --filter @tenkings/vault-machine... --filter @tenkings/vault-kiosk... \
  install --frozen-lockfile --store-dir "$VAULT_NATIVE_RUN/pnpm-store" \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/native-install.log"
npm_config_build_from_source=true pnpm --filter @tenkings/vault-machine --store-dir "$VAULT_NATIVE_RUN/pnpm-store" rebuild better-sqlite3 \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/sqlite-build.log"
pnpm --filter @tenkings/vault-contracts test 2>&1 | tee "$VAULT_NATIVE_RUN/logs/contracts.log"
pnpm --filter @tenkings/vault-machine test 2>&1 | tee "$VAULT_NATIVE_RUN/logs/machine.log"
pnpm --filter @tenkings/vault-kiosk build 2>&1 | tee "$VAULT_NATIVE_RUN/logs/kiosk-build.log"
pnpm --filter @tenkings/vault-kiosk test 2>&1 | tee "$VAULT_NATIVE_RUN/logs/kiosk.log"
python3 -m unittest discover -s deploy/vault-linux/tests \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/appliance-python.log"
python3 -m unittest discover -s packages/vault-machine/tests -p test_waveshare_bench.py \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/controller-python.log"
node deploy/vault-linux/probe.cjs . | tee "$VAULT_NATIVE_RUN/logs/sqlite-probe.json"
python3 deploy/vault-linux/candidate-bundle.py verify --bundle . --allow-build-output \
  | tee "$VAULT_NATIVE_RUN/logs/source-after-build.json"
node scripts/run-vault-simulator.mjs --doors 72 --stocked --smoke \
  --source-manifest ./candidate-source.json \
  2>&1 | tee "$VAULT_NATIVE_RUN/logs/simulator-smoke.log"
```

`set -euo pipefail` makes any command/pipeline failure stop the sequence. Preserve failed logs; do not continue to startup after a failed build/test/probe. No Playwright browser download is required for this block. The Python controller suite uses fixtures, not a serial device. Generated dependencies/dist are outside the source manifest's content guarantee.

## 5. Disposable simulator stop/start and Portrait B

After the lead records the planned process lifecycle check, this invokes only the existing mock simulator twice on loopback port 55497, requires completed startup, reads the accepted Portrait B page, and terminates the exact owned child with SIGTERM. It opens no physical adapter. A pre-existing port listener causes failure; it is never killed. Keep the same Bash environment and candidate directory.

```bash
python3 -I - <<'PY'
import json, os, pathlib, socket, subprocess, time, urllib.request
root = pathlib.Path(os.environ['VAULT_CANDIDATE'])
logs = pathlib.Path(os.environ['VAULT_NATIVE_RUN']) / 'logs'
origin = 'http://127.0.0.1:55497'
argv = ['node', 'scripts/run-vault-simulator.mjs', '--doors', '72', '--stocked',
        '--port', '55497', '--source-manifest', './candidate-source.json']
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []
for run in (1, 2):
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', 55497)) != 0, 'Port 55497 already has a listener'
    log = logs / f'simulator-process-{run}.log'
    with log.open('x') as output:
        child = subprocess.Popen(argv, cwd=root, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 90
            while 'DISPOSABLE_SIMULATION_ONLY' not in log.read_text():
                assert child.poll() is None, 'Simulator exited before readiness; inspect its log'
                assert time.monotonic() < deadline, 'Simulator startup timed out; inspect its log'
                time.sleep(0.25)
            with opener.open(origin + '/?experience=portrait', timeout=5) as response:
                assert response.status == 200
                assert b'<html' in response.read(1024 * 1024).lower()
            results.append({'run': run, 'pid': child.pid, 'startup': True, 'portraitHtml': True})
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    # Do not escalate to SIGKILL or delete evidence automatically.
                    raise RuntimeError(f'Simulator PID {child.pid} did not stop; preserve state and inspect')
        assert child.returncode == 0, 'Simulator shutdown was not clean'
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', 55497)) != 0, 'Simulator port still listening'
    results[-1]['cleanStop'] = True
receipt = {'processStarts': results, 'persistentSessionRestartProven': False,
           'realHardwarePayment': False}
(logs / 'simulator-process-restart.json').write_text(json.dumps(receipt) + '\n')
print(json.dumps(receipt))
PY
```

For supervised visual/touch observation, the lead may then start the same disposable simulator in a retained terminal:

```bash
node scripts/run-vault-simulator.mjs --doors 72 --stocked --port 55497 \
  --source-manifest ./candidate-source.json
```

On the SER desktop open `http://127.0.0.1:55497/?experience=portrait` in its existing Chromium. This explicitly selects accepted Portrait B. End with Ctrl+C and record the result. Page HTTP success is not visual or touch acceptance. Check physical rotation and all corners/center/swipe/door tapping only after observing exact display/touch identities. No systemd service installation/restart, real credential, cloud enrollment, relay, payment or OS change is part of this plan.
