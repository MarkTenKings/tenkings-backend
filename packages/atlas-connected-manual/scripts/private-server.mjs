import { createServer } from 'node:http';
import { createConnectedHandler } from '../src/http.mjs';
import { createPrivateManualRequestVerifier, createPrivateManualNonceStore, isManualServicePath,
  MANUAL_TRANSPORT_LIMITS, ManualTransportError, manualPrivateHeaders, manualResponsePolicy,
  sendManualTransportError } from '../src/transport.mjs';

async function readBody(req) {
  const size = req.headers['content-length'];
  if (size !== undefined && (!/^\d+$/.test(size) || Number(size) > MANUAL_TRANSPORT_LIMITS.requestBytes))
    throw new ManualTransportError(413, 'REQUEST_TOO_LARGE');
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    const cleanup = () => { req.removeListener('data', data); req.removeListener('end', end);
      req.removeListener('error', error); req.removeListener('aborted', aborted); };
    const error = value => { cleanup(); reject(value); };
    const aborted = () => error(new ManualTransportError(400, 'MANUAL_REQUEST_INCOMPLETE'));
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, length)); };
    const data = chunk => {
      length += chunk.length;
      if (length > MANUAL_TRANSPORT_LIMITS.requestBytes) {
        // Pause without destroying the response socket so the caller receives
        // the explicit refusal. The error handler drains without retaining any
        // more bytes; the server request timeout still bounds a slow sender.
        req.pause(); error(new ManualTransportError(413, 'REQUEST_TOO_LARGE')); return;
      }
      chunks.push(chunk);
    };
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
  });
}
function adaptResponse(req, res) {
  res.status = value => { res.statusCode = value; return res; };
  res.send = value => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const contentType = String(res.getHeader('Content-Type') ?? '');
    const policy = manualResponsePolicy(req.url, contentType);
    if (bytes.length > policy.limit) throw new ManualTransportError(policy.overflow === 'MANUAL_IMAGE_DIRECT_REQUIRED' ? 413 : 502, policy.overflow);
    res.setHeader('Content-Length', bytes.length); res.end(bytes); return res;
  };
  res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.send(JSON.stringify(value)); };
  return res;
}

/** Construct an unstarted Linux HTTP server behind the private HTTPS ingress.
 * The host supplies the connected runtime and its actual DurableStaffBoundary
 * made from the SAME admitted staffConfig as Vercel. HMAC is transport admission,
 * never staff identity. This module reads no env, opens no DB and starts nothing.
 * Bind/listen and lifecycle ownership belong to the caller. Inject a shared
 * atomic nonceStore when routing requests among multiple private processes. */
export function createPrivateManualServer({ connected, boundary, origin, key,
  nonceStore = createPrivateManualNonceStore(), maxSkewMs = 60000, publicHandler = null }) {
  if (!connected || typeof boundary?.authenticate !== 'function') throw new ManualTransportError(500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  if(publicHandler!==null&&typeof publicHandler!=='function')throw new ManualTransportError(500,'MANUAL_TRANSPORT_CONFIG_INVALID');
  const verify = createPrivateManualRequestVerifier({ key, origin, nonceStore, maxSkewMs });
  const verified = new WeakSet();
  const handler = createConnectedHandler({ connected, boundary, origin, assertRequest(req) {
    if (!verified.has(req)) throw new ManualTransportError(401, 'MANUAL_PRIVATE_SIGNATURE_REQUIRED');
  } });
  const server = createServer({ maxHeaderSize: 32768, requestTimeout: 30000, headersTimeout: 10000 }, async (req, nativeRes) => {
    // Public evidence has its own signed read-only protocol and scoped reader.
    // It never passes through a staff session or the mutation-capable handler.
    if(publicHandler){
      try{if(await publicHandler(req,nativeRes))return;}
      catch{
        if(nativeRes.headersSent){nativeRes.destroy();return;}
        nativeRes.statusCode=503;nativeRes.setHeader('Cache-Control','no-store');nativeRes.setHeader('X-Content-Type-Options','nosniff');
        nativeRes.setHeader('Connection','close');nativeRes.setHeader('Content-Type','application/json');
        nativeRes.once('finish',()=>req.destroy());nativeRes.end(JSON.stringify({error:'MANUAL_PUBLIC_UNAVAILABLE'}));return;
      }
    }
    const res = adaptResponse(req, nativeRes); manualPrivateHeaders(res);
    try {
      if (!isManualServicePath(req.url)) throw new ManualTransportError(404, 'NOT_FOUND');
      req.rawBody = await readBody(req);
      await verify(req);
      if (req.method === 'POST') {
        try { req.body = JSON.parse(req.rawBody.toString('utf8')); }
        catch { throw new ManualTransportError(400, 'MANUAL_JSON_INVALID'); }
      }
      verified.add(req);
      if (!await handler(req, res)) throw new ManualTransportError(404, 'NOT_FOUND');
    } catch (error) {
      if (!req.complete) { req.once('error', () => {}); req.resume(); }
      sendManualTransportError(res, error);
    }
    finally { verified.delete(req); }
  });
  server.keepAliveTimeout = 5000;
  return server;
}
