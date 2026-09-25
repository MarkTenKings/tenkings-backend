import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_BYTES = 16 * 1024 * 1024, MAX_PROTOCOL_BYTES = 32768;
const workerPath = fileURLToPath(new URL('./batch-report-worker.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
export class BatchReportProcessError extends Error {
  constructor(code, status = 503) { super(code); this.name = 'BatchReportProcessError'; this.code = code; this.status = status; }
}
function requireThat(ok, code = 'BATCH_REPORT_PROTOCOL') { if (!ok) throw new BatchReportProcessError(code); }
function interrupted(signal) {
  if (signal === undefined) return false;
  try { return abortedGetter.call(signal); } catch { throw new BatchReportProcessError('BATCH_REPORT_INVALID'); }
}
function checkSignal(signal) { if (interrupted(signal)) throw new BatchReportProcessError('BATCH_INTERRUPTED', 409); }
function groupExists(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function killGroup(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function establishGroupExit(pid, timeoutMs) {
  if (!pid) return;
  // The direct child can exit before a Python grandchild. Kill the entire owned
  // process group, then wait for its reaper (container --init on Linux).
  killGroup(pid);
  const deadline = performance.now() + timeoutMs;
  while (groupExists(pid)) {
    if (performance.now() >= deadline) throw new BatchReportProcessError('BATCH_REPORT_CLEANUP_UNCERTAIN');
    await delay(20);
  }
}
function executeChild(path, directory, request, { signal, timeoutMs, cancelGraceMs, cleanupTimeoutMs }) {
  checkSignal(signal);
  const child = spawn(process.execPath, [path], { detached: true, cwd: directory,
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', TMPDIR: directory,
      OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONNOUSERSITE: '1' } });
  let failed = null, stdout = '', stdoutBytes = 0, stderrBytes = 0, escalation, closeDeadline;
  let finish;
  const awaitClose = () => {
    closeDeadline ??= setTimeout(() => finish(null, null, false), cleanupTimeoutMs);
  };
  const fail = (code, status = 503) => {
    failed ??= new BatchReportProcessError(code, status);
    if (!escalation) {
      child.kill('SIGTERM');
      escalation = setTimeout(() => {
        try { killGroup(child.pid); } catch { failed = new BatchReportProcessError('BATCH_REPORT_CLEANUP_UNCERTAIN'); }
        awaitClose();
      }, cancelGraceMs);
    }
  };
  const abort = () => fail('BATCH_INTERRUPTED', 409);
  const timeout = setTimeout(() => fail('BATCH_REPORT_TIMEOUT'), timeoutMs);
  const closed = new Promise(resolve => {
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROTOCOL_BYTES) fail('BATCH_REPORT_PROTOCOL'); else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 8192) fail('BATCH_REPORT_PROTOCOL'); });
    child.once('error', () => { failed ??= new BatchReportProcessError('BATCH_REPORT_UNAVAILABLE'); });
    child.stdin.on('error', () => {});
    child.once('exit', () => {
      // An orphan can retain stdout/stderr and prevent 'close'. The direct
      // child's exit ends its cleanup opportunity, so stop its group now.
      try { killGroup(child.pid); } catch { failed = new BatchReportProcessError('BATCH_REPORT_CLEANUP_UNCERTAIN'); }
      awaitClose();
    });
    finish = (code, signalName, confirmedClose) => {
      clearTimeout(timeout); clearTimeout(escalation); clearTimeout(closeDeadline);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', abort);
      resolve({ code, signalName, stdout, failure: failed, confirmedClose });
    };
    child.once('close', (code, signalName) => finish(code, signalName, true));
  });
  if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', abort, { once: true });
  if (interrupted(signal)) abort();
  child.stdin.end(JSON.stringify(request));
  return { child, closed };
}

/** One permit owns the complete CPU report and its sequential Python children.
 * The worker receives data and owned paths only, never clients or credentials.
 * An unresolved process group poisons this runner and retains its native permit. */
