import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { VerifiedImageContext, VERIFIED_IMAGE_ACCESS_ENDED } from './verified-image-context.mjs';
import { createVerifiedImagePool } from './verified-image-pool.mjs';
import { loadVerifiedImage, verifiedImageContentKey } from './verified-image.mjs';

function AuthorizedImages({ children }) {
  const [blocked, setBlocked] = useState(false);
  const teardown = useRef(null);
  const pool = useMemo(() => createVerifiedImagePool({ load: loadVerifiedImage, keyOf: verifiedImageContentKey,
    onMetric: detail => { try { performance.clearMarks('atlas:verified-image'); performance.mark('atlas:verified-image', { detail }); } catch {} } }), []);
  useEffect(() => {
    clearTimeout(teardown.current);
    const revoke = () => { pool.close(); setBlocked(true); };
    window.addEventListener(VERIFIED_IMAGE_ACCESS_ENDED, revoke);
    // A BFCache restore must establish access again, not reuse an old grant.
    const hide = event => { if (event.persisted) revoke(); };
    const restore = event => { if (event.persisted) window.location.reload(); };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener(VERIFIED_IMAGE_ACCESS_ENDED, revoke); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore);
      // React StrictMode rehearses an effect cleanup/setup without abandoning
      // its identity. Actual unmount closes the pool on the next task.
      teardown.current = setTimeout(() => pool.close(), 0); };
  }, [pool]);
  const value = useMemo(() => ({ pool, blocked }), [pool, blocked]);
  return <VerifiedImageContext.Provider value={value}>{children}</VerifiedImageContext.Provider>;
}

/** Changing the authenticated identity or immutable public report destroys all
 * leases and grants. The boundary never places private evidence in storage. */
export function VerifiedImageCacheBoundary({ scope, children }) {
  return scope ? <AuthorizedImages key={scope}>{children}</AuthorizedImages> : children;
}

export function usePrefetchVerifiedImages(descriptors) {
  const { pool, blocked } = useContext(VerifiedImageContext);
  const key = JSON.stringify((descriptors ?? []).map(value => [verifiedImageContentKey(value), value?.url]));
  useEffect(() => {
    if (!pool || blocked) return;
    const controller = new AbortController();
    for (const descriptor of descriptors ?? []) if (descriptor?.url)
      void pool.borrow(descriptor, { signal: controller.signal, priority: 0 }).then(asset => asset.dispose(), () => {});
    return () => controller.abort();
  }, [pool, blocked, key]);
}

export function clearVerifiedImageAccess() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VERIFIED_IMAGE_ACCESS_ENDED));
}
