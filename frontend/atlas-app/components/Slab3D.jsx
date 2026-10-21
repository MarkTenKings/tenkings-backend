import { useEffect, useRef, useState } from 'react';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { APPROVED_MEDIA_ACCESS_ENDED } from '../lib/approved-card-media.mjs';
import { createSlabScene } from '../lib/slab-3d-scene.mjs';
import styles from './Slab3D.module.css';

/** Optional detail presentation; the approved Front/Back views stay independent. */
export default function Slab3D({ name, frontUrl, backUrl, labelUrl, fallback }) {
  const host = useRef(null), owned = useRef(null);
  const [status, setStatus] = useState('loading'), [facing, setFacing] = useState('Front visible'), [retry, setRetry] = useState(0);
  const [reason, setReason] = useState(null);
  useEffect(() => {
    let active = true, scene;
    setStatus('loading'); setReason(null);
    const endAccess = () => { active = false; scene?.dispose(); owned.current = null; setStatus('blocked'); };
    window.addEventListener(APPROVED_MEDIA_ACCESS_ENDED, endAccess); window.addEventListener('pagehide', endAccess);
    try {
      scene = createSlabScene(host.current, { frontUrl, backUrl, labelUrl, nfcUrl: `${STAFF_BASE_PATH}/brand/archive/nfc-tag-reference.jpg`,
        onReady: () => { if (active) setStatus('ready'); },
        onFacing: value => { if (active) setFacing(value); },
        onError: failure => { if (active) { setReason(failure.code); setStatus('unavailable'); } },
      });
      owned.current = scene;
    } catch (failure) { setReason(failure.code); setStatus('unavailable'); }
    return () => { active = false; scene?.dispose(); if (owned.current === scene) owned.current = null;
      window.removeEventListener(APPROVED_MEDIA_ACCESS_ENDED, endAccess); window.removeEventListener('pagehide', endAccess); };
  }, [frontUrl, backUrl, labelUrl, retry]);
  const ready = status === 'ready', blocked = status === 'blocked';
  return <div className={styles.root} data-slab-state={status}>
    <div ref={host} className={styles.viewport} tabIndex={ready ? 0 : -1} role={ready ? 'img' : undefined} aria-busy={status === 'loading'}
      aria-label={ready ? `${name}. Illustrative 3D slab. ${facing}. Drag horizontally or use Left and Right arrows to turn. Home resets; End shows Back.` : undefined}>
      {!ready && !blocked && <div className={styles.fallback}>{fallback}</div>}
      {blocked && <p className={styles.message} role="status">Staff access ended.</p>}
      {!ready && !blocked && <div className={styles.message} role="status"><strong>{status === 'loading' ? 'Opening 3D preview…' : '3D preview unavailable'}</strong>
        {status === 'unavailable' && <><span>{reason === 'SLAB_TEXTURE_LIMIT' ? 'This device cannot display the saved photographs at their full resolution in 3D.' : 'Front and Back photographs remain available.'}</span>
          <button type="button" onClick={() => setRetry(value => value + 1)}>Retry 3D</button></>}
      </div>}
    </div>
    <div className={styles.tools} role="group" aria-label="Turn slab">
      <button type="button" disabled={!ready} onClick={() => owned.current?.rotateBy(-Math.PI / 6)} aria-label="Turn slab left"><span aria-hidden="true">←</span></button>
      <span className={styles.hint}>{ready ? 'Drag to turn' : '3D preview'}</span>
      <button type="button" disabled={!ready} onClick={() => owned.current?.rotateBy(Math.PI / 6)} aria-label="Turn slab right"><span aria-hidden="true">→</span></button>
      <span className={styles.divider} aria-hidden="true"/>
      <button type="button" className={styles.reset} disabled={!ready} onClick={() => owned.current?.reset()}>Reset</button>
    </div>
    <span className={styles.srOnly} aria-live="polite">{ready ? facing : ''}</span>
  </div>;
}
