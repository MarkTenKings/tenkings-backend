import { useEffect, useRef, useState } from 'react';
import { STAFF_BASE_PATH } from '../lib/routes.mjs';
import { APPROVED_MEDIA_ACCESS_ENDED } from '../lib/approved-card-media.mjs';
import { createSlabScene } from '../lib/slab-3d-scene.mjs';
import styles from './Slab3D.module.css';

/** Optional detail presentation; the approved Front/Back views stay independent. */
export default function Slab3D({ name, frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion, initialFrontUrl, initialBackUrl, fallback }) {
  const host = useRef(null), owned = useRef(null), assets = useRef(null), detailFailures = useRef(new Set()), labelFailures = useRef(new Set());
  assets.current = { frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion, initialFrontUrl, initialBackUrl };
  const [status, setStatus] = useState('loading'), [facing, setFacing] = useState('Front visible'), [retry, setRetry] = useState(0);
  const [reason, setReason] = useState(null), [labelIssue, setLabelIssue] = useState(false);
  useEffect(() => {
    let active = true, scene;
    setStatus('loading'); setReason(null); detailFailures.current.clear(); labelFailures.current.clear(); setLabelIssue(false);
    const endAccess = () => { active = false; scene?.dispose(); owned.current = null; setStatus('blocked'); };
    window.addEventListener(APPROVED_MEDIA_ACCESS_ENDED, endAccess); window.addEventListener('pagehide', endAccess);
    try {
      scene = createSlabScene(host.current, { ...assets.current, frontUrl: assets.current.initialFrontUrl || assets.current.frontUrl,
        backUrl: assets.current.initialBackUrl || assets.current.backUrl, nfcUrl: `${STAFF_BASE_PATH}/brand/archive/nfc-tag-reference-384.webp`,
        onReady: () => { if (active) setStatus('ready'); },
        onAssetError: (failure, { slot }) => {
          if (!active) return;
          if (['frontUrl', 'backUrl'].includes(slot)) { detailFailures.current.add(slot); setReason(failure.code); }
          if (['labelUrl', 'backLabelUrl'].includes(slot)) { labelFailures.current.add(slot); setLabelIssue(true); }
        },
        onAssetReady: ({ slot }) => { if (active) { detailFailures.current.delete(slot); if (!detailFailures.current.size) setReason(null); labelFailures.current.delete(slot); setLabelIssue(labelFailures.current.size > 0); } },
        onFacing: value => { if (active) setFacing(value); },
        onError: failure => { if (active) { setReason(failure.code); setStatus('unavailable'); } },
      });
      owned.current = scene;
      scene.updateAssets(assets.current);
    } catch (failure) { setReason(failure.code); setStatus('unavailable'); }
    return () => { active = false; scene?.dispose(); if (owned.current === scene) owned.current = null;
      window.removeEventListener(APPROVED_MEDIA_ACCESS_ENDED, endAccess); window.removeEventListener('pagehide', endAccess); };
  }, [retry]);
  useEffect(() => {
    // URLs may improve from verified presentation pixels to the full approved
    // photograph. Keep this scene, camera angle and context during that upgrade.
    owned.current?.updateAssets({ frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion });
  }, [frontUrl, backUrl, labelUrl, backLabelUrl, labelLayoutVersion]);
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
      <span className={styles.hint} title={ready && reason ? 'Higher-resolution detail is unavailable. The verified preview remains interactive.' : undefined}>{ready ? reason ? 'Preview quality' : 'Drag to turn' : '3D preview'}</span>
      <button type="button" disabled={!ready} onClick={() => owned.current?.rotateBy(Math.PI / 6)} aria-label="Turn slab right"><span aria-hidden="true">→</span></button>
      <span className={styles.divider} aria-hidden="true"/>
      <button type="button" className={styles.reset} disabled={!ready} onClick={() => owned.current?.reset()}>Reset</button>
    </div>
    {ready && labelIssue && <div className={styles.assetNotice} role="status"><span>Saved label display unavailable.</span>
      <button type="button" onClick={() => owned.current?.retryAssets([...labelFailures.current])}>Retry label</button></div>}
    <span className={styles.srOnly} aria-live="polite">{ready ? facing : ''}</span>
  </div>;
}
