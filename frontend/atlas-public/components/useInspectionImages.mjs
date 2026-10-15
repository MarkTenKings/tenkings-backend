import { useEffect, useState } from 'react';
import { parseInspectionAccess, parseReportImageAccess } from '@atlas/service-bridge/inspection-access';

// Grants are fetched on demand, outside the saved report and its approval hash.
export function useInspectionImages(packet, publicHash, reportImages = null) {
  const [access, setAccess] = useState({}), [presentationAccess, setPresentationAccess] = useState({}), [retry, setRetry] = useState(0);
  const manual = packet?.version === 'atlas-public-manual-report-v2';
  const direct = manual && packet.mode === 'PRODUCTION';
  const identity = direct ? `${packet.publicToken}:${packet.approvalVersion}:${publicHash}` : null;
  const presentationIdentity = manual ? JSON.stringify([packet.publicToken, packet.approvalVersion, publicHash,
    ...['FRONT', 'BACK'].map(side => { const image = reportImages?.images?.[side];
      return image ? [image.execution, image.sha256, image.byteCount, image.width, image.height] : null; })]) : null;
  useEffect(() => {
    if (!direct) return;
    const controller = new AbortController();
    setAccess({});
    for (const side of ['FRONT', 'BACK']) {
      void (async () => {
        try {
          const response = await fetch(`/api/reports/${packet.publicToken}/images/${side}?v=${packet.approvalVersion}&delivery=direct`, {
            credentials: 'omit', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          });
          if (!response.ok) throw new Error('IMAGE_ACCESS_UNAVAILABLE');
          const value = await response.json();
          const parsed = parseInspectionAccess(value, { publicToken: packet.publicToken,
            approvalVersion: packet.approvalVersion, publicHash, side,
            sha256: packet.images[side].sha256, byteCount: packet.images[side].byteCount });
          if (!controller.signal.aborted) setAccess(old => ({ ...old, [side]: { identity, image: parsed.image } }));
        } catch {
          if (!controller.signal.aborted) setAccess(old => ({ ...old, [side]: { identity, error: true } }));
        }
      })();
    }
    return () => controller.abort();
  }, [identity, retry]);
  useEffect(() => {
    if (!manual) return;
    const controller = new AbortController();
    setPresentationAccess({});
    for (const side of ['FRONT', 'BACK']) {
      const saved = reportImages?.images?.[side];
      if (saved?.execution !== 'PHOTOROOM_PLUS_API') continue;
      void (async () => {
        try {
          const response = await fetch(`${saved.url}&delivery=direct`, { credentials: 'omit', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
          if (!response.ok) throw new Error('REPORT_IMAGE_ACCESS_UNAVAILABLE');
          const parsed = parseReportImageAccess(await response.json(), { publicToken: packet.publicToken,
            approvalVersion: packet.approvalVersion, publicHash, side, sha256: saved.sha256,
            byteCount: saved.byteCount, width: saved.width, height: saved.height });
          if (!controller.signal.aborted) setPresentationAccess(old => ({ ...old, [side]: { identity: presentationIdentity, image: parsed.image } }));
        } catch { /* Optional presentation cannot hide the canonical approved image. */ }
      })();
    }
    return () => controller.abort();
  }, [presentationIdentity, retry]);
  if (!manual) return null;
  return Object.fromEntries(['FRONT', 'BACK'].map(side => {
    const saved = packet.images[side], current = access[side]?.identity === identity ? access[side] : null;
    const rawPresentation = reportImages?.images?.[side], grant = presentationAccess[side]?.identity === presentationIdentity ? presentationAccess[side].image : null;
    const presentation = rawPresentation?.execution === 'PHOTOROOM_PLUS_API'
      ? grant ? { ...rawPresentation, ...grant } : null : rawPresentation;
    return [side, { ...(presentation ? { presentation } : {}), inspection: direct ? { ...saved, ...current?.image,
      accessLoading: !current, accessError: Boolean(current?.error), retryAccess: () => setRetry(value => value + 1) }
      : { ...saved, url: `/api/reports/${packet.publicToken}/images/${side}?v=${packet.approvalVersion}` } }];
  }));
}
