import { digest, object, requireThat } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { parseSpeedsterTraceRleV1, decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { MANUAL_PUBLIC_PATH, verifyManualPublicRequest } from '@atlas/service-bridge/manual-public';

export function createApprovedManualReader({ client, artifacts, storage }) {
  async function selected(claims) {
    requireThat(claims.expiresAt > Date.now(), 403, 'MANUAL_PUBLIC_REQUEST_EXPIRED');
    const rows = await client.$transaction(async tx => tx.$queryRawUnsafe('SELECT * FROM atlas_manual.read_publication($1::text,$2::integer,$3::text,$4::text,$5::text)',
      claims.request.token, claims.request.version, claims.deploymentId, claims.releaseSha, claims.configHash), { maxWait: 1500, timeout: 3000 });
    if (!rows.length) return null;
    requireThat(rows.length === 1 && digest(rows[0].manifest) === rows[0].manifest_hash, 503, 'MANUAL_PUBLICATION_CORRUPT');
    const row = rows[0], manifest = JSON.parse(row.manifest);
    object(manifest, ['version','packet','media','publicHash']);
    requireThat(manifest.version === 'atlas-manual-publication-manifest-v1' && manifest.publicHash === row.public_hash
      && manifest.packet.ref.sha256 === row.public_hash, 503, 'MANUAL_PUBLICATION_CORRUPT');
    return { row, manifest };
  }
  async function readArtifact(saved, row, kind, signal) {
    const value = await artifacts.read(saved.ref, { cardId: row.card_id, kind, sourceHash: saved.sourceHash }, { signal });
    requireThat(digest(JSON.stringify(value)) === saved.sourceHash, 503, 'MANUAL_PUBLICATION_CORRUPT'); return value;
  }
  return Object.freeze({ async read(claims) {
    const signal = AbortSignal.timeout(Math.max(1, Math.min(20000, claims.expiresAt - Date.now()))), found = await selected(claims);
    if (!found) return null;
    const { row, manifest } = found;
    const packet = parsePublicManualReport(await readArtifact(manifest.packet, row, 'PUBLIC_REPORT', signal));
    requireThat(packet.publicToken === claims.request.token && packet.approvalVersion === row.version && (claims.request.version === null || claims.request.version === row.version) && packet.mode === row.mode
      && digest(JSON.stringify(packet)) === row.public_hash, 503, 'MANUAL_PUBLICATION_CORRUPT');
    let result;
    if (claims.request.kind === 'REPORT') result = { contentType: 'application/json', bytes: Buffer.from(JSON.stringify({ packet, publicHash: row.public_hash })) };
    else if (claims.request.kind === 'IMAGE') {
      const media = await readArtifact(manifest.media, row, 'APPROVED_MEDIA', signal), side = claims.request.side;
      const descriptor = packet.images[side];
      const photo = await storage.readDerivative({ ...media[side], signal });
      requireThat(photo.bytes.length === descriptor.byteCount && digest(photo.bytes) === descriptor.sha256, 503, 'MANUAL_PUBLICATION_IMAGE_MISMATCH');
      result = { bytes: photo.bytes, contentType: descriptor.contentType };
    } else {
      const finding = packet.report.findings.find(f => f.id === claims.request.findingId), trace = finding?.finalTrace ?? finding?.detectorMask;
      if (!trace) return null;
      const value = parseSpeedsterTraceRleV1(trace);
      result = { contentType: 'application/json', bytes: Buffer.from(JSON.stringify({ side: finding.side, publicHash: row.public_hash,
        traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(value), value.sha256) })) };
    }
    signal.throwIfAborted();
    const after = await selected(claims);
    requireThat(after && after.row.manifest_hash === row.manifest_hash && after.row.public_hash === row.public_hash, 503, 'MANUAL_PUBLICATION_CHANGED');
    return result;
  } });
}

// Raw-body handler for the private host, mounted before ordinary staff transport.
// It cannot authenticate a staff actor or invoke a card/approval/provider action.
export function createManualPublicHandler({ key, reader, maxConcurrent = 2 }) {
  requireThat(Buffer.isBuffer(key) && key.length === 32 && Number.isInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 4, 500, 'MANUAL_PUBLIC_CONFIGURATION_INVALID');
  const used = new Map(); let active = 0;
  return async (req, res) => {
    if (req.url !== MANUAL_PUBLIC_PATH) return false;
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    try {
      requireThat(req.method === 'POST' && req.headers.host === 'private.atlasgrading.com' && !req.headers.authorization && !req.headers.cookie
        && /^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''), 403, 'MANUAL_PUBLIC_AUTH_REQUIRED');
      let bytes = 0; const parts = [], iterator = req[Symbol.asyncIterator]();
      const deadline = Date.now() + 5000;
      while (true) {
        let timer;
        const next = await Promise.race([iterator.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('MANUAL_PUBLIC_BODY_TIMEOUT'), { status: 408 })), Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer));
        if (next.done) break;
        const chunk = Buffer.from(next.value); bytes += chunk.length; requireThat(bytes <= 4096, 413, 'MANUAL_PUBLIC_REQUEST_INVALID'); parts.push(chunk);
      }
      let claims;
      try { claims = verifyManualPublicRequest({ key }, Buffer.concat(parts).toString('utf8'), req.headers['x-atlas-manual-public-signature']); }
      catch { requireThat(false,403,'MANUAL_PUBLIC_AUTH_REQUIRED'); }
      for (const [nonce, until] of used) if (until <= Date.now()) used.delete(nonce);
      requireThat(!used.has(claims.nonce), 409, 'MANUAL_PUBLIC_REPLAY');
      requireThat(used.size < 2000 && active < maxConcurrent, 503, 'MANUAL_PUBLIC_BUSY');
      used.set(claims.nonce, claims.expiresAt); active++;
      let result; try { result = await reader.read(claims); } finally { active--; }
      if (!result) { res.statusCode = 404; res.end(); return true; }
      res.statusCode = 200; res.setHeader('Content-Type',result.contentType); res.setHeader('Content-Length',result.bytes.length); res.end(result.bytes);
    } catch (error) {
      // Refused or unfinished bodies must never share a keep-alive connection
      // with another request. Closing after the response also cancels a pending
      // iterator read without keeping an unbounded drain alive.
      res.setHeader('Connection', 'close');
      res.once?.('finish', () => req.destroy?.());
      res.statusCode = Number.isInteger(error?.status) ? error.status : 503; res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ error: res.statusCode === 503 ? 'MANUAL_PUBLIC_UNAVAILABLE' : 'MANUAL_PUBLIC_REQUEST_REFUSED' }));
    }
    return true;
  };
}
