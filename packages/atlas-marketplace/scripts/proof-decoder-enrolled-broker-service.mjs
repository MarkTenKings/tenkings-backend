#!/usr/bin/env node
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJSON } from '../src/contract.mjs';
import { decoderExact } from '../src/proof-decoder-profile.mjs';
import { parseProofDecoderEngineJSON } from '../src/proof-decoder-engine-json.mjs';
import { createProofDecoderLinuxObserver, loadProofDecoderLinuxPrimitives } from '../src/proof-decoder-linux-observer.mjs';
import { createProofDecoderLinuxCgroupController } from '../src/proof-decoder-linux-cgroup.mjs';
import { openProofDecoderEnrolledTargetRegistry } from '../src/proof-decoder-restart-reconciliation.mjs';
import { createProofDecoderKernelGuardClient } from '../src/proof-decoder-kernel-guard.mjs';
import { createProofDecoderFixedParentBinding } from '../src/proof-decoder-engine-target-binding.mjs';
import { createProofDecoderTargetEngineExecutor } from '../src/proof-decoder-engine-target-executor.mjs';
import { startProofDecoderTargetBroker } from '../src/proof-decoder-target-broker.mjs';

const CONFIG = '/etc/atlas-r2-decoder/broker.json';
const STATUS = '/run/atlas-r2-decoder-broker/started.json';
const check = value => { if (!value) throw new Error('DECODER_BROKER_SERVICE_REFUSED'); };
function protectedPath(path) {
    for (let p = path; ; p = dirname(p)) {
        const st = lstatSync(p);
        check(st.isDirectory() && !st.isSymbolicLink() && st.uid === 0 && (st.mode & 0o022) === 0 && realpathSync(p) === p);
        if (p === '/') break;
    }
}
function read(path, maximum, mode) {
    protectedPath(dirname(path));
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_CLOEXEC);
    try {
        const before = fstatSync(fd);
        check(before.isFile() && before.uid === 0 && before.nlink === 1 && (before.mode & 0o7777) === mode && before.size > 0 && before.size <= maximum);
        const bytes = Buffer.alloc(before.size + 1); let at = 0, count;
        while (at < bytes.length && (count = readSync(fd, bytes, at, bytes.length - at, null)) > 0) at += count;
        const after = fstatSync(fd);
        check(at === before.size && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(k => before[k] === after[k]));
        return bytes.subarray(0, at);
    } finally { closeSync(fd); }
}
function saveStatus(value) {
    protectedPath(dirname(STATUS));
    const fd = openSync(STATUS, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_CLOEXEC, 0o600);
    try { writeFileSync(fd, canonicalJSON(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(dirname(STATUS), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_CLOEXEC);
    try { fsyncSync(directory); } finally { closeSync(directory); }
}

let controller, observer, registry, guard, executor, broker, timer, stopping, phase = 'CONFIGURATION';
async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
        clearInterval(timer);
        try { await broker?.close(); } catch {}
        // A service stop is not permission to reopen this enrolled epoch.
        try { controller?.freezeAndKill(); } catch {}
        try { guard?.close(); } catch {}
        try { registry?.close(); } catch {}
        try { observer?.close(); } catch {}
        try { controller?.close(); } catch {}
        process.stderr.write('DECODER_BROKER_STOPPED_HELD\n');
        process.exit(1);
    })();
    return stopping;
}
try {
    check(process.getuid() === 0 && process.getgid() === 0 && process.argv.length === 2);
    const config = parseProofDecoderEngineJSON(read(CONFIG, 65536, 0o600), { maxBytes: 65536 });
    decoderExact(config, ['schema', 'addonPath', 'addonSha256', 'expectedBootId', 'plan', 'epoch']);
    check(config.schema === 'atlas-proof-decoder-enrolled-broker-service-v1');
    const options = { enabled: true, addonPath: config.addonPath, addonSha256: config.addonSha256, expectedBootId: config.expectedBootId };
    // Refuse static path/material faults before creating the one-use enrollment.
    const seccomp = read(config.plan.profile.seccomp.path, 65536, 0o600);
    protectedPath(dirname(STATUS));
    phase = 'NATIVE_OBSERVERS';
    observer = createProofDecoderLinuxObserver(options);
    controller = createProofDecoderLinuxCgroupController(options);
    phase = 'ENROLLMENT';
    const enrolled = openProofDecoderEnrolledTargetRegistry({ enabled: true, plan: config.plan, controller,
        epoch: config.epoch, addonPath: config.addonPath, addonSha256: config.addonSha256 });
    registry = enrolled.registry;
    phase = 'GUARD_CLIENT';
    guard = await createProofDecoderKernelGuardClient({ enabled: true, controller, observer, plan: config.plan, targetRegistry: registry });
    phase = 'ENGINE_EXECUTOR';
    executor = createProofDecoderTargetEngineExecutor({ enabled: true, plan: config.plan, targetRegistry: registry,
        parentController: controller, targetBinding: createProofDecoderFixedParentBinding({ enabled: true, plan: config.plan }),
        guardClient: guard, socketPath: '/run/docker.sock', apiVersion: '1.47', headerTimeoutMs: 1000, linuxObserver: observer });
    phase = 'BROKER_LISTENER';
    try { broker = await startProofDecoderTargetBroker({ enabled: true, plan: config.plan, targetRegistry: registry,
        parentController: controller, observer, executor, seccompBytes: seccomp }); } finally { seccomp.fill(0); }
    phase = 'STATUS_RECORD';
    saveStatus({ schema: 'atlas-proof-decoder-enrolled-broker-started-v1', enrollment: enrolled.status(),
        registry: registry.status(), parent: controller.status(), broker: broker.status() });
    const native = loadProofDecoderLinuxPrimitives(options);
    phase = 'SUPERVISOR_READY';
    native.notifySupervisor('ready');
    phase = 'WATCHDOG';
    timer = setInterval(() => {
        try {
            const s = broker.status(), p = controller.status();
            check(!s.closed && !s.poisoned && p.healthy && !p.closed && !p.frozen && !p.freezeRequested);
            native.notifySupervisor('watchdog');
        }
        catch { void stop(); }
    }, 100);
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    process.on('uncaughtException', stop); process.on('unhandledRejection', stop);
} catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
        ? error.code : 'DECODER_BROKER_SERVICE_REFUSED';
    // Only fixed phase names and bounded error codes enter the service journal.
    process.stderr.write(JSON.stringify({ schema: 'atlas-decoder-start-refusal-v1', phase, code }) + '\n');
    await stop();
}