export function createBatchReportProcess({ limited, path = workerPath, temporaryRoot = tmpdir(),
  timeoutMs = 180000, cancelGraceMs = 500, cleanupTimeoutMs = 5000 } = {}) {
  requireThat(typeof limited === 'function' && path.startsWith('/') && temporaryRoot.startsWith('/')
    && [timeoutMs, cancelGraceMs, cleanupTimeoutMs].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647), 'BATCH_REPORT_CONFIG_INVALID');
  let poisoned = null;
  return async function reportBuilder({ card, state, analysis, pythonExecutable, measurementLimits, signal }) {
    if (poisoned) throw poisoned;
    requireThat(['linux', 'darwin'].includes(process.platform), 'BATCH_REPORT_UNAVAILABLE');
    checkSignal(signal);
    const bytes = Buffer.from(JSON.stringify({ card, state, analysis, pythonExecutable, measurementLimits }));
    requireThat(bytes.length > 0 && bytes.length <= MAX_BYTES, 'BATCH_REPORT_LIMIT');
    // Snapshot before waiting for a permit; a caller cannot alter queued work.
    return new Promise((resolve, reject) => {
      limited(async () => {
        let directory = null, child = null, groupGone = false, failure = null, report;
        try {
          if (poisoned) throw poisoned;
          checkSignal(signal);
          directory = await realpath(await mkdtemp(join(temporaryRoot, 'atlas-report-')));
          const inputPath = join(directory, 'input.json'), outputPath = join(directory, 'output.json');
          await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600 });
          checkSignal(signal);
          const execution = executeChild(path, directory, { inputPath, outputPath, inputSha256: hash(bytes), inputByteCount: bytes.length },
            { signal, timeoutMs, cancelGraceMs, cleanupTimeoutMs });
          child = execution.child;
          const ended = await execution.closed;
          requireThat(ended.confirmedClose, 'BATCH_REPORT_CLEANUP_UNCERTAIN');
          await establishGroupExit(child.pid, cleanupTimeoutMs); groupGone = true;
          if (ended.failure) throw ended.failure;
          requireThat(ended.code === 0 && !ended.signalName, 'BATCH_REPORT_FAILED');
          let result; try { result = JSON.parse(ended.stdout); } catch { throw new BatchReportProcessError('BATCH_REPORT_PROTOCOL'); }
          requireThat(result && Object.getPrototypeOf(result) === Object.prototype);
          if (result.ok === false) {
            requireThat(typeof result.code === 'string' && /^(BATCH_|ATLAS_|MEASUREMENT_|MANUAL_)[A-Z0-9_]{1,90}$/.test(result.code)
              && Number.isInteger(result.status) && result.status >= 400 && result.status <= 599);
            throw new BatchReportProcessError(result.code, result.status);
          }
          requireThat(result.ok === true && result.inputSha256 === hash(bytes) && result.output?.filename === 'output.json');
          const size = (await stat(outputPath)).size;
          requireThat(size > 0 && size <= MAX_BYTES && size === result.output.byteCount, 'BATCH_REPORT_LIMIT');
          const output = await readFile(outputPath);
          requireThat(output.length === size && hash(output) === result.output.sha256);
          checkSignal(signal);
          report = JSON.parse(output.toString('utf8'));
          requireThat(report.authority === 'MACHINE_PROPOSAL' && report.certification === null);
        } catch (error) { failure = error; }
        try {
          if (child && !groupGone) await establishGroupExit(child.pid, cleanupTimeoutMs);
          if (failure?.code === 'BATCH_REPORT_CLEANUP_UNCERTAIN') throw failure;
          if (directory) await rm(directory, { recursive: true, force: true });
        } catch {
          poisoned = new BatchReportProcessError('BATCH_REPORT_CLEANUP_UNCERTAIN'); reject(poisoned);
          // Deliberately unresolved: the limiter must not recycle this permit
          // while descendants or their scratch directory may still be owned.
          await new Promise(() => {}); return;
        }
        if (failure) throw failure;
        return report;
      }).then(resolve, reject);
    });
  };
}
