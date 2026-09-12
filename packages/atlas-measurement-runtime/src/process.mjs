import { spawn } from 'node:child_process';

export class MeasurementError extends Error {
  constructor(code) { super(code); this.name = 'MeasurementError'; this.code = code; }
}
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
export function aborted(signal) {
  if (signal === undefined) return false;
  try { return abortedGetter.call(signal); } catch { throw new MeasurementError('MEASUREMENT_INVALID'); }
}
/** Only small owned-path/hash metadata crosses stdin/stdout. A bounded child
 * closes before resolution, including timeout/cancel/error. No secrets pass. */
export function runMeasurementWorker(python, worker, request, { timeoutMs, signal }) {
  if (aborted(signal)) throw new MeasurementError('MEASUREMENT_CANCELLED');
  const serialized = JSON.stringify(request);
  if (Buffer.byteLength(serialized) > 32768 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new MeasurementError('MEASUREMENT_LIMIT');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-B', worker], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONNOUSERSITE: '1' } });
    let failure = null, stdout = '', outputBytes = 0, errorBytes = 0;
    const stop = code => { failure ??= new MeasurementError(code); child.kill('SIGKILL'); };
    const cancel = () => stop('MEASUREMENT_CANCELLED');
    const timer = setTimeout(() => stop('MEASUREMENT_TIMEOUT'), timeoutMs);
    child.stdout.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 32768) stop('MEASUREMENT_PROTOCOL'); else stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 8192) stop('MEASUREMENT_PROTOCOL'); });
    child.on('error', () => { failure ??= new MeasurementError('MEASUREMENT_UNAVAILABLE'); });
    child.stdin.on('error', () => {});
    child.on('close', (code, signalName) => {
      clearTimeout(timer);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', cancel);
      if (failure) { reject(failure); return; }
      if (code !== 0 || signalName) { reject(new MeasurementError('MEASUREMENT_FAILED')); return; }
      try {
        const result = JSON.parse(stdout);
        if (result.ok !== true) throw new MeasurementError(['MEASUREMENT_INVALID', 'MEASUREMENT_LIMIT', 'MEASUREMENT_SOURCE_MISMATCH', 'MEASUREMENT_EDIT_INVALID'].includes(result.code) ? result.code : 'MEASUREMENT_PROTOCOL');
        resolve(result);
      } catch (error) { reject(error instanceof MeasurementError ? error : new MeasurementError('MEASUREMENT_PROTOCOL')); }
    });
    if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', cancel, { once: true });
    if (aborted(signal)) cancel();
    child.stdin.end(serialized);
  });
}
