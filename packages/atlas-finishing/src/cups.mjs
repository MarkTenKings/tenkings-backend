import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdir, open, lstat, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateManualFinishingPlan } from './manual.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, code) => { if (!ok) throw new Error(code); };
const MAX_PDF = 8 * 1024 * 1024;
function configuration(config) {
  assert(config?.version === 'atlas-cups-printer-v1' && config.qualified === true
    && /^[a-f0-9]{64}$/.test(config.qualificationHash) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/.test(config.printer)
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(config.media) && config.layoutVersion === 'atlas-noir-gold-v1'
    && config.actualSize === true, 'CUPS_QUALIFIED_CONFIGURATION_REQUIRED');
  return { version: config.version, printer: config.printer, media: config.media, layoutVersion: config.layoutVersion,
    qualificationHash: config.qualificationHash, actualSize: true };
}
export function createFileCupsJournal({ directory }) {
  assert(typeof directory === 'string' && isAbsolute(directory), 'CUPS_JOURNAL_DIRECTORY_INVALID');
  const path = (id, suffix = '') => { assert(/^afprint_[a-f0-9]{64}$/.test(id), 'CUPS_INTENT_INVALID'); return join(directory, `${id}${suffix}.json`); };
  async function checkedDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 }); const stat = await lstat(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
      && (process.getuid === undefined || stat.uid === process.getuid()), 'CUPS_JOURNAL_DIRECTORY_UNSAFE');
  }
  async function read(file) {
    try { const stat = await lstat(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096
      && (stat.mode & 0o077) === 0, 'CUPS_JOURNAL_INVALID'); return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function create(file, record) {
    const bytes = JSON.stringify(record); assert(Buffer.byteLength(bytes) <= 4096, 'CUPS_JOURNAL_INVALID');
    let handle;
    try { handle = await open(file, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    finally { await handle?.close(); }
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } return true;
  }
  async function get(id) {
    await checkedDirectory(); const initial = await read(path(id)); if (!initial) return null;
    const accepted = await read(path(id, '.accepted')), completed = await read(path(id, '.completed')), failed = await read(path(id, '.failed'));
    assert(!(completed && failed), 'CUPS_JOURNAL_CONFLICT');
    for (const item of [accepted, completed, failed].filter(Boolean)) assert(['intentId', 'planHash', 'documentHash', 'profileHash'].every(key => item[key] === initial[key]), 'CUPS_JOURNAL_CONFLICT');
    assert(!(completed || failed) || accepted && (completed || failed).jobId === accepted.jobId, 'CUPS_JOURNAL_CONFLICT');
    return completed || failed || accepted || initial;
  }
  return {
    get,
    async reserve(record) { await checkedDirectory(); const created = await create(path(record.intentId), record); return { created, record: await get(record.intentId) }; },
    async commit(record) {
      const current = await get(record.intentId);
      assert(current && ['intentId', 'planHash', 'documentHash', 'profileHash'].every(key => current[key] === record[key]), 'CUPS_JOURNAL_CONFLICT');
      if (record.state === 'UNKNOWN') return;
      const suffix = { SPOOL_ACCEPTED: '.accepted', SPOOL_COMPLETED: '.completed', SPOOL_FAILED: '.failed' }[record.state];
      assert(suffix && Number.isSafeInteger(record.jobId) && record.jobId > 0
        && (!current.jobId || current.jobId === record.jobId), 'CUPS_JOURNAL_CONFLICT');
      if (['SPOOL_COMPLETED', 'SPOOL_FAILED'].includes(current.state)) { assert(current.state === record.state, 'CUPS_JOURNAL_CONFLICT'); return; }
      if (record.state !== 'SPOOL_ACCEPTED') assert(current.state === 'SPOOL_ACCEPTED', 'CUPS_JOURNAL_CONFLICT');
      const file = path(record.intentId, suffix);
      if (!await create(file, record)) assert(JSON.stringify(await read(file)) === JSON.stringify(record), 'CUPS_JOURNAL_CONFLICT');
    },
  };
}
/** journal.reserve(record) atomically creates or returns the existing intent.
 * Return {created,record}; commit(record) durably replaces that exact intent.
 * A reservation survives restart and is never deleted to permit a blind reprint.
 */
export function createCupsPrinter({ config, journal, transport, renderDocument }) {
  const profile = configuration(config), profileHash = sha(JSON.stringify(profile));
  assert(journal?.reserve && journal?.get && journal?.commit && transport?.submit && transport?.inspect
    && typeof renderDocument === 'function', 'CUPS_ADAPTER_CONFIGURATION_INVALID');
  async function status(intentId, planHash) {
    const record = await journal.get(intentId);
    assert(record?.planHash === planHash && record.profileHash === profileHash, 'CUPS_INTENT_MISMATCH');
    if (!record.jobId || ['SPOOL_COMPLETED', 'SPOOL_FAILED'].includes(record.state)) return record;
    let job; try { job = await transport.inspect({ jobId: record.jobId }); } catch { return { ...record, state: 'UNKNOWN' }; }
    if (job?.jobId !== record.jobId || job.name !== intentId || job.printer !== profile.printer) return { ...record, state: 'UNKNOWN' };
    const state = job.state === 9 ? 'SPOOL_COMPLETED' : [7, 8].includes(job.state) ? 'SPOOL_FAILED' : [3, 4, 5, 6].includes(job.state) ? 'SPOOL_ACCEPTED' : 'UNKNOWN';
    const updated = { ...record, state };
    await journal.commit(updated); return updated;
  }
  return Object.freeze({ capability: Object.freeze({ qualified: true, profile: 'atlas-cups-v1', profileHash }),
    async prepare({ plan }) {
      plan = structuredClone(plan);
      validateManualFinishingPlan(plan); assert(plan.label.mode === 'PRODUCTION', 'CUPS_FIXTURE_CANNOT_PRINT');
      const document = await renderDocument(structuredClone(plan));
      assert(document?.planHash === plan.planHash && document.layoutVersion === profile.layoutVersion
        && Buffer.isBuffer(document.bytes) && document.bytes.length > 8 && document.bytes.length <= MAX_PDF
        && document.bytes.subarray(0, 5).toString('ascii') === '%PDF-', 'CUPS_DOCUMENT_MISMATCH');
      const ownedPdf = Buffer.from(document.bytes), documentHash = sha(ownedPdf);
      assert(document.sha256 === documentHash, 'CUPS_DOCUMENT_MISMATCH');
      const record = { version: 'atlas-cups-intent-v1', intentId: plan.print.intentId, planHash: plan.planHash,
        documentHash, profileHash, state: 'UNKNOWN', jobId: null };
      // Reserve BEFORE the external effect. A lost result must never dispatch again.
      const reserved = await journal.reserve(record);
      assert(reserved?.record?.intentId === record.intentId && reserved.record.planHash === record.planHash
        && reserved.record.profileHash === record.profileHash && reserved.record.documentHash === record.documentHash, 'CUPS_INTENT_CONFLICT');
      if (!reserved.created) return status(record.intentId, plan.planHash);
      let submitted;
      try { submitted = await transport.submit({ printer: profile.printer, media: profile.media, title: record.intentId, bytes: ownedPdf }); }
      catch { return record; }
      if (!Number.isSafeInteger(submitted?.jobId) || submitted.jobId < 1 || submitted.printer !== profile.printer) return record;
      const accepted = { ...record, state: 'SPOOL_ACCEPTED', jobId: submitted.jobId };
      try { await journal.commit(accepted); return accepted; } catch { return record; }
    }, status,
  });
}

function attribute(tag, name, value) {
  const n = Buffer.from(name), v = Buffer.from(value), out = Buffer.alloc(5 + n.length + v.length);
  out[0] = tag; out.writeUInt16BE(n.length, 1); n.copy(out, 3); out.writeUInt16BE(v.length, 3 + n.length); v.copy(out, 5 + n.length); return out;
}
export function cupsJobRequest(jobId) {
  assert(Number.isSafeInteger(jobId) && jobId > 0 && jobId <= 2147483647, 'CUPS_JOB_ID_INVALID');
  return Buffer.concat([Buffer.from([2, 0, 0, 9, 0, 0, 0, 1, 1]), attribute(0x47, 'attributes-charset', 'utf-8'),
    attribute(0x48, 'attributes-natural-language', 'en'), attribute(0x45, 'job-uri', `ipp://localhost/jobs/${jobId}`),
    attribute(0x44, 'requested-attributes', 'job-id'), attribute(0x44, '', 'job-state'), attribute(0x44, '', 'job-name'),
    attribute(0x44, '', 'job-printer-uri'), Buffer.from([3])]);
}
export function parseCupsJobResponse(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 9 && bytes.length <= 65536 && bytes[0] === 2
    && bytes.readUInt16BE(2) <= 0xff && bytes.readUInt32BE(4) === 1, 'CUPS_IPP_INVALID');
  let at = 8, group = 0, ended = false; const attrs = new Map();
  while (at < bytes.length) {
    const tag = bytes[at++]; if (tag === 3) { ended = true; break; } if (tag < 0x10) { group = tag; continue; }
    assert(at + 2 <= bytes.length, 'CUPS_IPP_INVALID'); const nl = bytes.readUInt16BE(at); at += 2;
    assert(at + nl + 2 <= bytes.length, 'CUPS_IPP_INVALID'); const name = bytes.subarray(at, at + nl).toString('utf8'); at += nl;
    const vl = bytes.readUInt16BE(at); at += 2; assert(at + vl <= bytes.length, 'CUPS_IPP_INVALID'); const value = bytes.subarray(at, at + vl); at += vl;
    if (group === 2 && ['job-id', 'job-state', 'job-name', 'job-printer-uri'].includes(name)) {
      assert(!attrs.has(name), 'CUPS_IPP_INVALID'); attrs.set(name, { tag, value });
    }
  }
  assert(ended && at === bytes.length, 'CUPS_IPP_INVALID');
  const integer = (name, tag) => { const v = attrs.get(name); assert(v?.tag === tag && v.value.length === 4, 'CUPS_IPP_INVALID'); return v.value.readInt32BE(); };
  const string = (name, tag) => { const v = attrs.get(name); assert(v?.tag === tag && v.value.length > 0 && v.value.length < 2048, 'CUPS_IPP_INVALID'); return v.value.toString('utf8'); };
  const url = new URL(string('job-printer-uri', 0x45));
  assert(url.protocol === 'ipp:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    && /^\/printers\/[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/.test(url.pathname) && !url.search && !url.hash, 'CUPS_IPP_INVALID');
  return { jobId: integer('job-id', 0x21), state: integer('job-state', 0x23), name: string('job-name', 0x42), printer: url.pathname.slice(10) };
}

/** Explicit opt-in local transport. Importing this module never starts a process,
 * connects to CUPS, discovers printers or prints anything. PDF bytes use stdin:
 * no shell interpolation, file-path race, inherited CUPS_SERVER or default printer.
 */
export function createLocalCupsTransport({ spawnImpl = spawn, requestImpl = httpRequest, timeoutMs = 15000 } = {}) {
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'CUPS_TIMEOUT_INVALID');
  return {
    submit({ printer, media, title, bytes }) {
      assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/.test(printer) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(media)
        && /^afprint_[a-f0-9]{64}$/.test(title) && Buffer.isBuffer(bytes) && bytes.length <= MAX_PDF, 'CUPS_SUBMIT_INVALID');
      return new Promise((resolve, reject) => {
        const child = spawnImpl('/usr/bin/lp', ['-h', '127.0.0.1:631', '-d', printer, '-n', '1', '-t', title,
          '-o', `media=${media}`, '-o', 'print-scaling=none', '-o', 'sides=one-sided', '-o', 'job-sheets=none', '-'],
        { shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '', failed = false;
        const stop = () => { if (!failed) { failed = true; child.kill('SIGKILL'); reject(new Error('CUPS_SUBMISSION_UNCERTAIN')); } };
        const timer = setTimeout(stop, timeoutMs);
        child.stdout.on('data', data => { output += data.toString(); if (output.length > 16384) stop(); });
        child.stderr.on('data', () => {}); child.stdin.on('error', stop);
        child.on('error', stop); child.on('close', code => {
          clearTimeout(timer); if (failed) return;
          const escaped = printer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = new RegExp(`^request id is ${escaped}-(\\d+) \\(1 file\\(s\\)\\)\\s*$`).exec(output);
          if (code !== 0 || !match) reject(new Error('CUPS_SUBMISSION_UNCERTAIN'));
          else resolve({ printer, jobId: Number(match[1]) });
        });
        child.stdin.end(bytes);
      });
    },
    inspect({ jobId }) {
      const body = cupsJobRequest(jobId);
      return new Promise((resolve, reject) => {
        const req = requestImpl({ host: '127.0.0.1', port: 631, path: '/', method: 'POST',
          headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length }, agent: false }, response => {
          let size = 0; const chunks = [];
          response.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(new Error('CUPS_IPP_INVALID')); else chunks.push(chunk); });
          response.on('error', reject); response.on('end', () => { clearTimeout(timer); try {
            assert(response.statusCode === 200, 'CUPS_IPP_INVALID'); resolve(parseCupsJobResponse(Buffer.concat(chunks)));
          } catch (error) { reject(error); } });
        });
        const timer = setTimeout(() => req.destroy(new Error('CUPS_STATUS_UNKNOWN')), timeoutMs);
        req.on('error', error => { clearTimeout(timer); reject(error); }); req.end(body);
      });
    },
  };
}
