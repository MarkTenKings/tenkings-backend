import { createPrivateRuntime } from './runtime';

const port = Number(process.env.PORT ?? '8091');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ATLAS_PRIVATE_PORT_INVALID');
const listenHost = process.env.ATLAS_PRIVATE_LISTEN_HOST ?? '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(listenHost)) throw new Error('ATLAS_PRIVATE_LISTEN_HOST_INVALID');
try {
    const runtime = await createPrivateRuntime(process.env);
    runtime.server.listen(port, listenHost, () => process.stdout.write(JSON.stringify(runtime.health) + '\n'));
    let closing = false;
    const stop = () => {
        if (closing) return; closing = true;
        runtime.stop();
        const timer = setTimeout(() => { runtime.server.closeAllConnections(); process.exit(3); }, 250000);
        runtime.server.close(async () => { try { await runtime.close(); clearTimeout(timer); process.exit(0); }
            catch { process.exit(3); } });
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch { process.stderr.write('ATLAS_PRIVATE_STARTUP_REJECTED\n'); process.exitCode = 78; }
