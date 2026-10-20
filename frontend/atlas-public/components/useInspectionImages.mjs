import { useEffect, useState } from 'react';
import { parseInspectionAccess, parseReportImageAccess } from '@atlas/service-bridge/inspection-access';
import { loadPublicImageAccess } from './public-image-access.mjs';

function useGrant(identity, url, parse, priority = 0, enabled = true) {
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (!identity || !enabled || access?.identity === identity) return;
    const controller = new AbortController();
    void loadPublicImageAccess(url, { signal: controller.signal, parse, priority }).then(parsed => {
      if (!controller.signal.aborted) setAccess({ identity, image: parsed.image });
    }, () => { if (!controller.signal.aborted) setAccess({ identity, error: true }); });
    return () => controller.abort();
  }, [identity, url, enabled]);
  return identity && access?.identity === identity ? access : null;
}

function useInspectionGrant(packet, publicHash, side, direct) {
  const [retry, setRetry] = useState(0), saved = packet?.images?.[side];
  const identity = direct ? JSON.stringify([packet.publicToken, packet.approvalVersion, publicHash, saved?.sha256, saved?.byteCount, retry]) : null;
  const url = direct ? `/api/reports/${packet.publicToken}/images/${side}?v=${packet.approvalVersion}&delivery=direct` : null;
  const access = useGrant(identity, url, value => parseInspectionAccess(value, {
    publicToken: packet.publicToken, approvalVersion: packet.approvalVersion, publicHash, side,
    sha256: saved.sha256, byteCount: saved.byteCount,
  }));
  return { retry, settled: Boolean(access), inspection: direct ? { ...saved, ...access?.image,
    accessLoading: !access, accessError: Boolean(access?.error), retryAccess: () => setRetry(value => value + 1) }
    : { ...saved, url: `/api/reports/${packet?.publicToken}/images/${side}?v=${packet?.approvalVersion}` } };
}

function usePresentationGrant(packet, publicHash, saved, side, retry, enabled) {
  const identity = packet?.version === 'atlas-public-manual-report-v2' && saved?.execution === 'PHOTOROOM_PLUS_API' ? JSON.stringify([packet.publicToken,
    packet.approvalVersion, publicHash, saved.sha256, saved.byteCount, saved.width, saved.height, retry]) : null;
  const access = useGrant(identity, identity ? `${saved.url}&delivery=direct` : null, value => parseReportImageAccess(value, {
    publicToken: packet.publicToken, approvalVersion: packet.approvalVersion, publicHash, side,
    sha256: saved.sha256, byteCount: saved.byteCount, width: saved.width, height: saved.height,
  }), 1, enabled);
  // Optional presentation failure cannot hide the canonical approved image.
  return saved?.execution === 'PHOTOROOM_PLUS_API' ? access?.image ? { ...saved, ...access.image } : null : saved;
}

// All grants remain outside the saved report/hash. Canonical Front/Back access
// completes first; optional work also yields to other mounted reports' requests.
// Retrying one side retains the other side's valid grant. There is no URL cache.
export function useInspectionImages(packet, publicHash, reportImages = null) {
  const manual = packet?.version === 'atlas-public-manual-report-v2', direct = manual && packet.mode === 'PRODUCTION';
  const front = useInspectionGrant(packet, publicHash, 'FRONT', direct), back = useInspectionGrant(packet, publicHash, 'BACK', direct);
  const optionalEnabled = manual && (!direct || front.settled && back.settled);
  const frontPresentation = usePresentationGrant(packet, publicHash, reportImages?.images?.FRONT, 'FRONT', front.retry, optionalEnabled);
  const backPresentation = usePresentationGrant(packet, publicHash, reportImages?.images?.BACK, 'BACK', back.retry, optionalEnabled);
  return manual ? {
    FRONT: { inspection: front.inspection, ...(frontPresentation ? { presentation: frontPresentation } : {}) },
    BACK: { inspection: back.inspection, ...(backPresentation ? { presentation: backPresentation } : {}) },
  } : null;
}
