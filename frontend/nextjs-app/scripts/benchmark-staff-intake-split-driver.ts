/** External synthetic load driver: no Prisma, Sharp or runtime application imports. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { peer, mono, safeError, tracing } from './benchmark-staff-intake-split-ipc';

async function main() {
  const config = JSON.parse(process.argv[2]);
  assert.equal(config.protocol.topology, 'driver/intake/worker/observer-separate-processes');
  const peers = new Map<string, ReturnType<typeof peer>>(), children: ReturnType<typeof spawn>[] = [];
  const identities: any[] = [], clockProbes: any[] = [], trace = tracing('driver');
  const invoke = (role: string, method: string, args: any = {}) => { const client = peers.get(role); assert.ok(client); return client.call(method, args); };
  let workersStarted = false;
  try {
    for (const role of ['intake', 'worker', 'observer']) {
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', TSX_TSCONFIG_PATH: config.launch.tsconfig };
      for (const key of ['PATH', 'HOME', 'TMPDIR', 'NEXT_TELEMETRY_DISABLED', 'AWS_EC2_METADATA_DISABLED', 'DATABASE_URL', 'TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION', 'TK_BENCHMARK_OWNED_DATABASE']) if (process.env[key]) env[key] = process.env[key]!;
      const child = spawn(process.execPath, ['--import', config.launch.loader, join(dirname(fileURLToPath(import.meta.url)), 'benchmark-staff-intake-split-role.ts'), JSON.stringify({ ...config, role })], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child);
      let errors = '';
      child.stderr?.on('data', bytes => { errors = (errors + String(bytes)).slice(-3000); });
      const client = peer(message => { if (!child.connected) throw Error(`${role} disconnected`); child.send(message); }, handler => child.on('message', handler), async (method, args) => {
        assert.equal(method, 'forward'); assert.ok(['worker', 'observer'].includes(args.role));
        return invoke(args.role, args.method, args.args);
      }); peers.set(role, client);
      child.on('error', error => client.fail(error)); child.on('exit', code => client.fail(Error(`${role} exited ${code}: ${safeError(errors)}`)));
      identities.push(await client.call('ready'));
      for (let i = 0; i < 5; i++) { const sent_ns = mono(), result = await client.call('clock'), received_ns = mono(); assert.ok(BigInt(sent_ns) <= BigInt(result.at_ns) && BigInt(result.at_ns) <= BigInt(received_ns), 'Cross-process monotonic clock origin must agree'); clockProbes.push({ role, sent_ns, ...result, received_ns }); }
    }
    assert.equal(new Set([process.pid, ...identities.map(x => x.pid)]).size, 4);
    if (config.mode === 'seed') {
      await invoke('intake', 'seed'); await invoke('worker', 'seed-terminal');
      const seed = await invoke('intake', 'seed-proof');
      await writeFile(config.output, JSON.stringify({ ...seed, process_identities: identities, clock_probes: clockProbes }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return;
    }
    assert.equal(config.mode, 'measure');
    await invoke('intake', 'preflight');
    const claims: any[] = [], leases: string[] = [];
    try {
      for (let i = 0; i < 2; i++) { const claim = await invoke('worker', 'admission-claim'); assert.ok(claim); claims.push(claim); }
      for (let i = 0; i < 3; i++) leases.push((await invoke('intake', 'admission-lease')).leaseId);
      assert.equal(await invoke('worker', 'admission-finish', claims[0]), true); claims.shift();
      assert.equal(await invoke('worker', 'admission-claim'), null);
      await invoke('intake', 'admission-release', { leaseId: leases[0] }); leases.shift();
      const resumed = await invoke('worker', 'admission-claim'); assert.ok(resumed); claims.push(resumed);
    } finally { for (const claim of claims) await invoke('worker', 'admission-finish', claim); for (const leaseId of leases) await invoke('intake', 'admission-release', { leaseId }); }
    await Promise.all(['intake', 'worker', 'observer'].map(role => invoke(role, 'trace-start'))); trace.start();
    if (config.scenario !== 'idle') { await invoke('worker', 'start'); workersStarted = true; }
    const samples: any[] = [];
    const session = async (session: number, warmup: boolean, amount: number) => {
      for (let index = 0; index < amount; index++) {
        const context = { session, index, warmup }, started_ns = mono();
        const lease = await invoke('intake', 'lease', context);
        await delay(config.protocol.provider_delay_ms);
        await invoke('intake', 'release', { ...context, leaseId: lease.leaseId });
        const save_sent_ns = mono(), saved = await invoke('intake', 'save', context), save_received_ns = mono();
        const sample = { ...context, lease_ms: lease.lease_ms, ...saved, driver_started_ns: started_ns, driver_finished_ns: mono(), driver_save_sent_ns: save_sent_ns, driver_save_received_ns: save_received_ns, driver_save_roundtrip_ms: Number(BigInt(save_received_ns) - BigInt(save_sent_ns)) / 1e6 };
        samples.push(sample); await appendFile(`${config.output}.samples.ndjson`, JSON.stringify(sample) + '\n', { mode: 0o600 });
      }
    };
    await Promise.all(Array.from({ length: config.sessions }, (_, id) => session(id, true, config.protocol.warmups)));
    if (workersStarted) await invoke('worker', 'terminals-ready');
    await invoke('worker', 'measure-start'); trace.operations.push({ kind: 'measurement_start', at_ns: mono() });
    await Promise.all(Array.from({ length: config.sessions }, (_, id) => session(id, false, config.protocol.measured)));
    trace.operations.push({ kind: 'measurement_end', at_ns: mono() });
    await invoke('worker', 'stop'); workersStarted = false;
    assert.equal(samples.length, config.sessions * (config.protocol.warmups + config.protocol.measured));
    for (const sample of samples) for (const metric of [...config.protocol.legacy_gate_metrics, ...config.protocol.additional_gate_metrics]) assert.ok(Number.isFinite(sample[metric]) && sample[metric] >= 0, `Invalid ${metric}`);
    const checks = await invoke('intake', 'verify', { samples });
    const roles = await Promise.all(['intake', 'worker', 'observer'].map(role => invoke(role, 'trace-finish')));
    const worker = roles.find(role => role.role === 'worker');
    assert.equal(worker.provider_counts.unexpected, 0); assert.ok(worker.claims.max_running <= 2);
    assert.ok(config.scenario === 'idle' || worker.barrier_observed);
    for (const role of ['intake', 'worker', 'observer']) { const sent_ns = mono(), result = await invoke(role, 'clock'), received_ns = mono(); assert.ok(BigInt(sent_ns) <= BigInt(result.at_ns) && BigInt(result.at_ns) <= BigInt(received_ns)); clockProbes.push({ role, sent_ns, ...result, received_ns }); }
    const result = { arm: config.arm, scenario: config.scenario, sessions: config.sessions, index: config.index, samples, hard_gates_pass: true, ...checks, admission_preflight: { denied_at_three_leases_with_one_running_worker: true, terminal_write_during_pause: true, admitted_after_one_lease_released: true }, process_identities: identities, clock_probes: clockProbes, driver: trace.finish(), roles, claims: worker.claims, provider_counts: worker.provider_counts, unavailable_metrics: ['camera', 'upload', 'recognition', 'actual Vercel instance placement', 'real provider variability'] };
    await writeFile(config.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ arm: config.arm, scenario: config.scenario, samples: samples.length, hard_gates: true }));
  } finally {
    if (workersStarted) await invoke('worker', 'stop').catch(() => {});
    trace.finish();
    await Promise.allSettled([...peers.keys()].map(role => invoke(role, 'close')));
    for (const child of children) { if (child.connected) child.disconnect(); if (child.exitCode === null) child.kill('SIGTERM'); }
  }
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
