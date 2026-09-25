// Copied from Google Maps → Share → Embed a map on 2026-09-25 UTC.
// The pin is the publicly verified shop, not evidence of an operating kiosk.
const centerCourtMap = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3111.548851193977!2d-121.28460030000001!3d38.7511138!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x809b211745ba98ad%3A0x3e78e463210e68c3!2sCentercourt%20Cards!5e0!3m2!1sen!2sus!4v1790301332126!5m2!1sen!2sus';

export function dealerAddress(address) {
  return typeof address === 'string' ? address : ['line1', 'line2', 'city', 'region', 'postalCode', 'country'].map(key => address?.[key]).filter(Boolean).join(', ');
}

export function dealerMapUrl(location) {
  if (location.id === 'centercourt-cards-roseville' && dealerAddress(location.address) === '307 Lincoln St, Roseville, CA, 95678, US') return centerCourtMap;
  // Operational locations already supply an exact, approved map projection.
  // No user query or device coordinates are sent to Google by this component.
  try {
    const url = new URL(location.mapEmbedUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (url.hostname === 'www.google.com' && url.pathname === '/maps/embed' && url.searchParams.get('pb')) return url.href;
    if (url.hostname === 'maps.google.com' && url.pathname === '/maps' && url.searchParams.get('output') === 'embed' && url.searchParams.get('q')) return url.href;
  } catch { /* Locations without a configured map remain in the list. */ }
  return null;
}

export function dealerDirectionsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['google.com', 'www.google.com'].includes(url.hostname) && !url.username && !url.password && !url.port && url.pathname.startsWith('/maps/') ? url.href : null;
  } catch { return null; }
}
