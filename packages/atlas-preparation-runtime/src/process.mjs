import { spawn } from 'node:child_process';

export class PreparationError extends Error {
  constructor(code) { super(code); this.name = 'PreparationError'; this.code = code; }
}
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
export function aborted(signal) {
  if (signal === undefined) return false;
  try { return nativeAborted.call(signal); } catch { throw new PreparationError('PREPARATION_INVALID'); }
}
export function runPreparationWorker(python, worker, request, { timeoutMs, signal }) {
  if (aborted(signal)) throw new PreparationError('PREPARATION_CANCELLED');
  const serialized = JSON.stringify(request);
  if (Buffer.byteLength(serialized) > 32768 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new PreparationError('PREPARATION_LIMIT');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', worker], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONNOUSERSITE: '1' } });
    let failure = null, stdout = '', outputBytes = 0, errorBytes = 0;
    const stop = code => { failure ??= new PreparationError(code); child.kill('SIGKILL'); };
    const cancel = () => stop('PREPARATION_CANCELLED');
    const timer = setTimeout(() => stop('PREPARATION_TIMEOUT'), timeoutMs);
    child.stdout.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 32768) stop('PREPARATION_PROTOCOL'); else stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 8192) stop('PREPARATION_PROTOCOL'); });
    child.on('error', () => { failure ??= new PreparationError('PREPARATION_UNAVAILABLE'); });
    child.stdin.on('error', () => {});
    child.on('close', (code, signalName) => {
      clearTimeout(timer);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', cancel);
      if (failure) { reject(failure); return; }
      if (code !== 0 || signalName) { reject(new PreparationError('PREPARATION_FAILED')); return; }
      try {
        const result = JSON.parse(stdout);
        if (result.ok !== true) throw new PreparationError(['PREPARATION_INVALID', 'PREPARATION_LIMIT', 'PREPARATION_SOURCE_MISMATCH', 'PREPARATION_RASTER_UNSUPPORTED', 'PREPARATION_OUTPUT_INVALID'].includes(result.code) ? result.code : 'PREPARATION_PROTOCOL');
        resolve(result);
      } catch (error) { reject(error instanceof PreparationError ? error : new PreparationError('PREPARATION_PROTOCOL')); }
    });
    if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', cancel, { once: true });
    if (aborted(signal)) cancel();
    child.stdin.end(serialized);
  });
}
