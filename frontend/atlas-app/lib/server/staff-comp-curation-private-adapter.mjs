// Native-only adapter. The web runtime must import the frontend proxy directly.
import { createPrivateManualRequestVerifier, createPrivateManualNonceStore } from '../../../../packages/atlas-connected-manual/src/transport.mjs';
import { compTransportRoute } from '../staff-comp-curation-transport-contract.mjs';
import { createStaffCompCurationNativeComposition } from './staff-comp-curation-native-composition.mjs';
import { deny, privateHeaders } from './policy.mjs';
import { configured, origin, requestPin, failure } from './staff-comp-curation-transport-boundary.mjs';

/** Native host must supply exact bounded rawBody before calling this unmounted
 * adapter. Nothing listens/reads env/opens clients here. Original request is
 * verified and unchanged through asynchronous nonce admission before mapping. */
export function createStaffCompCurationPrivateAdapter(options = {}) {
  if (options.enabled !== true) return null;
  const { native, key } = options, publicOrigin = origin(options.origin);
  configured(native && Buffer.isBuffer(key) && key.length === 32);
  const nonceStore = options.nonceStore ?? createPrivateManualNonceStore(), consume = nonceStore.consume, keyCopy = Buffer.from(key);
  const nativeKeys = ['environment', 'auth', 'boundary', 'approved', 'artifacts', 'validateAccess', 'selectionPolicy', 'archiveCompAccess'];
  const nativePins = Object.fromEntries(nativeKeys.map(name => [name, native[name]]));
  const nonceInput = options.nonceStore; let closed = false;
  const current = () => configured(!closed && options.enabled === true && options.native === native && options.key === key && key.equals(keyCopy)
    && options.origin === publicOrigin && options.nonceStore === nonceInput && nonceStore.consume === consume
    && Reflect.ownKeys(options).every(name => ['enabled', 'native', 'key', 'origin', 'nonceStore'].includes(name))
    && Reflect.ownKeys(native).every(name => nativeKeys.includes(name)) && nativeKeys.every(name => native[name] === nativePins[name]));
  current(); const verify = createPrivateManualRequestVerifier({ key: keyCopy, origin: publicOrigin, nonceStore });
  const admitted = new WeakMap();
  const composition = createStaffCompCurationNativeComposition({ enabled: true, ...nativePins, origin: publicOrigin, assertRequest(req) {
    current(); const witness = admitted.get(req); configured(witness); witness();
  } });
  return Object.freeze({ close() { closed = true; composition.close(); }, async handler(req, res) {
    const route = compTransportRoute(req.url, { privateAlias: true }); if (!route) return false;
    privateHeaders(res); let mapped;
    try {
      current(); if (req.method !== route.method) deny(405, 'METHOD_NOT_ALLOWED');
      if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length > 4096 || req.headers?.['transfer-encoding'] !== undefined) deny(400, 'COMP_REQUEST_INVALID');
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d{1,4}$/.test(length) || Number(length) !== req.rawBody.length)) deny(400, 'COMP_REQUEST_INVALID');
      const pin = requestPin(req, { raw: true });
      const signed = { method: req.method, url: req.url, headers: pin.headers, rawBody: Buffer.from(pin.bytes),
        ...(req.rawHeaders ? { rawHeaders: [...req.rawHeaders] } : {}) };
      configured(await verify(signed) === true); current(); pin.check();
      mapped = { method: signed.method, url: route.path, headers: { ...signed.headers }, rawBody: Buffer.from(signed.rawBody),
        body: route.kind === 'decide' ? JSON.parse(signed.rawBody.toString('utf8')) : '' };
      const mappedPin = requestPin(mapped), mappedRaw = Buffer.from(mapped.rawBody);
      admitted.set(mapped, () => { current(); pin.check(); mappedPin.check(); configured(mapped.rawBody.equals(mappedRaw)); });
      await composition.handler(mapped, res);
    } catch (error) { failure(res, error); }
    finally { if (mapped) admitted.delete(mapped); }
    return true;
  } });
}
