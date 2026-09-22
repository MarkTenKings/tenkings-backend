import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDefectWorkspace, runDefectMeasurement } from '@atlas/manual-workspace/defect-actions';
import { aborted, MeasurementError, runMeasurementWorker } from './process.mjs';

export { MeasurementError };
const root = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/', import.meta.url));
const sourceManifest = JSON.parse(await readFile(new URL('../engine-source.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function requireThat(ok, code = 'MEASUREMENT_INVALID') { if (!ok) throw new MeasurementError(code); }
function limitsSnapshot(value) {
  const keys = ['maxInputBytes', 'maxOutputBytes', 'maxFindings', 'timeoutMs'];
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'MEASUREMENT_LIMIT');
  const limits = { ...value };
  requireThat(Object.keys(limits).length === keys.length && keys.every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0)
    && limits.timeoutMs <= 2147483647, 'MEASUREMENT_LIMIT');
  return limits;
}
/** Runs the existing review reducer and checked CPU measure_manual_side against
 * an owned state snapshot. The output is a current-bound result for the pure
 * applyDefectMeasurement action, not a database mutation or report approval.
 * Input masks, output findings and temporary paths never enter stdout/receipts.
 * Per-request bounds do not claim an outer OS/native memory limit. */
export async function measureDefectWorkspaceEdit({ workspace, side, limits: value, pythonExecutable, signal } = {}) {
  requireThat(!aborted(signal), 'MEASUREMENT_CANCELLED');
  requireThat(typeof pythonExecutable === 'string' && pythonExecutable.startsWith('/'), 'MEASUREMENT_UNAVAILABLE');
  const limits = limitsSnapshot(value), snapshot = parseDefectWorkspace(workspace);
  requireThat(['FRONT', 'BACK'].includes(side) && snapshot.sides[side].pending, 'MEASUREMENT_INVALID');
  return runDefectMeasurement(snapshot, side, async input => {
    const bytes = Buffer.from(JSON.stringify(input));
    requireThat(bytes.length <= limits.maxInputBytes && input.findings.length + input.marks.length <= limits.maxFindings, 'MEASUREMENT_LIMIT');
    const digest = hash(bytes);
    for (const [name, expected] of Object.entries(sourceManifest.sources)) {
      requireThat(hash(await readFile(join(root, name))) === expected, 'MEASUREMENT_SOURCE_MISMATCH');
    }
    requireThat(!aborted(signal), 'MEASUREMENT_CANCELLED');
    const directory = await mkdtemp(join(tmpdir(), 'atlas-measurement-'));
    try {
      const inputPath = join(directory, 'input.json'), outputPath = join(directory, 'result.json');
      await writeFile(inputPath, bytes, { mode: 0o600, flag: 'wx' });
      const response = await runMeasurementWorker(pythonExecutable, join(root, 'manual_measurement_worker.py'), {
        inputPath, outputPath, inputSha256: digest, inputByteCount: bytes.length,
        ...limits, expectedSources: sourceManifest.sources,
      }, { timeoutMs: limits.timeoutMs, signal });
      requireThat(!aborted(signal), 'MEASUREMENT_CANCELLED');
      requireThat(response.inputSha256 === digest && response.output?.filename === 'result.json'
        && JSON.stringify(response.identity?.sources) === JSON.stringify(sourceManifest.sources), 'MEASUREMENT_SOURCE_MISMATCH');
      const size = (await stat(outputPath)).size;
      requireThat(size > 0 && size <= limits.maxOutputBytes && size === response.output.byteCount, 'MEASUREMENT_LIMIT');
      const output = await readFile(outputPath);
      requireThat(hash(output) === response.output.sha256, 'MEASUREMENT_SOURCE_MISMATCH');
      const measured = JSON.parse(output.toString('utf8'));
      requireThat(!aborted(signal), 'MEASUREMENT_CANCELLED');
      return { ...measured, receipt: { version: 'atlas-manual-cpu-measurement-v1', inputSha256: digest,
        inputByteCount: bytes.length, outputSha256: response.output.sha256, outputByteCount: output.length,
        identity: response.identity } };
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
