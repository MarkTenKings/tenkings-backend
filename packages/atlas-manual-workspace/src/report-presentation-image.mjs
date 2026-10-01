import { useEffect, useState } from 'react';
import { useVerifiedImage } from './verified-image.mjs';

/** Defense at the rendering boundary in addition to the public manifest parser. */
export function presentationDescriptorMatches(descriptor, side, sourceSha256, publication) {
  if (!descriptor || !publication || !/^[a-f0-9]{64}$/.test(sourceSha256 ?? '')) return false;
  let token;
  try { token = new URL(publication.url, 'https://atlasgrading.com').pathname.match(/^\/reports\/(ar_[A-Za-z0-9_-]{24})$/)?.[1]; } catch { return false; }
  return Boolean(token && descriptor.publicToken === token && descriptor.publicHash === publication.reportHash
    && descriptor.approvalVersion === publication.version && descriptor.side === side && descriptor.sourceSha256 === sourceSha256
    && /^[a-f0-9]{64}$/.test(descriptor.sha256 ?? '') && descriptor.sha256 !== sourceSha256
    && Number.isSafeInteger(descriptor.width) && descriptor.width >= 2 && descriptor.width <= 4096
    && Number.isSafeInteger(descriptor.height) && descriptor.height >= 2 && descriptor.height <= 4096
    && descriptor.width * descriptor.height <= 8_294_400
    && Number.isSafeInteger(descriptor.byteCount) && descriptor.byteCount > 0 && descriptor.byteCount <= 4 * 1024 * 1024
    && descriptor.contentType === 'image/png' && descriptor.transparent === true && descriptor.presentationOnly === true
    && descriptor.preservesOriginalRGB === false && descriptor.alignment === 'approximate-frame-fit'
    && descriptor.url === `/api/reports/${token}/presentation/${side}?v=${publication.version}&sha=${descriptor.sha256}`);
}

/** Originals are usable before these optional bytes are requested. Hash/length
 * verification and Blob lifetime use the same bounded pool as evidence photos. */
export function usePresentationImage(descriptor, { enabled, side, sourceSha256, publication }) {
  const accepted = enabled && presentationDescriptorMatches(descriptor, side, sourceSha256, publication) ? descriptor : null;
  const image = useVerifiedImage(accepted), [decoded, setDecoded] = useState(null);
  useEffect(() => {
    setDecoded(null);
    if (!accepted || !image.url || typeof Image === 'undefined') return;
    let active = true;
    const photo = new Image();
    photo.onload = () => { if (active && photo.naturalWidth === accepted.width && photo.naturalHeight === accepted.height) setDecoded(image.url); };
    photo.src = image.url;
    return () => { active = false; photo.onload = null; photo.onerror = null; photo.src = ''; };
  }, [image.url, accepted?.width, accepted?.height]);
  return accepted && decoded === image.url ? image.url : null;
}
