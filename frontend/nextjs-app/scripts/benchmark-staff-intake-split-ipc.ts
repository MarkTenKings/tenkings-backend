/** Test-only IPC. No sockets, credentials, application imports or DB clients. */
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
export const mono = () => process.hrtime.bigint().toString();
export const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
export const safeError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]');
export function tracing(role: string) {
  const operations: any[] = [], loop = monitorEventLoopDelay({ resolution: 10 });
  let timer: ReturnType<typeof setInterval> | undefined, previous = process.hrtime.bigint();
  const cpu = process.cpuUsage(), started = performance.now();
  return { operations,
    start() { loop.enable(); previous = process.hrtime.bigint(); timer = setInterval(() => { const at = process.hrtime.bigint(); operations.push({ kind: 'event_loop_tick', role, process_pid: process.pid, previous_ns: previous.toString(), at_ns: at.toString(), gap_ms: Number(at - previous) / 1e6 }); previous = at; }, 10); },
    finish() { clearInterval(timer); loop.disable(); return { role, process_pid: process.pid, operations, elapsed_ms: performance.now() - started, cpu: process.cpuUsage(cpu), rss: process.memoryUsage().rss, event_loop_ms: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 } }; },
  };
}
export function peer(send: (message: any) => void, listen: (handler: (message: any) => void) => void, handle: (method: string, args: any) => Promise<any>) {
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>(); let sequence = 0;
  listen(async message => {
    if (message.rpc === 'reply') { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(Error(message.error)) : waiter.resolve(message.result); }
    else if (message.rpc === 'request') { try { send({ rpc: 'reply', id: message.id, result: await handle(message.method, message.args) }); } catch (error) { send({ rpc: 'reply', id: message.id, error: safeError(error) }); } }
  });
  return {
    // Only the untimed full-size intake seed gets 180 s; seed-terminal and every ordinary RPC retain 60 s.
    call(method: string, args: any = {}) { const timeoutMs = method === 'seed' ? 180000 : 60000; return new Promise<any>((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`IPC ${method} exceeded ${timeoutMs / 1000} seconds`)); }, timeoutMs); pending.set(id, { resolve, reject, timer }); try { send({ rpc: 'request', id, method, args }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); } }); },
    fail(error: Error) { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); },
  };
}
